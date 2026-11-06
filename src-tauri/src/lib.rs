mod codex;
#[cfg(test)]
mod config_contract;
#[cfg(target_os = "macos")]
mod macos_glass;
#[cfg(target_os = "macos")]
mod macos_overlay;
mod models;
pub mod task_companion;
mod task_toast_frame;
mod token_stats;
mod updates;

pub fn run_task_hook_if_requested() -> Option<Result<(), String>> {
    task_companion::hook::run_from_process_args()
}

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
    task_health_path: PathBuf,
    task_enabled_path: PathBuf,
    codex_hooks_path: PathBuf,
}

#[cfg(test)]
mod update_contract_tests {
    use crate::updates::release_info_from_redirect;

    #[test]
    fn release_redirect_reports_a_newer_semantic_version() {
        let result = release_info_from_redirect(
            "0.1.9",
            "https://github.com/BitPan666/TokenHalo/releases/tag/v0.1.10",
        )
        .unwrap();

        assert_eq!(result.current_version, "0.1.9");
        assert_eq!(result.latest_version, "0.1.10");
        assert!(result.update_available);
    }

    #[test]
    fn release_redirect_accepts_an_equal_v_prefixed_version() {
        let result = release_info_from_redirect(
            "0.1.5",
            "https://github.com/BitPan666/TokenHalo/releases/tag/v0.1.5",
        )
        .unwrap();

        assert!(!result.update_available);
    }

