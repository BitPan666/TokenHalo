use std::sync::{
    atomic::{AtomicU8, Ordering},
    Arc, Mutex,
};

use objc2::MainThreadMarker;
use objc2_app_kit::{
    NSColor, NSGlassEffectView, NSGlassEffectViewStyle, NSView, NSVisualEffectBlendingMode,
    NSVisualEffectMaterial, NSVisualEffectState, NSVisualEffectView, NSWindowOrderingMode,
};
use objc2_foundation::{NSPoint, NSProcessInfo, NSRect, NSSize};
use serde::{Deserialize, Serialize};
use window_vibrancy::{NSGlassEffectViewTagged, NSVisualEffectViewTagged};

use crate::models::{GlassStyle, WidgetPreferences};

const NATIVE_GLASS_TAG: isize = 84_210_726;
static CURRENT_MODE: AtomicU8 = AtomicU8::new(NativeGlassMode::Compact as u8);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum GlassBackend {
    CssFallback,
    LiquidGlass,
    Vibrancy,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
#[repr(u8)]
pub enum NativeGlassMode {
    Compact,
    Quota,
    Stats,
}

fn current_mode() -> NativeGlassMode {
    match CURRENT_MODE.load(Ordering::Relaxed) {
        value if value == NativeGlassMode::Quota as u8 => NativeGlassMode::Quota,
        value if value == NativeGlassMode::Stats as u8 => NativeGlassMode::Stats,
        _ => NativeGlassMode::Compact,
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct GlassGeometry {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    radius: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LegacyMaterial {
    Sidebar,
    Popover,
    HudWindow,
}

fn geometry(mode: NativeGlassMode) -> GlassGeometry {
    match mode {
        NativeGlassMode::Compact => GlassGeometry {
            x: 10.0,
            y: 10.0,
            width: 80.0,
            height: 80.0,
            radius: 28.0,
        },
        NativeGlassMode::Quota => GlassGeometry {
            x: 0.0,
            y: 0.0,
            width: 320.0,
            height: 320.0,
            radius: 40.0,
        },
        NativeGlassMode::Stats => GlassGeometry {
            x: 0.0,
            y: 0.0,
            width: 400.0,
            height: 400.0,
            radius: 40.0,
        },
    }
}

fn strength_factor(value: u16) -> f64 {
    if value < 30 {
        0.32
    } else if value < 50 {
        0.48
    } else {
        0.64
    }
}

fn tint_alpha(preferences: &WidgetPreferences) -> f64 {
    let opacity = f64::from(100 - preferences.glass_transparency) / 100.0;
    let style_factor = match preferences.glass_style {
        GlassStyle::Clear => 0.85,
        GlassStyle::Regular => 1.0,
    };
    (opacity * strength_factor(preferences.glass_blur_strength) * style_factor).clamp(0.03, 0.58)
}

fn legacy_material(preferences: &WidgetPreferences) -> LegacyMaterial {
    if preferences.glass_blur_strength < 30 {
        LegacyMaterial::Sidebar
    } else if preferences.glass_blur_strength < 50 {
        LegacyMaterial::Popover
    } else {
        LegacyMaterial::HudWindow
    }
}

fn liquid_glass_available() -> bool {
    NSProcessInfo::processInfo()
        .operatingSystemVersion()
        .majorVersion
        >= 26
}

pub fn appearance_changed(previous: &WidgetPreferences, next: &WidgetPreferences) -> bool {
    previous.glass_transparency != next.glass_transparency
        || previous.glass_blur_strength != next.glass_blur_strength
        || previous.glass_style != next.glass_style
}

pub fn apply(window: &tauri::WebviewWindow, preferences: &WidgetPreferences) -> GlassBackend {
    apply_mode(window, preferences, current_mode())
}

pub fn apply_mode(
    window: &tauri::WebviewWindow,
    preferences: &WidgetPreferences,
    mode: NativeGlassMode,
) -> GlassBackend {
    CURRENT_MODE.store(mode as u8, Ordering::Relaxed);
    let preferred_backend = if liquid_glass_available() {
        GlassBackend::LiquidGlass
    } else {
        GlassBackend::Vibrancy
    };
    let preferences = preferences.clone();
    let outcome = Arc::new(Mutex::new(None));
    let callback_outcome = Arc::clone(&outcome);

    if window
        .with_webview(move |webview| {
            let applied = unsafe {
                apply_to_webview(
                    webview.inner().cast(),
                    &preferences,
                    mode,
                    preferred_backend,
                )
            };
            if let Err(error) = &applied {
                eprintln!("native glass fallback: {error}");
            }
            if let Ok(mut slot) = callback_outcome.lock() {
                *slot = Some(if applied.is_ok() {
                    preferred_backend
                } else {
                    GlassBackend::CssFallback
                });
            }
        })
        .is_err()
    {
        return GlassBackend::CssFallback;
    }

    outcome
        .lock()
        .ok()
        .and_then(|value| *value)
        .unwrap_or(preferred_backend)
}

unsafe fn apply_to_webview(
    webview_pointer: *mut std::ffi::c_void,
    preferences: &WidgetPreferences,
    mode: NativeGlassMode,
    backend: GlassBackend,
) -> Result<(), &'static str> {
    let mtm = MainThreadMarker::new().ok_or("native glass requires the main thread")?;
    let webview = webview_pointer
        .cast::<NSView>()
        .as_ref()
        .ok_or("WKWebView is unavailable")?;
    let container = webview
        .superview()
        .ok_or("WKWebView container is unavailable")?;

    if let Some(existing) = container.viewWithTag(NATIVE_GLASS_TAG) {
        existing.removeFromSuperview();
    }

    let geometry = geometry(mode);
    let frame = NSRect::new(
        NSPoint::new(geometry.x, geometry.y),
        NSSize::new(geometry.width, geometry.height),
    );

    match backend {
        GlassBackend::LiquidGlass => {
            let glass =
                NSGlassEffectViewTagged::initWithFrame(mtm.alloc(), frame, NATIVE_GLASS_TAG);
            glass.setStyle(match preferences.glass_style {
                GlassStyle::Clear => NSGlassEffectViewStyle::Clear,
                GlassStyle::Regular => NSGlassEffectViewStyle::Regular,
            });
            glass.setCornerRadius(geometry.radius);
            let tint = NSColor::colorWithSRGBRed_green_blue_alpha(
                0.84,
                0.93,
                0.99,
                tint_alpha(preferences),
            );
            glass.setTintColor(Some(&tint));
            let glass_effect: &NSGlassEffectView = glass.as_ref();
            let glass_view: &NSView = glass_effect.as_ref();
            container.addSubview_positioned_relativeTo(
                glass_view,
                NSWindowOrderingMode::Below,
                Some(webview),
            );
        }
        GlassBackend::Vibrancy => {
            let glass =
                NSVisualEffectViewTagged::initWithFrame(mtm.alloc(), frame, NATIVE_GLASS_TAG);
            glass.setMaterial(match legacy_material(preferences) {
                LegacyMaterial::Sidebar => NSVisualEffectMaterial::Sidebar,
                LegacyMaterial::Popover => NSVisualEffectMaterial::Popover,
                LegacyMaterial::HudWindow => NSVisualEffectMaterial::HUDWindow,
            });
            glass.setBlendingMode(NSVisualEffectBlendingMode::BehindWindow);
            glass.setState(NSVisualEffectState::Active);
            glass.setWantsLayer(true);
            if let Some(layer) = glass.layer() {
                layer.setCornerRadius(geometry.radius);
                layer.setMasksToBounds(true);
            }
            let visual_effect: &NSVisualEffectView = glass.as_ref();
            let glass_view: &NSView = visual_effect.as_ref();
            container.addSubview_positioned_relativeTo(
                glass_view,
                NSWindowOrderingMode::Below,
                Some(webview),
            );
        }
        GlassBackend::CssFallback => return Err("native backend unavailable"),
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_payload_contains_only_the_backend_name() {
        assert_eq!(
            serde_json::to_string(&GlassBackend::CssFallback).unwrap(),
            r#""cssFallback""#
        );
        assert_eq!(
            serde_json::to_string(&GlassBackend::LiquidGlass).unwrap(),
            r#""liquidGlass""#
        );
        assert_eq!(
            serde_json::to_string(&GlassBackend::Vibrancy).unwrap(),
            r#""vibrancy""#
        );
    }

    #[test]
    fn only_native_appearance_preferences_trigger_reapplication() {
        let original = WidgetPreferences::default();
        assert!(!appearance_changed(
            &original,
            &WidgetPreferences {
                language: "en".into(),
                ..original.clone()
            }
        ));
        assert!(!appearance_changed(
            &original,
            &WidgetPreferences {
                locked: true,
                ..original.clone()
            }
        ));
        assert!(appearance_changed(
            &original,
            &WidgetPreferences {
                glass_transparency: 41,
                ..original.clone()
            }
        ));
        assert!(appearance_changed(
            &original,
            &WidgetPreferences {
                glass_blur_strength: 41,
                ..original.clone()
            }
        ));
        assert!(appearance_changed(
            &original,
            &WidgetPreferences {
                glass_style: crate::models::GlassStyle::Clear,
                ..original.clone()
            }
        ));
    }

    #[test]
    fn each_widget_mode_maps_to_the_card_frame_and_radius() {
        assert_eq!(
            geometry(NativeGlassMode::Compact),
            GlassGeometry {
                x: 10.0,
                y: 10.0,
                width: 80.0,
                height: 80.0,
                radius: 28.0,
            }
        );
        assert_eq!(
            geometry(NativeGlassMode::Quota),
            GlassGeometry {
                x: 0.0,
                y: 0.0,
                width: 320.0,
                height: 320.0,
                radius: 40.0,
            }
        );
        assert_eq!(
            geometry(NativeGlassMode::Stats),
            GlassGeometry {
                x: 0.0,
                y: 0.0,
                width: 400.0,
                height: 400.0,
                radius: 40.0,
            }
        );
    }

    #[test]
    fn tint_alpha_uses_transparency_strength_and_style() {
        let mut preferences = WidgetPreferences::default();
        preferences.glass_transparency = 40;
        preferences.glass_blur_strength = 40;
        assert!((tint_alpha(&preferences) - 0.288).abs() < 0.000_001);

        preferences.glass_style = crate::models::GlassStyle::Clear;
        assert!((tint_alpha(&preferences) - 0.2448).abs() < 0.000_001);
    }

    #[test]
    fn legacy_material_tracks_effect_strength() {
        let mut preferences = WidgetPreferences::default();
        preferences.glass_blur_strength = 20;
        assert_eq!(legacy_material(&preferences), LegacyMaterial::Sidebar);
        preferences.glass_blur_strength = 40;
        assert_eq!(legacy_material(&preferences), LegacyMaterial::Popover);
        preferences.glass_blur_strength = 60;
        assert_eq!(legacy_material(&preferences), LegacyMaterial::HudWindow);
    }
}
