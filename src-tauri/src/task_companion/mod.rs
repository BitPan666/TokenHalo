pub mod foreground;
pub mod hook;
pub mod inbox;
pub mod integration;
pub mod models;
pub mod reconcile;
pub mod session_observer;

use std::{fs, path::PathBuf, time::Duration};

use tauri::{AppHandle, Emitter};

pub fn start_watcher(
    app: AppHandle,
    inbox_path: PathBuf,
    health_path: PathBuf,
    sessions_root: PathBuf,
    enabled_path: PathBuf,
) {
    tauri::async_runtime::spawn(async move {
        let mut session_observer = session_observer::SessionObserver::new(sessions_root.clone());
        let mut interval = tokio::time::interval(Duration::from_millis(600));
        loop {
            interval.tick().await;
            let session_events = session_observer.poll();
            if enabled_path.exists() {
                for event in session_events {
                    let _ = app.emit_to("widget", "task-companion-event", event);
                }
            }
            if let Ok(batch) = inbox::drain_batch(&inbox_path, &sessions_root) {
                if batch.health_observed {
                    if let Some(parent) = health_path.parent() {
                        let _ = fs::create_dir_all(parent);
                    }
                    let _ = fs::write(&health_path, chrono::Utc::now().to_rfc3339());
                }
                for event in batch.events {
                    let _ = app.emit_to("widget", "task-companion-event", event);
                }
            }
        }
    });
}
