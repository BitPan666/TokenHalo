use std::{
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    time::SystemTime,
};

use serde_json::Value;
use walkdir::WalkDir;

use super::models::TaskEventStatus;

const MAX_SESSION_CANDIDATES: usize = 64;
const MAX_TAIL_BYTES: u64 = 256 * 1024;

fn normalized_marker(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(|value| value.trim().to_ascii_lowercase().replace(['-', ' '], "_"))
}

pub fn explicit_outcome(value: &Value) -> Option<TaskEventStatus> {
    let payload = value.get("payload").and_then(Value::as_object);
    let markers = [
        normalized_marker(value.get("status")),
        normalized_marker(value.get("type")),
        normalized_marker(payload.and_then(|payload| payload.get("status"))),
        normalized_marker(payload.and_then(|payload| payload.get("type"))),
    ];
    for marker in markers.into_iter().flatten() {
        match marker.as_str() {
            "completed" | "complete" | "task_complete" | "turn_complete" | "turn_completed" => {
                return Some(TaskEventStatus::Completed);
            }
            "failed" | "turn_failed" | "task_failed" => return Some(TaskEventStatus::Failed),
            "interrupted" | "aborted" | "turn_aborted" | "turn_interrupted" => {
                return Some(TaskEventStatus::Interrupted);
            }
            _ => {}
        }
    }
    None
}

fn starts_new_turn(value: &Value) -> bool {
    let payload_type = value.get("payload").and_then(|payload| payload.get("type"));
    [
        normalized_marker(value.get("type")),
        normalized_marker(payload_type),
    ]
    .into_iter()
    .flatten()
    .any(|marker| {
        matches!(
            marker.as_str(),
            "turn_started" | "task_started" | "user_message" | "user_prompt"
        )
    })
}

fn candidate_paths(sessions_root: &Path, thread_id: &str) -> Vec<PathBuf> {
    let mut paths: Vec<(SystemTime, PathBuf)> = WalkDir::new(sessions_root)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_file())
        .filter(|entry| entry.file_name().to_string_lossy().contains(thread_id))
        .filter_map(|entry| {
            let modified = entry.metadata().ok()?.modified().ok()?;
            Some((modified, entry.into_path()))
        })
        .collect();
    paths.sort_by(|left, right| right.0.cmp(&left.0));
    paths
        .into_iter()
        .take(MAX_SESSION_CANDIDATES)
        .map(|(_, path)| path)
        .collect()
}

fn read_bounded_tail(path: &Path) -> Option<String> {
    let mut file = File::open(path).ok()?;
    let length = file.metadata().ok()?.len();
    let start = length.saturating_sub(MAX_TAIL_BYTES);
    file.seek(SeekFrom::Start(start)).ok()?;
    let mut bytes = Vec::with_capacity((length - start) as usize);
    file.take(MAX_TAIL_BYTES).read_to_end(&mut bytes).ok()?;
    if start > 0 {
        let first_line_end = bytes.iter().position(|byte| *byte == b'\n')? + 1;
        bytes.drain(..first_line_end);
    }
    String::from_utf8(bytes).ok()
}

pub fn resolve_explicit_outcome(sessions_root: &Path, thread_id: &str) -> Option<TaskEventStatus> {
    for path in candidate_paths(sessions_root, thread_id) {
        let Some(tail) = read_bounded_tail(&path) else {
            continue;
        };
        for line in tail.lines().rev() {
            let Ok(value) = serde_json::from_str::<Value>(line) else {
                continue;
            };
            if let Some(outcome) = explicit_outcome(&value) {
                return Some(outcome);
            }
            if starts_new_turn(&value) {
                return None;
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn maps_only_explicit_terminal_outcomes() {
        assert_eq!(
            explicit_outcome(&json!({"type":"event_msg","payload":{"type":"task_complete"}})),
            Some(TaskEventStatus::Completed),
        );
        assert_eq!(
            explicit_outcome(&json!({"type":"turn","status":"failed"})),
            Some(TaskEventStatus::Failed),
        );
        assert_eq!(
            explicit_outcome(&json!({"type":"event_msg","payload":{"type":"turn_aborted"}})),
            Some(TaskEventStatus::Interrupted),
        );
    }

    #[test]
    fn ignores_ambiguous_content_and_unrelated_errors() {
        assert_eq!(
            explicit_outcome(&json!({"type":"assistant_message","text":"done"})),
            None
        );
        assert_eq!(
            explicit_outcome(&json!({"type":"event_msg","payload":{"type":"error"}})),
            None
        );
        assert_eq!(explicit_outcome(&json!({"status":"success"})), None);
    }

    #[test]
    fn reads_only_a_matching_session_and_stops_at_a_new_turn_boundary() {
        let root = tempfile::tempdir().unwrap();
        let matching = root.path().join("rollout-thread-one.jsonl");
        std::fs::write(
            &matching,
            concat!(
                "{\"type\":\"event_msg\",\"payload\":{\"type\":\"task_complete\"}}\n",
                "{\"type\":\"event_msg\",\"payload\":{\"type\":\"user_message\"}}\n",
                "{\"type\":\"assistant_message\"}\n",
            ),
        )
        .unwrap();
        assert_eq!(resolve_explicit_outcome(root.path(), "thread-one"), None);

        std::fs::write(
            matching,
            concat!(
                "{\"type\":\"event_msg\",\"payload\":{\"type\":\"user_message\"}}\n",
                "{\"type\":\"event_msg\",\"payload\":{\"type\":\"task_complete\"}}\n",
            ),
        )
        .unwrap();
        assert_eq!(
            resolve_explicit_outcome(root.path(), "thread-one"),
            Some(TaskEventStatus::Completed),
        );
    }
}
