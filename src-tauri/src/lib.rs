mod brand_migration;
mod codex;
#[cfg(test)]
mod config_contract;
#[cfg(target_os = "macos")]
mod macos_glass;
#[cfg(target_os = "macos")]
mod macos_overlay;
mod models;
mod token_stats;

use std::{
    fs,
    io::Write,
    path::PathBuf,
    sync::Mutex,
    time::{Duration, Instant},
};

use models::{ProviderSnapshot, WidgetPreferences};
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State, WindowEvent,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_window_state::{Builder as WindowStateBuilder, StateFlags};

fn window_state_flags() -> StateFlags {
    if cfg!(target_os = "macos") {
        StateFlags::POSITION | StateFlags::VISIBLE
    } else {
        StateFlags::all()
    }
}

struct AppState {
    client: reqwest::Client,
    preferences: Mutex<WidgetPreferences>,
    preferences_path: PathBuf,
    fetch_lock: tokio::sync::Mutex<()>,
    snapshot_cache: Mutex<Option<(Instant, Vec<ProviderSnapshot>)>>,
    token_stats: token_stats::TokenStatsService,
}

async fn fetch_snapshots_uncached(state: &State<'_, AppState>) -> Vec<ProviderSnapshot> {
    let _guard = state.fetch_lock.lock().await;
    let values = vec![codex::fetch_snapshot(&state.client).await];
    if let Ok(mut cache) = state.snapshot_cache.lock() {
        *cache = Some((Instant::now(), values.clone()));
    }
    values
}

fn load_preferences(path: &PathBuf) -> WidgetPreferences {
    let parse = |candidate: &PathBuf| {
        fs::read_to_string(candidate)
            .ok()
            .and_then(|raw| serde_json::from_str::<WidgetPreferences>(&raw).ok())
    };
    if let Some(value) = parse(path) {
        return value.normalized();
    }
    let backup = path.with_extension("json.bak");
    if let Some(value) = parse(&backup) {
        eprintln!("preferences recovered from backup");
        return value.normalized();
    }
    WidgetPreferences::default()
}

fn persist_preferences(path: &PathBuf, value: &WidgetPreferences) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|_| "failed to create settings directory".to_string())?;
    }
    let serialized =
        serde_json::to_vec_pretty(value).map_err(|_| "failed to serialize settings".to_string())?;
    let temporary = path.with_extension("json.tmp");
    let backup = path.with_extension("json.bak");
    let mut file = fs::File::create(&temporary)
        .map_err(|_| "failed to create temporary settings file".to_string())?;
    file.write_all(&serialized)
        .and_then(|_| file.sync_all())
        .map_err(|_| "failed to write settings".to_string())?;
    if path.exists() {
        let _ = fs::remove_file(&backup);
        fs::rename(path, &backup).map_err(|_| "failed to back up settings".to_string())?;
    }
    if let Err(error) = fs::rename(&temporary, path) {
        let _ = fs::rename(&backup, path);
        return Err(format!("failed to commit settings: {error}"));
    }
    Ok(())
}

fn commit_preferences_with<M, P, A>(
    preferences: &Mutex<WidgetPreferences>,
    mutate: M,
    mut persist: P,
    apply: A,
) -> Result<WidgetPreferences, String>
where
    M: FnOnce(&WidgetPreferences) -> WidgetPreferences,
    P: FnMut(&WidgetPreferences) -> Result<(), String>,
    A: FnOnce(&WidgetPreferences, &WidgetPreferences) -> Result<(), String>,
{
    let mut current = preferences
        .lock()
        .map_err(|_| "settings unavailable".to_string())?;
    let previous = current.clone();
    let next = mutate(&previous).normalized();
    persist(&next)?;
    if let Err(error) = apply(&previous, &next) {
        let _ = persist(&previous);
        return Err(error);
    }
    *current = next.clone();
    Ok(next)
}

fn commit_preferences<M, A>(
    state: &AppState,
    mutate: M,
    apply: A,
) -> Result<WidgetPreferences, String>
where
    M: FnOnce(&WidgetPreferences) -> WidgetPreferences,
    A: FnOnce(&WidgetPreferences, &WidgetPreferences) -> Result<(), String>,
{
    commit_preferences_with(
        &state.preferences,
        mutate,
        |next| persist_preferences(&state.preferences_path, next),
        apply,
    )
}

