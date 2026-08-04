use serde_json::Value;
#[cfg(target_os = "macos")]
use tauri_plugin_window_state::StateFlags;

#[test]
fn tokenhalo_metadata_is_canonical() {
    let config: Value = serde_json::from_str(include_str!("../tauri.conf.json"))
        .expect("tauri.conf.json must be valid JSON");
    let widget = config["app"]["windows"]
        .as_array()
        .and_then(|windows| windows.iter().find(|window| window["label"] == "widget"))
        .expect("widget window must exist");

    assert_eq!(config["productName"], "TokenHalo");
    assert_eq!(config["identifier"], "app.tokenhalo.desktop");
    assert_eq!(widget["title"], "TokenHalo");
    assert_eq!(
        config["bundle"]["shortDescription"],
        "Codex usage at a glance"
    );
}

#[test]
fn widget_is_configured_for_cross_space_overlay_use() {
    let config: Value = serde_json::from_str(include_str!("../tauri.conf.json"))
        .expect("tauri.conf.json must be valid JSON");
    let widget = config["app"]["windows"]
        .as_array()
        .and_then(|windows| windows.iter().find(|window| window["label"] == "widget"))
        .expect("widget window must exist");

    assert_eq!(widget["alwaysOnTop"], true);
    assert_eq!(widget["visibleOnAllWorkspaces"], true);
    assert_eq!(widget["fullscreen"], false);
    assert_eq!(widget["maximizable"], false);
    assert_eq!(widget["transparent"], true);
    assert_eq!(config["app"]["macOSPrivateApi"], true);
}

#[test]
fn widget_supports_compact_quota_and_statistics_sides() {
    let config: Value = serde_json::from_str(include_str!("../tauri.conf.json"))
        .expect("tauri.conf.json must be valid JSON");
    let widget = config["app"]["windows"]
        .as_array()
        .and_then(|windows| windows.iter().find(|window| window["label"] == "widget"))
        .expect("widget window must exist");

    assert_eq!(widget["width"].as_u64(), Some(100));
    assert_eq!(widget["height"].as_u64(), Some(100));
    assert!(widget["maxWidth"]
        .as_u64()
        .is_some_and(|value| value >= 400));
    assert!(widget["maxHeight"]
        .as_u64()
        .is_some_and(|value| value >= 400));
}

#[test]
fn widget_denies_internal_maximize_command() {
    let capability: Value = serde_json::from_str(include_str!("../capabilities/default.json"))
        .expect("default capability must be valid JSON");
    let permissions = capability["permissions"]
        .as_array()
        .expect("default capability must contain permissions");

    assert!(permissions
        .iter()
        .any(|permission| permission == "core:window:deny-internal-toggle-maximize"));
}

#[test]
fn widget_allows_setting_window_position() {
    let capability: Value = serde_json::from_str(include_str!("../capabilities/default.json"))
        .expect("default capability must be valid JSON");
    let permissions = capability["permissions"]
        .as_array()
        .expect("default capability must contain permissions");

    assert!(permissions
        .iter()
        .any(|permission| permission == "core:window:allow-set-position"));
}

#[test]
fn task_toast_is_hidden_focus_safe_and_fixed_size() {
    let config: Value = serde_json::from_str(include_str!("../tauri.conf.json"))
        .expect("tauri.conf.json must be valid JSON");
    let toast = config["app"]["windows"]
        .as_array()
        .and_then(|windows| windows.iter().find(|window| window["label"] == "task-toast"))
        .expect("task-toast window must exist");

    assert_eq!(toast["url"], "index.html?surface=task-toast");
    assert_eq!(toast["width"], 260);
    assert_eq!(toast["height"], 96);
    assert_eq!(toast["visible"], false);
    assert_eq!(toast["focus"], false);
    assert_eq!(toast["resizable"], false);
    assert_eq!(toast["decorations"], false);
    assert_eq!(toast["transparent"], true);
    assert_eq!(toast["alwaysOnTop"], true);
    assert_eq!(toast["visibleOnAllWorkspaces"], true);
    assert_eq!(toast["skipTaskbar"], true);
}

#[test]
fn task_toast_shares_only_the_required_window_capabilities() {
    let capability: Value = serde_json::from_str(include_str!("../capabilities/default.json"))
        .expect("default capability must be valid JSON");
    let windows = capability["windows"]
        .as_array()
        .expect("default capability must list windows");
    let permissions = capability["permissions"]
        .as_array()
        .expect("default capability must contain permissions");

    assert!(windows.iter().any(|window| window == "widget"));
    assert!(windows.iter().any(|window| window == "task-toast"));
    for required in [
        "core:window:allow-outer-size",
        "core:window:allow-scale-factor",
        "core:window:allow-show",
        "core:window:allow-hide",
    ] {
        assert!(permissions.iter().any(|permission| permission == required));
    }
}

#[cfg(target_os = "macos")]
#[test]
fn macos_window_state_restores_position_but_never_an_expanded_size() {
    let flags = super::window_state_flags();

    assert!(flags.contains(StateFlags::POSITION));
    assert!(!flags.contains(StateFlags::SIZE));
    assert!(!flags.contains(StateFlags::MAXIMIZED));
    assert!(!flags.contains(StateFlags::FULLSCREEN));
    assert!(!flags.contains(StateFlags::DECORATIONS));
}

#[cfg(target_os = "macos")]
#[test]
fn native_glass_never_reparents_the_webview() {
    let source = include_str!("macos_glass.rs");
    let reparenting_builder = [".content_", "view("].concat();

    assert!(
        !source.contains(&reparenting_builder),
        "moving WKWebView into NSGlassEffectView crashes WebKit's window observer cleanup"
    );
}

#[cfg(target_os = "macos")]
#[test]
fn native_glass_clips_its_rounded_layer_to_bounds() {
    let source = include_str!("macos_glass.rs");
    let liquid_glass = source
        .split("GlassBackend::LiquidGlass =>")
        .nth(1)
        .and_then(|branch| branch.split("GlassBackend::Vibrancy =>").next())
        .expect("liquid glass branch must exist");

    assert!(
        liquid_glass.contains("layer.setMasksToBounds(true)"),
        "native glass must clip its material to the rounded card bounds"
    );
}
