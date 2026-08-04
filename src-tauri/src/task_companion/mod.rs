pub mod foreground;
pub mod hook;
pub mod inbox;
pub mod integration;
pub mod models;
pub mod reconcile;

use std::{fs, path::PathBuf, time::Duration};

use tauri::{AppHandle, Emitter};

pub fn start_watcher(
    app: AppHandle,
    inbox_path: PathBuf,
    health_path: PathBuf,
    sessions_root: PathBuf,
) {
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_millis(350));
        loop {
            interval.tick().await;
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
