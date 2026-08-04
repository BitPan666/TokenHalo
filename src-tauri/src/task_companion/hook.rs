use std::{
    collections::hash_map::DefaultHasher,
    fs,
    hash::{Hash, Hasher},
    io::{self, Read, Write},
    path::{Path, PathBuf},
};

use serde_json::Value;

use super::models::{HookRecord, HookSignal};

const MAX_HOOK_INPUT_BYTES: u64 = 1024 * 1024;

fn stable_event_id(
    event_name: &str,
    thread_id: &str,
    turn_id: Option<&str>,
    occurred_at: &str,
) -> String {
    let mut hasher = DefaultHasher::new();
    event_name.hash(&mut hasher);
    thread_id.hash(&mut hasher);
    turn_id.hash(&mut hasher);
    occurred_at.hash(&mut hasher);
    format!("hook-{:016x}", hasher.finish())
}

fn project_name(value: &Value) -> Option<String> {
    let cwd = value.get("cwd")?.as_str()?;
    Path::new(cwd)
        .file_name()
        .and_then(|name| name.to_str())
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(ToOwned::to_owned)
}

pub(crate) fn record_from_input(
    event_name: &str,
    raw: &str,
    occurred_at: &str,
) -> Result<HookRecord, String> {
    let value: Value = serde_json::from_str(raw).map_err(|_| "invalid hook input".to_string())?;
    let thread_id = value
        .get("session_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "hook input is missing session id".to_string())?;
    let turn_id = value
        .get("turn_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);
    let status = match event_name {
        "UserPromptSubmit" => HookSignal::Working,
        "PermissionRequest" => HookSignal::NeedsInput,
        "Stop" => HookSignal::TerminalCandidate,
        "Health" => HookSignal::Health,
        _ => return Err("unsupported hook event".to_string()),
    };

    Ok(HookRecord {
        schema_version: 1,
        event_id: stable_event_id(event_name, thread_id, turn_id.as_deref(), occurred_at),
        thread_id: thread_id.to_owned(),
        turn_id,
        status,
        occurred_at: occurred_at.to_owned(),
        project_name: project_name(&value),
        duration_ms: None,
        source: "codexHook".to_string(),
    })
}

pub(crate) fn write_record(directory: &Path, record: &HookRecord) -> Result<PathBuf, String> {
    fs::create_dir_all(directory).map_err(|_| "failed to create task inbox".to_string())?;
    let final_path = directory.join(format!("{}.json", record.event_id));
    let temporary_path = directory.join(format!("{}.tmp", record.event_id));
    let serialized =
        serde_json::to_vec(record).map_err(|_| "failed to serialize task event".to_string())?;
    let mut file =
        fs::File::create(&temporary_path).map_err(|_| "failed to create task event".to_string())?;
    file.write_all(&serialized)
        .and_then(|_| file.sync_all())
        .map_err(|_| "failed to write task event".to_string())?;
    fs::rename(&temporary_path, &final_path)
        .map_err(|_| "failed to commit task event".to_string())?;
    Ok(final_path)
}

pub fn run_from_process_args() -> Option<Result<(), String>> {
    let arguments: Vec<String> = std::env::args().collect();
    let hook_index = arguments.iter().position(|value| value == "--task-hook")?;
    let event_name = match arguments.get(hook_index + 1) {
        Some(value) => value,
        None => return Some(Err("missing task hook event".to_string())),
    };
    let inbox_index = match arguments.iter().position(|value| value == "--inbox") {
        Some(value) => value,
        None => return Some(Err("missing task inbox".to_string())),
    };
    let inbox = match arguments.get(inbox_index + 1) {
        Some(value) => PathBuf::from(value),
        None => return Some(Err("missing task inbox path".to_string())),
    };
    let mut raw = String::new();
    if let Err(error) = io::stdin()
        .take(MAX_HOOK_INPUT_BYTES)
        .read_to_string(&mut raw)
    {
        return Some(Err(format!("failed to read hook input: {error}")));
    }
    let occurred_at = chrono::Utc::now().to_rfc3339();
    let _ = record_from_input(event_name, &raw, &occurred_at).and_then(|record| {
        write_record(&inbox, &record)?;
        let health = record_from_input("Health", &raw, &occurred_at)?;
        write_record(&inbox, &health)?;
        Ok(())
    });
    if event_name == "Stop" {
        println!("{{}}");
    }
    Some(Ok(()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const NOW: &str = "2026-08-04T10:00:00Z";

    #[test]
    fn prompt_submit_becomes_working_without_persisting_prompt_or_absolute_path() {
        let raw = json!({
            "session_id": "thread-one",
            "turn_id": "turn-one",
            "cwd": "/Users/private/work/TokenHalo",
            "hook_event_name": "UserPromptSubmit",
            "prompt": "secret prompt"
        });

        let record = record_from_input("UserPromptSubmit", &raw.to_string(), NOW).unwrap();
        let serialized = serde_json::to_string(&record).unwrap();

        assert_eq!(record.status, HookSignal::Working);
        assert_eq!(record.thread_id, "thread-one");
        assert_eq!(record.turn_id.as_deref(), Some("turn-one"));
        assert_eq!(record.project_name.as_deref(), Some("TokenHalo"));
        for forbidden in [
            "secret prompt",
            "/Users/private",
            "prompt",
            "cwd",
            "transcript_path",
        ] {
            assert!(!serialized.contains(forbidden));
        }
    }

    #[test]
    fn permission_request_becomes_needs_input_and_stop_stays_unclassified() {
        let permission = record_from_input(
            "PermissionRequest",
            r#"{"session_id":"thread-one","turn_id":"turn-one","cwd":"/tmp/project","tool_input":{"command":"secret"}}"#,
            NOW,
        )
        .unwrap();
        let stop = record_from_input(
            "Stop",
            r#"{"session_id":"thread-one","turn_id":"turn-one","cwd":"/tmp/project","last_assistant_message":"secret"}"#,
            NOW,
        )
        .unwrap();

        assert_eq!(permission.status, HookSignal::NeedsInput);
        assert_eq!(stop.status, HookSignal::TerminalCandidate);
        assert!(!serde_json::to_string(&permission)
            .unwrap()
            .contains("command"));
        assert!(!serde_json::to_string(&stop).unwrap().contains("assistant"));
    }

    #[test]
    fn malformed_or_identifier_free_input_is_rejected() {
        assert!(record_from_input("UserPromptSubmit", "not json", NOW).is_err());
        assert!(record_from_input("UserPromptSubmit", r#"{"cwd":"/tmp/project"}"#, NOW).is_err());
        assert!(record_from_input("Unknown", r#"{"session_id":"thread"}"#, NOW).is_err());
    }

    #[test]
    fn event_ids_are_deterministic_and_atomic_writes_leave_one_final_file() {
        let raw = r#"{"session_id":"thread-one","turn_id":"turn-one","cwd":"/tmp/project"}"#;
        let first = record_from_input("UserPromptSubmit", raw, NOW).unwrap();
        let second = record_from_input("UserPromptSubmit", raw, NOW).unwrap();
        assert_eq!(first.event_id, second.event_id);

        let directory = tempfile::tempdir().unwrap();
        let path = write_record(directory.path(), &first).unwrap();
        assert!(path.exists());
        assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 1);
        let round_trip: HookRecord = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
        assert_eq!(round_trip, first);
    }
}