#[cfg(target_os = "macos")]
fn apply_glass(app: &AppHandle, preferences: &WidgetPreferences) -> macos_glass::GlassBackend {
    let backend = app
        .get_webview_window("widget")
        .map(|window| macos_glass::apply(&window, preferences))
        .unwrap_or(macos_glass::GlassBackend::CssFallback);
    let _ = app.emit_to("widget", "glass-effect-status", backend);
    backend
}

#[cfg(target_os = "macos")]
fn apply_glass_if_changed(app: &AppHandle, previous: &WidgetPreferences, next: &WidgetPreferences) {
    if macos_glass::appearance_changed(previous, next) {
        apply_glass(app, next);
    }
}

#[cfg(not(target_os = "macos"))]
fn apply_glass_if_changed(
    _app: &AppHandle,
    _previous: &WidgetPreferences,
    _next: &WidgetPreferences,
) {
}

fn commit_then_publish<T, C, P>(commit: C, publish: P) -> Result<T, String>
where
    C: FnOnce() -> Result<T, String>,
    P: FnOnce(&T),
{
    let value = commit()?;
    publish(&value);
    Ok(value)
}

fn emit_preferences_changed(app: &AppHandle, preferences: &WidgetPreferences) {
    let _ = app.emit_to("widget", "preferences-changed", preferences);
}

#[cfg(test)]
mod preference_commit_tests {
    use super::*;
    use crate::models::ExpandedView;
    use std::sync::{mpsc, Arc};
    use std::thread;

    #[test]
    fn migrated_preferences_are_loaded_by_the_existing_loader() {
        let root = tempfile::tempdir().unwrap();
        let legacy = root.path().join(brand_migration::LEGACY_IDENTIFIER);
        let destination = root.path().join("app.tokenhalo.desktop");
        fs::create_dir_all(&legacy).unwrap();
        let mut expected = WidgetPreferences::default();
        expected.language = "zh-CN".into();
        fs::write(
            legacy.join("preferences.json"),
            serde_json::to_vec(&expected).unwrap(),
        )
        .unwrap();

        let report = brand_migration::migrate_legacy_config(root.path(), &destination);
        let loaded = load_preferences(&destination.join("preferences.json"));

        assert_eq!(report.migrated, 1);
        assert_eq!(loaded.language, "zh-CN");
    }

    #[test]
    fn concurrent_updates_serialize_the_persisted_and_in_memory_snapshot() {
        let preferences = Arc::new(Mutex::new(WidgetPreferences::default()));
        let (first_persisting_tx, first_persisting_rx) = mpsc::channel();
        let (release_first_tx, release_first_rx) = mpsc::channel();

        let first_preferences = Arc::clone(&preferences);
        let first = thread::spawn(move || {
            commit_preferences_with(
                &first_preferences,
                |current| WidgetPreferences {
                    expanded_view: ExpandedView::TokenStats,
                    ..current.clone()
                },
                |_| {
                    first_persisting_tx.send(()).unwrap();
                    release_first_rx.recv().unwrap();
                    Ok(())
                },
                |_, _| Ok(()),
            )
            .unwrap();
        });

        first_persisting_rx.recv().unwrap();
        let second_preferences = Arc::clone(&preferences);
        let second = thread::spawn(move || {
            commit_preferences_with(
                &second_preferences,
                |current| WidgetPreferences {
                    language: "en".into(),
                    ..current.clone()
                },
                |_| Ok(()),
                |_, _| Ok(()),
            )
            .unwrap();
        });

        release_first_tx.send(()).unwrap();
        first.join().unwrap();
        second.join().unwrap();

        let final_preferences = preferences.lock().unwrap().clone();
        assert_eq!(final_preferences.expanded_view, ExpandedView::TokenStats);
        assert_eq!(final_preferences.language, "en");
    }

