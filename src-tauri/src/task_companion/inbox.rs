use std::{
    fs,
    path::{Path, PathBuf},
};

use super::models::{HookRecord, HookSignal, TaskCompanionEvent, TaskEventStatus};

pub const MAX_INBOX_FILE_BYTES: usize = 64 * 1024;
const MAX_STARTUP_REPLAY_FILES: usize = 128;

#[derive(Debug, Default)]
pub struct DrainBatch {
    pub events: Vec<TaskCompanionEvent>,
    pub health_observed: bool,
}

pub fn normalize_record(record: HookRecord) -> Result<Option<TaskCompanionEvent>, String> {
    normalize_record_with_outcome(record, None)
}

fn normalize_record_with_outcome(
    record: HookRecord,
    terminal_outcome: Option<TaskEventStatus>,
) -> Result<Option<TaskCompanionEvent>, String> {
    if record.schema_version != 1 || record.event_id.is_empty() || record.thread_id.is_empty() {
        return Err("invalid task event schema".to_string());
    }
    let status = match record.status {
        HookSignal::Working => TaskEventStatus::Working,
        HookSignal::NeedsInput => TaskEventStatus::NeedsInput,
        HookSignal::TerminalCandidate => terminal_outcome
            .clone()
            .unwrap_or(TaskEventStatus::Interrupted),
        HookSignal::Health => return Ok(None),
    };
    let source = if terminal_outcome.is_some() {
        "sessionReconciliation".to_string()
    } else {
        record.source
    };
    Ok(Some(TaskCompanionEvent {
        schema_version: 1,
        event_id: record.event_id,
        thread_id: record.thread_id,
        turn_id: record.turn_id,
        status,
        occurred_at: record.occurred_at,
        project_name: record.project_name,
        task_title: None,
        duration_ms: record.duration_ms,
        source,
    }))
}

fn inbox_paths(directory: &Path) -> Result<Vec<PathBuf>, String> {
    if !directory.exists() {
        return Ok(Vec::new());
    }
    let mut paths: Vec<PathBuf> = fs::read_dir(directory)
        .map_err(|_| "failed to read task inbox".to_string())?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(|value| value.to_str()) == Some("json"))
        .collect();
    paths.sort();
    if paths.len() > MAX_STARTUP_REPLAY_FILES {
        let excess = paths.len() - MAX_STARTUP_REPLAY_FILES;
        for path in paths.drain(..excess) {
            let _ = fs::remove_file(path);
        }
    }
    Ok(paths)
}

fn read_record(path: &Path) -> Option<HookRecord> {
    fs::metadata(path)
        .ok()
        .filter(|metadata| metadata.len() <= MAX_INBOX_FILE_BYTES as u64)
        .and_then(|_| fs::read(path).ok())
        .and_then(|bytes| serde_json::from_slice::<HookRecord>(&bytes).ok())
}

pub fn drain(directory: &Path) -> Result<Vec<TaskCompanionEvent>, String> {
    let mut events = Vec::new();
    for path in inbox_paths(directory)? {
        if let Some(record) = read_record(&path) {
            if let Ok(Some(event)) = normalize_record(record) {
                events.push(event);
            }
        }
        let _ = fs::remove_file(path);
    }
    Ok(events)
}

pub fn drain_batch(directory: &Path, sessions_root: &Path) -> Result<DrainBatch, String> {
    let mut batch = DrainBatch::default();
    for path in inbox_paths(directory)? {
        if let Some(record) = read_record(&path) {
            if record.status == HookSignal::Health {
                if normalize_record(record).is_ok() {
                    batch.health_observed = true;
                }
            } else {
                let outcome = if record.status == HookSignal::TerminalCandidate {
                    super::reconcile::resolve_explicit_outcome(sessions_root, &record.thread_id)
                } else {
                    None
                };
                if let Ok(Some(event)) = normalize_record_with_outcome(record, outcome) {
                    batch.health_observed = true;
                    batch.events.push(event);
                }
            }
        }
        let _ = fs::remove_file(path);
    }
    Ok(batch)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::task_companion::models::{HookRecord, HookSignal};

    fn record(status: HookSignal) -> HookRecord {
        HookRecord {
            schema_version: 1,
            event_id: "event-one".into(),
            thread_id: "thread-one".into(),
            turn_id: Some("turn-one".into()),
            status,
            occurred_at: "2026-08-04T10:00:00Z".into(),
            project_name: Some("TokenHalo".into()),
            duration_ms: None,
            source: "codexHook".into(),
        }
    }

    #[test]
    fn consumes_allowlisted_events_and_clears_ambiguous_terminal_candidates() {
        let working = normalize_record(record(HookSignal::Working))
            .unwrap()
            .unwrap();
        let waiting = normalize_record(record(HookSignal::NeedsInput))
            .unwrap()
            .unwrap();
        let terminal = normalize_record(record(HookSignal::TerminalCandidate))
            .unwrap()
            .unwrap();
        assert_eq!(working.status, TaskEventStatus::Working);
        assert_eq!(waiting.status, TaskEventStatus::NeedsInput);
        assert_eq!(terminal.status, TaskEventStatus::Interrupted);
    }

    #[test]
    fn drains_valid_json_and_removes_malformed_or_oversized_files() {
        let directory = tempfile::tempdir().unwrap();
        std::fs::write(
            directory.path().join("valid.json"),
            serde_json::to_vec(&record(HookSignal::Working)).unwrap(),
        )
        .unwrap();
        std::fs::write(directory.path().join("bad.json"), "not json").unwrap();
        std::fs::write(
            directory.path().join("large.json"),
            vec![b'x'; MAX_INBOX_FILE_BYTES + 1],
        )
        .unwrap();

        let events = drain(directory.path()).unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 0);
    }

    #[test]
    fn reports_a_consumed_health_event_without_emitting_task_content() {
        let directory = tempfile::tempdir().unwrap();
        let sessions = tempfile::tempdir().unwrap();
        std::fs::write(
            directory.path().join("health.json"),
            serde_json::to_vec(&record(HookSignal::Health)).unwrap(),
        )
        .unwrap();

        let batch = drain_batch(directory.path(), sessions.path()).unwrap();
        assert!(batch.health_observed);
        assert!(batch.events.is_empty());
    }

    #[test]
    fn treats_a_real_hook_event_as_connection_health() {
        let directory = tempfile::tempdir().unwrap();
        let sessions = tempfile::tempdir().unwrap();
        std::fs::write(
            directory.path().join("working.json"),
            serde_json::to_vec(&record(HookSignal::Working)).unwrap(),
        )
        .unwrap();

        let batch = drain_batch(directory.path(), sessions.path()).unwrap();
        assert!(batch.health_observed);
        assert_eq!(batch.events.len(), 1);
    }

    #[test]
    fn reconciles_a_terminal_candidate_only_from_an_explicit_outcome() {
        let directory = tempfile::tempdir().unwrap();
        let sessions = tempfile::tempdir().unwrap();
        std::fs::write(
            sessions.path().join("rollout-thread-one.jsonl"),
            "{\"type\":\"event_msg\",\"payload\":{\"type\":\"task_complete\"}}\n",
        )
        .unwrap();
        std::fs::write(
            directory.path().join("terminal.json"),
            serde_json::to_vec(&record(HookSignal::TerminalCandidate)).unwrap(),
        )
        .unwrap();

        let batch = drain_batch(directory.path(), sessions.path()).unwrap();
        assert_eq!(batch.events[0].status, TaskEventStatus::Completed);
        assert_eq!(batch.events[0].source, "sessionReconciliation");
    }
}
