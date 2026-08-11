use tauri::{LogicalSize, Manager, PhysicalPosition, WebviewWindow};

fn validate_frame(width: f64, height: f64) -> Result<(), String> {
    if !width.is_finite() || !height.is_finite() || width <= 0.0 || height <= 0.0 {
        return Err("task toast frame must have a positive finite size".into());
    }
    Ok(())
}

#[cfg(target_os = "macos")]
async fn apply_visible_frame(
    window: WebviewWindow,
    x: i32,
    y: i32,
    width: f64,
    height: f64,
) -> Result<(), String> {
    use objc2_app_kit::NSWindow;
    use objc2_foundation::{NSPoint, NSRect, NSSize};

    let current_position = window.outer_position().map_err(|error| error.to_string())?;
    let scale_factor = window.scale_factor().map_err(|error| error.to_string())?;
    let native_window = window.clone();
    let (sender, receiver) = tokio::sync::oneshot::channel();

    window
        .run_on_main_thread(move || {
            let result = (|| {
                let pointer = native_window
                    .ns_window()
                    .map_err(|error| error.to_string())?;
                let panel = unsafe {
                    pointer
                        .cast::<NSWindow>()
                        .as_ref()
                        .ok_or_else(|| "task toast native window is unavailable".to_string())?
                };
                let current_frame = panel.frame();
                let safe_scale = if scale_factor > 0.0 {
                    scale_factor
                } else {
                    1.0
                };
                let delta_x = f64::from(x - current_position.x) / safe_scale;
                let delta_y = f64::from(y - current_position.y) / safe_scale;
                let target_top = current_frame.origin.y + current_frame.size.height - delta_y;
                let target_frame = NSRect::new(
                    NSPoint::new(current_frame.origin.x + delta_x, target_top - height),
                    NSSize::new(width, height),
                );
                panel.setFrame_display(target_frame, true);
                Ok(())
            })();
            let _ = sender.send(result);
        })
        .map_err(|error| error.to_string())?;

    receiver
        .await
        .map_err(|_| "task toast frame update was cancelled".to_string())?
}

#[cfg(target_os = "windows")]
async fn apply_visible_frame(
    window: WebviewWindow,
    x: i32,
    y: i32,
    width: f64,
    height: f64,
) -> Result<(), String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, SWP_NOACTIVATE, SWP_NOOWNERZORDER, SWP_NOZORDER,
    };

    let scale_factor = window.scale_factor().map_err(|error| error.to_string())?;
    let hwnd = window.hwnd().map_err(|error| error.to_string())?;
    let physical_width = (width * scale_factor).round() as i32;
    let physical_height = (height * scale_factor).round() as i32;
    let succeeded = unsafe {
        SetWindowPos(
            hwnd.0,
            std::ptr::null_mut(),
            x,
            y,
            physical_width,
            physical_height,
            SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_NOZORDER,
        )
    };
    if succeeded == 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    Ok(())
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
async fn apply_visible_frame(
    window: WebviewWindow,
    x: i32,
    y: i32,
    width: f64,
    height: f64,
) -> Result<(), String> {
    window
        .set_size(LogicalSize::new(width, height))
        .map_err(|error| error.to_string())?;
    window
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn set_task_toast_frame(
    app: tauri::AppHandle,
    x: i32,
    y: i32,
    width: f64,
    height: f64,
) -> Result<(), String> {
    validate_frame(width, height)?;
    let window = app
        .get_webview_window("task-toast")
        .ok_or_else(|| "task toast window is unavailable".to_string())?;

    if !window.is_visible().map_err(|error| error.to_string())? {
        window
            .set_size(LogicalSize::new(width, height))
            .map_err(|error| error.to_string())?;
        return window
            .set_position(PhysicalPosition::new(x, y))
            .map_err(|error| error.to_string());
    }

    apply_visible_frame(window, x, y, width, height).await
}

#[cfg(target_os = "macos")]
async fn show_without_focus(app: &tauri::AppHandle) -> Result<(), String> {
    use tauri_nspanel::ManagerExt as _;

    let panel = app
        .get_webview_panel("task-toast")
        .map_err(|_| "task toast panel is unavailable".to_string())?;
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || {
        panel.show();
        let _ = sender.send(());
    })
    .map_err(|error| error.to_string())?;
    receiver
        .await
        .map_err(|_| "task toast show was cancelled".to_string())
}

#[cfg(target_os = "windows")]
async fn show_without_focus(app: &tauri::AppHandle) -> Result<(), String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOOWNERZORDER, SWP_NOSIZE, SWP_NOZORDER,
        SWP_SHOWWINDOW,
    };

    let window = app
        .get_webview_window("task-toast")
        .ok_or_else(|| "task toast window is unavailable".to_string())?;
    let hwnd = window.hwnd().map_err(|error| error.to_string())?;
    let succeeded = unsafe {
        SetWindowPos(
            hwnd.0,
            std::ptr::null_mut(),
            0,
            0,
            0,
            0,
            SWP_NOACTIVATE
                | SWP_NOMOVE
                | SWP_NOOWNERZORDER
                | SWP_NOSIZE
                | SWP_NOZORDER
                | SWP_SHOWWINDOW,
        )
    };
    if succeeded == 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    Ok(())
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
async fn show_without_focus(app: &tauri::AppHandle) -> Result<(), String> {
    app.get_webview_window("task-toast")
        .ok_or_else(|| "task toast window is unavailable".to_string())?
        .show()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn show_task_toast_without_focus(app: tauri::AppHandle) -> Result<(), String> {
    show_without_focus(&app).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_invalid_sizes_before_touching_the_native_window() {
        assert!(validate_frame(260.0, 96.0).is_ok());
        assert!(validate_frame(0.0, 96.0).is_err());
        assert!(validate_frame(f64::NAN, 96.0).is_err());
    }
}