    #[test]
    fn failed_persistence_does_not_publish_an_uncommitted_snapshot() {
        let preferences = Mutex::new(WidgetPreferences::default());
        let result = commit_preferences_with(
            &preferences,
            |current| WidgetPreferences {
                expanded_view: ExpandedView::TokenStats,
                ..current.clone()
            },
            |_| Err("disk full".into()),
            |_, _| Ok(()),
        );

        assert!(result.is_err());
        assert_eq!(
            preferences.lock().unwrap().expanded_view,
            ExpandedView::Quota
        );
    }

    #[test]
    fn successful_commit_publishes_only_after_native_and_memory_state() {
        let preferences = Mutex::new(WidgetPreferences::default());
        let order = Mutex::new(Vec::new());
        let result = commit_then_publish(
            || {
                commit_preferences_with(
                    &preferences,
                    |current| WidgetPreferences {
                        locked: true,
                        ..current.clone()
                    },
                    |persisted| {
                        assert!(persisted.locked);
                        order.lock().unwrap().push("persist");
                        Ok(())
                    },
                    |_, next| {
                        assert!(next.locked);
                        order.lock().unwrap().push("native");
                        Ok(())
                    },
                )
            },
            |published| {
                assert!(published.locked);
                assert!(preferences.lock().unwrap().locked);
                order.lock().unwrap().push("event");
            },
        );

        assert!(result.is_ok());
        assert_eq!(*order.lock().unwrap(), vec!["persist", "native", "event"]);
    }

    #[test]
    fn failed_commit_does_not_publish_an_event() {
        let preferences = Mutex::new(WidgetPreferences::default());
        let published = Mutex::new(false);
        let result: Result<WidgetPreferences, String> = commit_then_publish(
            || {
                commit_preferences_with(
                    &preferences,
                    |current| WidgetPreferences {
                        locked: true,
                        ..current.clone()
                    },
                    |_| Err("persist failed".into()),
                    |_, _| panic!("native apply must not run after persistence failure"),
                )
            },
            |_| *published.lock().unwrap() = true,
        );

        assert!(result.is_err());
        assert!(!*published.lock().unwrap());
        assert!(!preferences.lock().unwrap().locked);
    }
}

#[tauri::command]
async fn get_snapshots(state: State<'_, AppState>) -> Result<Vec<ProviderSnapshot>, String> {
    const CACHE_TTL: Duration = Duration::from_secs(30);
    if let Ok(cache) = state.snapshot_cache.lock() {
        if let Some((time, values)) = &*cache {
            if time.elapsed() < CACHE_TTL {
                return Ok(values.clone());
            }
        }
    }
    let _guard = match state.fetch_lock.try_lock() {
        Ok(guard) => guard,
        Err(_) => {
            if let Ok(cache) = state.snapshot_cache.lock() {
                if let Some((_, values)) = &*cache {
                    return Ok(values.clone());
                }
            }
            return Ok(vec![ProviderSnapshot::failure(
                "unavailable",
                "Quota refresh is already running.",
            )]);
        }
    };
    if let Ok(cache) = state.snapshot_cache.lock() {
        if let Some((time, values)) = &*cache {
            if time.elapsed() < CACHE_TTL {
                return Ok(values.clone());
            }
        }
    }
    let values = vec![codex::fetch_snapshot(&state.client).await];
    if let Ok(mut cache) = state.snapshot_cache.lock() {
        *cache = Some((Instant::now(), values.clone()));
    }
    Ok(values)
}

#[tauri::command]
async fn refresh_snapshots(state: State<'_, AppState>) -> Result<Vec<ProviderSnapshot>, String> {
    Ok(fetch_snapshots_uncached(&state).await)
}

#[tauri::command]
async fn get_token_stats(
    granularity: token_stats::StatsGranularity,
    force: bool,
    state: State<'_, AppState>,
) -> Result<token_stats::TokenStatsSnapshot, String> {
    Ok(state.token_stats.snapshot(granularity, force).await)
}

#[tauri::command]
fn get_preferences(state: State<'_, AppState>) -> Result<WidgetPreferences, String> {
    state
        .preferences
        .lock()
        .map(|value| value.clone())
        .map_err(|_| "settings unavailable".into())
}