    #[test]
    fn release_redirect_rejects_an_unrelated_location() {
        let result = release_info_from_redirect(
            "0.1.5",
            "https://github.com/another/repository/releases/tag/v9.0.0",
        );

        assert!(result.is_err());
    }
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

fn apply_always_on_top(
    app: &AppHandle,
    always_on_top: bool,
    rollback_to: Option<bool>,
) -> Result<(), String> {
    let widget = app
        .get_webview_window("widget")
        .ok_or_else(|| "widget window missing".to_string())?;
    widget
        .set_always_on_top(always_on_top)
        .map_err(|error| format!("failed to toggle always-on-top: {error}"))?;
    if let Some(toast) = app.get_webview_window("task-toast") {
        if let Err(error) = toast.set_always_on_top(always_on_top) {
            if let Some(previous) = rollback_to {
                let _ = widget.set_always_on_top(previous);
            }
            return Err(format!("failed to toggle task notification layer: {error}"));
        }
    }
    Ok(())
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
    let next = commit_preferences(
        &state,
        |current| WidgetPreferences {
            always_on_top,
            ..current.clone()
        },
        |previous, next| {
            apply_always_on_top(&app, next.always_on_top, Some(previous.always_on_top))?;
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

#[tauri::command]
async fn check_for_updates(
    state: State<'_, AppState>,
) -> Result<updates::UpdateCheckResult, String> {
    updates::check_for_updates(&state.client, env!("CARGO_PKG_VERSION")).await
}

#[tauri::command]
fn open_release_page() -> Result<(), String> {
    updates::open_latest_release()
}

fn task_connection_status(state: &AppState) -> task_companion::models::ConnectionStatus {
    use task_companion::models::{ConnectionState, ConnectionStatus};
    let connection = if state.task_enabled_path.exists() {
        ConnectionState::Connected
    } else {
        ConnectionState::Disconnected
    };
    ConnectionStatus { state: connection }
}

#[tauri::command]
fn get_task_companion_connection(
    state: State<'_, AppState>,
) -> task_companion::models::ConnectionStatus {
    task_connection_status(&state)
}

#[tauri::command]
fn get_codex_foreground() -> Option<bool> {
    task_companion::foreground::is_codex_foreground()
}

#[tauri::command]
fn connect_task_companion(
    state: State<'_, AppState>,
) -> Result<task_companion::models::ConnectionStatus, String> {
    if task_companion::integration::is_installed(&state.codex_hooks_path).unwrap_or(false) {
        let _ = task_companion::integration::uninstall(&state.codex_hooks_path);
    }
    if let Some(parent) = state.task_enabled_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|_| "failed to create task companion settings".to_string())?;
    }
    fs::write(&state.task_enabled_path, b"enabled")
        .map_err(|_| "failed to enable task companion".to_string())?;
    let _ = fs::remove_file(&state.task_health_path);
    Ok(task_connection_status(&state))
}

#[tauri::command]
fn disconnect_task_companion(
    state: State<'_, AppState>,
) -> Result<task_companion::models::ConnectionStatus, String> {
    let _ = fs::remove_file(&state.task_enabled_path);
    if task_companion::integration::is_installed(&state.codex_hooks_path).unwrap_or(false) {
        let _ = task_companion::integration::uninstall(&state.codex_hooks_path);
    }
    let _ = fs::remove_file(&state.task_health_path);
    Ok(task_connection_status(&state))
}

#[tauri::command]
fn emit_test_task_companion_event(app: AppHandle) -> Result<(), String> {
    use task_companion::models::{TaskCompanionEvent, TaskEventStatus};
    app.emit_to(
        "widget",
        "task-companion-event",
        TaskCompanionEvent {
            schema_version: 1,
            event_id: format!("simulator-{}", chrono::Utc::now().timestamp_millis()),
            thread_id: "tokenhalo-simulator".into(),
            turn_id: Some("test-notification".into()),
            status: TaskEventStatus::Completed,
            occurred_at: chrono::Utc::now().to_rfc3339(),
            project_name: Some("TokenHalo".into()),
            task_title: Some("Test notification".into()),
            duration_ms: Some(12_000),
            source: "simulator".into(),
        },
    )
    .map_err(|_| "failed to send test notification".to_string())
}

fn point_is_inside_rect(
    pointer_x: f64,
    pointer_y: f64,
    rect_x: i32,
    rect_y: i32,
    rect_width: u32,
    rect_height: u32,
) -> bool {
    pointer_x >= f64::from(rect_x)
        && pointer_x < f64::from(rect_x) + f64::from(rect_width)
        && pointer_y >= f64::from(rect_y)
        && pointer_y < f64::from(rect_y) + f64::from(rect_height)
}

#[tauri::command]
fn get_widget_pointer_inside(app: AppHandle) -> bool {
    let Some(window) = app.get_webview_window("widget") else {
        return false;
    };
    let Ok(pointer) = app.cursor_position() else {
        return false;
    };
    let (Ok(position), Ok(size)) = (window.outer_position(), window.outer_size()) else {
        return false;
    };
    point_is_inside_rect(
        pointer.x,
        pointer.y,
        position.x,
        position.y,
        size.width,
        size.height,
    )
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct TaskToastPointerState {
    inside: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    x: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    y: Option<f64>,
}

fn task_toast_pointer_state(
    pointer_x: f64,
    pointer_y: f64,
    rect_x: i32,
    rect_y: i32,
    rect_width: u32,
    rect_height: u32,
    scale_factor: f64,
) -> TaskToastPointerState {
    if !point_is_inside_rect(
        pointer_x,
        pointer_y,
        rect_x,
        rect_y,
        rect_width,
        rect_height,
    ) {
        return TaskToastPointerState::outside();
    }
    let scale_factor = scale_factor.max(f64::EPSILON);
    TaskToastPointerState {
        inside: true,
        x: Some((pointer_x - f64::from(rect_x)) / scale_factor),
        y: Some((pointer_y - f64::from(rect_y)) / scale_factor),
    }
}

impl TaskToastPointerState {
    fn outside() -> Self {
        Self {
            inside: false,
            x: None,
            y: None,
        }
    }
}

#[tauri::command]
fn get_task_toast_pointer(app: AppHandle) -> TaskToastPointerState {
    let Some(window) = app.get_webview_window("task-toast") else {
        return TaskToastPointerState::outside();
    };
    let (Ok(pointer), Ok(position), Ok(size)) = (
        app.cursor_position(),
        window.outer_position(),
        window.outer_size(),
    ) else {
        return TaskToastPointerState::outside();
    };
    task_toast_pointer_state(
        pointer.x,
        pointer.y,
        position.x,
        position.y,
        size.width,
        size.height,
        window.scale_factor().unwrap_or(1.0),
    )
}

fn start_task_toast_pointer_watchdog(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_millis(120)).await;
            let pointer = get_task_toast_pointer(app.clone());
            let _ = app.emit_to("task-toast", "task-toast-native-pointer", pointer);
        }
    });
}

#[cfg(test)]
mod widget_pointer_tests {
    use super::*;

    #[test]
    fn detects_when_the_pointer_has_left_a_resized_widget() {
        assert!(point_is_inside_rect(1900.0, 1000.0, 1824, 955, 320, 320));
        assert!(!point_is_inside_rect(1459.0, 894.0, 1824, 955, 320, 320));
    }

