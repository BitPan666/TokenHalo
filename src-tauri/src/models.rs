use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageWindow {
    pub remaining_percent: f64,
    pub resets_at: Option<String>,
    pub window_seconds: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSnapshot {
    pub provider: String,
    pub display_name: String,
    pub plan: Option<String>,
    pub short_window: Option<UsageWindow>,
    pub weekly_window: Option<UsageWindow>,
    pub reset_credits: Option<u64>,
    pub reset_credit_expires_at: Vec<String>,
    pub updated_at: String,
    pub status: String,
    pub message: Option<String>,
}

impl ProviderSnapshot {
    pub fn failure(status: &str, message: &str) -> Self {
        Self {
            provider: "codex".into(),
            display_name: "CODEX".into(),
            plan: None,
            short_window: None,
            weekly_window: None,
            reset_credits: None,
            reset_credit_expires_at: Vec::new(),
            updated_at: chrono::Utc::now().to_rfc3339(),
            status: status.into(),
            message: Some(message.into()),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum ExpandedView {
    #[default]
    Quota,
    TokenStats,
}

fn default_glass_transparency() -> u8 {
    40
}

fn default_glass_blur_strength() -> u16 {
    40
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum GlassStyle {
    Clear,
    #[default]
    Regular,
}

impl<'de> Deserialize<'de> for GlassStyle {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        Ok(match value.as_str() {
            "clear" => Self::Clear,
            _ => Self::Regular,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetPreferences {
    pub locked: bool,
    #[serde(default = "default_always_on_top")]
    pub always_on_top: bool,
    pub pinned_provider: Option<String>,
    pub auto_rotate_seconds: u64,
    #[serde(default = "default_language")]
    pub language: String,
    #[serde(default)]
    pub expanded_view: ExpandedView,
    #[serde(default = "default_glass_transparency")]
    pub glass_transparency: u8,
    #[serde(default = "default_glass_blur_strength")]
    pub glass_blur_strength: u16,
    #[serde(default)]
    pub glass_style: GlassStyle,
}

fn default_always_on_top() -> bool {
    true
}
fn default_language() -> String {
    "zh-CN".into()
}

impl Default for WidgetPreferences {
    fn default() -> Self {
        Self {
            locked: false,
            always_on_top: true,
            pinned_provider: None,
            auto_rotate_seconds: 12,
            language: default_language(),
            expanded_view: ExpandedView::Quota,
            glass_transparency: default_glass_transparency(),
            glass_blur_strength: default_glass_blur_strength(),
            glass_style: GlassStyle::Regular,
        }
    }
}

impl WidgetPreferences {
    pub fn normalized(mut self) -> Self {
        self.auto_rotate_seconds = self.auto_rotate_seconds.clamp(5, 300);
        if self.pinned_provider.as_deref() != Some("codex") {
            self.pinned_provider = None;
        }
        if self.language != "en" && self.language != "zh-CN" {
            self.language = default_language();
        }
        self.glass_transparency = self.glass_transparency.clamp(10, 90);
        self.glass_blur_strength = self.glass_blur_strength.min(60);
        self
    }
}

#[cfg(test)]
mod preference_tests {
    use super::*;

    #[test]
    fn old_preferences_receive_new_defaults() {
        let raw = r#"{
          "locked": false,
          "alwaysOnTop": true,
          "pinnedProvider": null,
          "autoRotateSeconds": 12,
          "language": "zh-CN"
        }"#;
        let value: WidgetPreferences = serde_json::from_str(raw).unwrap();
        assert_eq!(value.expanded_view, ExpandedView::Quota);
        assert_eq!(value.glass_transparency, 40);
        assert_eq!(value.glass_blur_strength, 40);
        assert_eq!(value.glass_style, GlassStyle::Regular);
    }

    #[test]
    fn appearance_values_are_clamped() {
        let value = WidgetPreferences {
            glass_transparency: 100,
            glass_blur_strength: 999,
            ..WidgetPreferences::default()
        }
        .normalized();
        assert_eq!(value.glass_transparency, 90);
        assert_eq!(value.glass_blur_strength, 60);
    }

    #[test]
    fn unknown_glass_style_falls_back_without_discarding_other_preferences() {
        let raw = r#"{
          "locked": true,
          "alwaysOnTop": false,
          "pinnedProvider": null,
          "autoRotateSeconds": 18,
          "language": "en",
          "glassStyle": "futureStyle"
        }"#;
        let value: WidgetPreferences = serde_json::from_str(raw).unwrap();

        assert!(value.locked);
        assert!(!value.always_on_top);
        assert_eq!(value.auto_rotate_seconds, 18);
        assert_eq!(value.language, "en");
        assert_eq!(value.glass_style, GlassStyle::Regular);
    }
}