#[tauri::command]
fn set_preferences(
    preferences: WidgetPreferences,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let next = commit_preferences(
        &state,
        |_| preferences,
        |previous, next| {
            apply_glass_if_changed(&app, previous, next);
            Ok(())
        },
    )?;
    emit_preferences_changed(&app, &next);
    Ok(())
}

fn apply_lock(app: &AppHandle, locked: bool) -> Result<(), String> {
    let window = app
        .get_webview_window("widget")
        .ok_or_else(|| "widget window missing".to_string())?;
    window
        .set_ignore_cursor_events(locked)
        .map_err(|_| "failed to toggle click-through".to_string())
}

#[tauri::command]
fn set_widget_locked(
    locked: bool,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<WidgetPreferences, String> {
    commit_then_publish(
        || {
            commit_preferences(
                &state,
                |current| WidgetPreferences {
                    locked,
                    ..current.clone()
                },
                |previous, next| {
                    apply_lock(&app, next.locked)?;
                    apply_glass_if_changed(&app, previous, next);
                    Ok(())
                },
            )
        },
        |next| emit_preferences_changed(&app, next),
    )
}

#[tauri::command]
fn set_widget_always_on_top(
    always_on_top: bool,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<WidgetPreferences, String> {
    let window = app
        .get_webview_window("widget")
        .ok_or_else(|| "widget window missing".to_string())?;
    let next = commit_preferences(
        &state,
        |current| WidgetPreferences {
            always_on_top,
            ..current.clone()
        },
        |previous, next| {
            window
                .set_always_on_top(next.always_on_top)
                .map_err(|error| format!("failed to toggle always-on-top: {error}"))?;
            apply_glass_if_changed(&app, previous, next);
            Ok(())
        },
    )?;
    emit_preferences_changed(&app, &next);
    Ok(next)
}

#[cfg(target_os = "macos")]
#[tauri::command]
fn set_native_glass_mode(
    mode: macos_glass::NativeGlassMode,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<macos_glass::GlassBackend, String> {
    let preferences = state
        .preferences
        .lock()
        .map(|value| value.clone())
        .map_err(|_| "settings unavailable".to_string())?;
    let window = app
        .get_webview_window("widget")
        .ok_or_else(|| "widget window missing".to_string())?;
    let backend = macos_glass::apply_mode(&window, &preferences, mode);
    let _ = app.emit_to("widget", "glass-effect-status", backend);
    Ok(backend)
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
fn set_native_glass_mode(_mode: String) -> Result<&'static str, String> {
    Ok("cssFallback")
}

fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show / Hide", true, None::<&str>)?;
    let refresh = MenuItem::with_id(app, "refresh", "Refresh now", true, None::<&str>)?;
    let unlock = MenuItem::with_id(app, "unlock", "Unlock widget", true, None::<&str>)?;
    let pin = MenuItem::with_id(app, "pin", "Pin / Unpin Codex", true, None::<&str>)?;
    let language = MenuItem::with_id(
        app,
        "language",
        "Switch Language / 切换语言",
        true,
        None::<&str>,
    )?;
    let autostart_enabled = app.autolaunch().is_enabled().unwrap_or(false);
    let autostart = CheckMenuItem::with_id(
        app,
        "autostart",
        "Start at login",
        true,
        autostart_enabled,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[&show, &refresh, &unlock, &pin, &language, &autostart, &quit],
    )?;
    let mut builder = TrayIconBuilder::with_id("main")
        .menu(&menu)
        .tooltip("TokenHalo");
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    let autostart_menu = autostart.clone();
    builder
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("widget") {
                    if window.is_visible().unwrap_or(false) {
                        let _ = window.hide();
                    } else {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
            "refresh" => {
                let _ = app.emit_to("widget", "refresh-requested", ());
            }
            "unlock" => {
                if let Some(state) = app.try_state::<AppState>() {
                    if let Ok(next) = commit_preferences(
                        &state,
                        |current| WidgetPreferences {
                            locked: false,
                            ..current.clone()
                        },
                        |previous, next| {
                            apply_lock(app, next.locked)?;
                            apply_glass_if_changed(app, previous, next);
                            Ok(())
                        },
                    ) {
                        let _ = app.emit_to("widget", "preferences-changed", next);
                    }
                }
            }
            "pin" => {
                if let Some(state) = app.try_state::<AppState>() {
                    if let Ok(next) = commit_preferences(
                        &state,
                        |current| WidgetPreferences {
                            pinned_provider: if current.pinned_provider.is_some() {
                                None
                            } else {
                                Some("codex".into())
                            },
                            ..current.clone()
                        },
                        |previous, next| {
                            apply_glass_if_changed(app, previous, next);
                            Ok(())
                        },
                    ) {
                        let _ = app.emit_to("widget", "preferences-changed", next);
                    }
                }
            }
            "language" => {
                if let Some(state) = app.try_state::<AppState>() {
                    if let Ok(next) = commit_preferences(
                        &state,
                        |current| WidgetPreferences {
                            language: if current.language == "en" {
                                "zh-CN".into()
                            } else {
                                "en".into()
                            },
                            ..current.clone()
                        },
                        |previous, next| {
                            apply_glass_if_changed(app, previous, next);
                            Ok(())
                        },
                    ) {
                        let _ = app.emit_to("widget", "preferences-changed", next);
                    }
                }
            }
            "autostart" => {
                let manager = app.autolaunch();
                let enabled = manager.is_enabled().unwrap_or(false);
                let result = if enabled {
                    manager.disable()
                } else {
                    manager.enable()
                };
                match result {
                    Ok(()) => {
                        let _ = autostart_menu.set_checked(!enabled);
                    }
                    Err(_) => eprintln!("autostart update failed"),
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    Ok(())
}

pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("widget") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(
            WindowStateBuilder::default()
                .with_state_flags(window_state_flags())
                .build(),
        );

    #[cfg(target_os = "macos")]
    let builder = builder.plugin(tauri_nspanel::init());

    let app = builder
        .setup(|app| {
            #[cfg(target_os = "macos")]
            macos_overlay::configure(app)?;

            let data_dir = app.path().app_config_dir()?;
            let config_root = app.path().config_dir()?;
            let migration = brand_migration::migrate_legacy_config(&config_root, &data_dir);
            if migration.failed > 0 {
                eprintln!("legacy configuration migration incomplete");
            }
            let preferences_path = data_dir.join("preferences.json");
            let sessions_root = dirs::home_dir()
                .unwrap_or_else(|| data_dir.clone())
                .join(".codex")
                .join("sessions");
            let token_stats = token_stats::TokenStatsService::new(
                sessions_root,
                data_dir.join("token-stats-index.json"),
            );
            let preferences = load_preferences(&preferences_path);
            #[cfg(target_os = "macos")]
            apply_glass(app.handle(), &preferences);
            let user_agent = format!("TokenHalo/{}", app.package_info().version);
            let client = reqwest::Client::builder()
                .timeout(Duration::from_secs(12))
                .redirect(reqwest::redirect::Policy::none())
                .user_agent(user_agent)
                .build()
                .expect("static HTTP client configuration must be valid");
            app.manage(AppState {
                client,
                preferences: Mutex::new(preferences.clone()),
                preferences_path,
                fetch_lock: tokio::sync::Mutex::new(()),
                snapshot_cache: Mutex::new(None),
                token_stats,
            });
            if setup_tray(app).is_err() {
                eprintln!("tray setup failed; enabling taskbar fallback");
                if let Some(window) = app.get_webview_window("widget") {
                    let _ = window.set_skip_taskbar(false);
                }
            }
            if preferences.locked {
                let _ = apply_lock(app.handle(), true);
            }
            if let Some(window) = app.get_webview_window("widget") {
                let _ = window.set_always_on_top(preferences.always_on_top);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_snapshots,
            refresh_snapshots,
            get_token_stats,
            get_preferences,
            set_preferences,
            set_widget_locked,
            set_widget_always_on_top,
            set_native_glass_mode
        ])
        .on_tray_icon_event(|app, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                if let Some(window) = app.get_webview_window("widget") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("failed to build TokenHalo");
    app.run(|app_handle, event| {
        if matches!(event, tauri::RunEvent::Resumed) {
            let _ = app_handle.emit_to("widget", "refresh-requested", ());
        }
    });
}