    #[test]
    fn returns_logical_task_toast_coordinates_for_card_hit_testing() {
        assert_eq!(
            task_toast_pointer_state(4112.0, 1680.0, 4000, 1600, 544, 232, 2.0),
            TaskToastPointerState {
                inside: true,
                x: Some(56.0),
                y: Some(40.0),
            }
        );
        assert_eq!(
            task_toast_pointer_state(3999.0, 1680.0, 4000, 1600, 544, 232, 2.0),
            TaskToastPointerState::outside()
        );
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct CodexOpenRequest {
    app_identifier: &'static str,
    deep_link: String,
}

fn try_codex_open_request(thread_id: &str) -> Option<CodexOpenRequest> {
    let thread_id = thread_id.trim();
    if thread_id.is_empty() {
        return None;
    }
    Some(CodexOpenRequest {
        app_identifier: "com.openai.codex",
        deep_link: format!("codex://threads/{thread_id}"),
    })
}

#[tauri::command]
fn open_codex_task(thread_id: String) -> &'static str {
    use std::process::Command;
    let Some(request) = try_codex_open_request(&thread_id) else {
        return "unavailable";
    };
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.args(["-b", request.app_identifier, request.deep_link.as_str()]);
        command
    };
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("cmd");
        command.args(["/C", "start", "", request.deep_link.as_str()]);
        command
    };
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    let mut command = {
        let mut command = Command::new("xdg-open");
        command.arg(request.deep_link.as_str());
        command
    };
    match command.status() {
        Ok(status) if status.success() => "openedTask",
        _ => "unavailable",
    }
}

#[cfg(test)]
mod codex_open_tests {
    use super::*;

    #[test]
    fn codex_open_request_targets_the_selected_task() {
        let request = try_codex_open_request("0198fd40-41a5-7c73-a534-d0108223a815")
            .expect("valid task ID should create an open request");

        assert_eq!(request.app_identifier, "com.openai.codex");
        assert_eq!(
            request.deep_link,
            "codex://threads/0198fd40-41a5-7c73-a534-d0108223a815"
        );
    }

    #[test]
    fn codex_open_request_rejects_an_empty_task_id() {
        assert!(try_codex_open_request("   ").is_none());
    }
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
            start_task_toast_pointer_watchdog(app.handle().clone());

            let data_dir = app.path().app_config_dir()?;
            let preferences_path = data_dir.join("preferences.json");
            let sessions_root = dirs::home_dir()
                .unwrap_or_else(|| data_dir.clone())
                .join(".codex")
                .join("sessions");
            let token_stats = token_stats::TokenStatsService::new(
                sessions_root.clone(),
                data_dir.join("token-stats-index.json"),
            );
            let task_inbox_path = data_dir.join("task-companion").join("inbox");
            let task_health_path = data_dir.join("task-companion").join("last-seen");
            let task_enabled_path = data_dir.join("task-companion").join("enabled");
            let codex_hooks_path = dirs::home_dir()
                .unwrap_or_else(|| data_dir.clone())
                .join(".codex")
                .join("hooks.json");
            if task_companion::integration::is_installed(&codex_hooks_path).unwrap_or(false)
                && task_companion::integration::uninstall(&codex_hooks_path).is_ok()
            {
                if let Some(parent) = task_enabled_path.parent() {
                    let _ = fs::create_dir_all(parent);
                }
                let _ = fs::write(&task_enabled_path, b"enabled");
            }
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
                task_health_path: task_health_path.clone(),
                task_enabled_path: task_enabled_path.clone(),
                codex_hooks_path,
            });
            task_companion::start_watcher(
                app.handle().clone(),
                task_inbox_path,
                task_health_path,
                sessions_root,
                task_enabled_path,
            );
            if setup_tray(app).is_err() {
                eprintln!("tray setup failed; enabling taskbar fallback");
                if let Some(window) = app.get_webview_window("widget") {
                    let _ = window.set_skip_taskbar(false);
                }
            }
            if preferences.locked {
                let _ = apply_lock(app.handle(), true);
            }
            let _ = apply_always_on_top(app.handle(), preferences.always_on_top, None);
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
            set_native_glass_mode,
            check_for_updates,
            open_release_page,
            get_codex_foreground,
            get_widget_pointer_inside,
            get_task_toast_pointer,
            get_task_companion_connection,
            connect_task_companion,
            disconnect_task_companion,
            emit_test_task_companion_event,
            task_toast_frame::set_task_toast_frame,
            task_toast_frame::show_task_toast_without_focus,
            open_codex_task
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
