use std::io;

use tauri::Manager;
use tauri_nspanel::{
    objc2_app_kit::NSWindowCollectionBehavior, objc2_foundation::NSProcessInfo, tauri_panel,
    CollectionBehavior, PanelLevel, StyleMask, WebviewWindowExt,
};

tauri_panel! {
    panel!(TokenHaloPanel {
        config: {
            can_become_key_window: true,
            can_become_main_window: false,
            is_floating_panel: true,
            hides_on_deactivate: false
        }
    })
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct OverlayPolicy {
    level: PanelLevel,
    style_mask: StyleMask,
    collection_behavior: CollectionBehavior,
    hides_on_deactivate: bool,
}

fn desired_policy(can_join_all_applications: bool) -> OverlayPolicy {
    let mut collection_behavior = CollectionBehavior::new()
        .full_screen_auxiliary()
        .can_join_all_spaces();
    if can_join_all_applications {
        collection_behavior = CollectionBehavior::from_raw(
            collection_behavior.value() | NSWindowCollectionBehavior::CanJoinAllApplications,
        );
    }

    OverlayPolicy {
        level: PanelLevel::Floating,
        style_mask: StyleMask::empty().nonactivating_panel().resizable(),
        collection_behavior,
        hides_on_deactivate: false,
    }
}

fn supports_join_all_applications() -> bool {
    NSProcessInfo::processInfo()
        .operatingSystemVersion()
        .majorVersion
        >= 13
}

pub fn configure(app: &mut tauri::App) -> tauri::Result<()> {
    app.set_activation_policy(tauri::ActivationPolicy::Accessory);

    let window = app.get_webview_window("widget").ok_or_else(|| {
        tauri::Error::Io(io::Error::new(
            io::ErrorKind::NotFound,
            "widget window missing during macOS overlay setup",
        ))
    })?;
    let panel = window.to_panel::<TokenHaloPanel>()?;
    let policy = desired_policy(supports_join_all_applications());

    panel.set_level(policy.level.value());
    panel.set_style_mask(policy.style_mask.into());
    panel.set_collection_behavior(policy.collection_behavior.into());
    panel.set_hides_on_deactivate(policy.hides_on_deactivate);
    panel.set_floating_panel(true);

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn policy_is_nonactivating_floating_and_fullscreen_auxiliary() {
        let policy = desired_policy(true);

        assert_eq!(policy.level, PanelLevel::Floating);
        assert_eq!(
            policy.style_mask,
            StyleMask::empty().nonactivating_panel().resizable()
        );
        assert_eq!(
            policy.collection_behavior,
            CollectionBehavior::from_raw(
                CollectionBehavior::new()
                    .full_screen_auxiliary()
                    .can_join_all_spaces()
                    .value()
                    | NSWindowCollectionBehavior::CanJoinAllApplications,
            )
        );
        assert!(!policy.hides_on_deactivate);
    }

    #[test]
    fn legacy_policy_keeps_fullscreen_auxiliary_fallback() {
        let policy = desired_policy(false);

        assert_eq!(
            policy.collection_behavior,
            CollectionBehavior::new()
                .full_screen_auxiliary()
                .can_join_all_spaces()
        );
    }
}
