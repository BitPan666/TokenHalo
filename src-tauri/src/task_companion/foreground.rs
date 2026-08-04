pub fn process_is_codex(bundle_identifier: Option<&str>, localized_name: Option<&str>) -> bool {
    let bundle_matches = bundle_identifier.is_some_and(|value| {
        matches!(
            value.to_ascii_lowercase().as_str(),
            "com.openai.codex" | "com.openai.codex.dev"
        )
    });
    let name_matches = localized_name.is_some_and(|value| {
        let value = value.trim();
        value.eq_ignore_ascii_case("codex") || value.eq_ignore_ascii_case("codex.exe")
    });
    bundle_matches || name_matches
}

#[cfg(target_os = "macos")]
pub fn is_codex_foreground() -> Option<bool> {
    use objc2_app_kit::NSWorkspace;

    let application = NSWorkspace::sharedWorkspace().frontmostApplication()?;
    let bundle_identifier = application
        .bundleIdentifier()
        .map(|value| value.to_string());
    let localized_name = application.localizedName().map(|value| value.to_string());
    Some(process_is_codex(
        bundle_identifier.as_deref(),
        localized_name.as_deref(),
    ))
}

#[cfg(target_os = "windows")]
pub fn is_codex_foreground() -> Option<bool> {
    use windows_sys::Win32::{
        Foundation::CloseHandle,
        System::Threading::{
            OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
        },
        UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId},
    };

    unsafe {
        let window = GetForegroundWindow();
        if window.is_null() {
            return None;
        }
        let mut process_id = 0;
        if GetWindowThreadProcessId(window, &mut process_id) == 0 || process_id == 0 {
            return None;
        }
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, process_id);
        if process.is_null() {
            return None;
        }
        let mut buffer = vec![0u16; 1024];
        let mut length = buffer.len() as u32;
        let success = QueryFullProcessImageNameW(process, 0, buffer.as_mut_ptr(), &mut length) != 0;
        let _ = CloseHandle(process);
        if !success {
            return None;
        }
        let path = String::from_utf16_lossy(&buffer[..length as usize]);
        let name = path.rsplit(['\\', '/']).next();
        Some(process_is_codex(None, name))
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub fn is_codex_foreground() -> Option<bool> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_codex_without_matching_similar_names() {
        assert!(process_is_codex(Some("com.openai.codex"), Some("Codex")));
        assert!(process_is_codex(None, Some("Codex")));
        assert!(!process_is_codex(None, Some("Codex Notes")));
        assert!(!process_is_codex(Some("example.codex-helper"), None));
    }
}
