use std::{
    collections::HashMap,
    fs::{self, File},
    io::{BufRead, BufReader, Seek, SeekFrom},
    path::{Path, PathBuf},
};

use serde_json::Value;
use walkdir::WalkDir;

use super::models::{TaskCompanionEvent, TaskEventStatus};

const MAX_LINE_BYTES: usize = 2 * 1024 * 1024;
const TITLE_LIMIT: usize = 56;

#[derive(Debug, Default)]
struct ActiveTurn {
    id: String,
    started_at: String,
    task_title: Option<String>,
}

#[derive(Debug, Default)]
struct ObservedSession {
    offset: u64,
    thread_id: Option<String>,
    project_name: Option<String>,
    active_turn: Option<ActiveTurn>,
}

#[derive(Debug)]
pub struct SessionObserver {
    sessions_root: PathBuf,
    files: HashMap<PathBuf, ObservedSession>,
}

impl SessionObserver {
    pub fn new(sessions_root: PathBuf) -> Self {
        let mut files = HashMap::new();
        for path in session_paths(&sessions_root) {
            let offset = fs::metadata(&path)
                .map(|metadata| metadata.len())
                .unwrap_or(0);
            files.insert(
                path.clone(),
                ObservedSession {
                    offset,
                    thread_id: thread_id_from_path(&path),
                    ..ObservedSession::default()
                },
            );
        }
        Self {
            sessions_root,
            files,
        }
    }

    pub fn poll(&mut self) -> Vec<TaskCompanionEvent> {
        let mut events = Vec::new();
        for path in session_paths(&self.sessions_root) {
            let session = self
                .files
                .entry(path.clone())
                .or_insert_with(|| ObservedSession {
                    thread_id: thread_id_from_path(&path),
                    ..ObservedSession::default()
                });
            events.extend(read_appended(&path, session));
        }
        events
    }
}

fn session_paths(root: &Path) -> Vec<PathBuf> {
    if !root.exists() {
        return Vec::new();
    }
    WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_file())
        .map(|entry| entry.into_path())
        .filter(|path| path.extension().and_then(|value| value.to_str()) == Some("jsonl"))
        .collect()
}

fn thread_id_from_path(path: &Path) -> Option<String> {
    let stem = path.file_stem()?.to_str()?;
    let candidate = stem.get(stem.len().checked_sub(36)?..)?;
    if candidate
        .chars()
        .all(|character| character.is_ascii_hexdigit() || character == '-')
    {
        Some(candidate.to_string())
    } else {
        None
    }
}

fn project_name(cwd: &str) -> Option<String> {
    Path::new(cwd)
        .file_name()
        .and_then(|name| name.to_str())
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(ToOwned::to_owned)
}

fn task_title(message: &str) -> Option<String> {
    let request = message
        .rsplit_once("## My request for Codex:")
        .map(|(_, value)| value)
        .unwrap_or(message);
    let line = request.lines().map(str::trim).find(|line| {
        !line.is_empty()
            && !line.starts_with('<')
            && !line.starts_with('#')
            && !line.starts_with("Files mentioned")
    })?;
    let mut title: String = line.chars().take(TITLE_LIMIT).collect();
    if line.chars().count() > TITLE_LIMIT {
        title.push('…');
    }
    Some(title)
}

fn event(
    session: &ObservedSession,
    status: TaskEventStatus,
    occurred_at: String,
    duration_ms: Option<u64>,
) -> Option<TaskCompanionEvent> {
    let thread_id = session.thread_id.clone()?;
    let turn = session.active_turn.as_ref()?;
    Some(TaskCompanionEvent {
        schema_version: 1,
        event_id: format!(
            "session-{}-{}-{}-{}",
            thread_id,
            turn.id,
            match status {
                TaskEventStatus::Working => "working",
                TaskEventStatus::NeedsInput => "needs-input",
                TaskEventStatus::Completed => "completed",
                TaskEventStatus::Failed => "failed",
                TaskEventStatus::Interrupted => "interrupted",
            },
            occurred_at
        ),
        thread_id,
        turn_id: Some(turn.id.clone()),
        status,
        occurred_at,
        project_name: session.project_name.clone(),
        task_title: turn.task_title.clone(),
        duration_ms,
        source: "sessionObserver".to_string(),
    })
}

fn consume_line(session: &mut ObservedSession, line: &str) -> Vec<TaskCompanionEvent> {
    let Ok(value) = serde_json::from_str::<Value>(line) else {
        return Vec::new();
    };
    let timestamp = value
        .get("timestamp")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| chrono::Utc::now().to_rfc3339());
    let top_type = value.get("type").and_then(Value::as_str);
    let payload = value.get("payload").and_then(Value::as_object);

    if top_type == Some("session_meta") {
        session.thread_id = payload
            .and_then(|data| data.get("id").or_else(|| data.get("session_id")))
            .and_then(Value::as_str)
            .map(ToOwned::to_owned)
            .or_else(|| session.thread_id.clone());
        session.project_name = payload
            .and_then(|data| data.get("cwd"))
            .and_then(Value::as_str)
            .and_then(project_name);
        return Vec::new();
    }

    if top_type != Some("event_msg") {
        return Vec::new();
    }
    let payload_type = payload
        .and_then(|data| data.get("type"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    match payload_type {
        "task_started" | "turn_started" => {
            let Some(turn_id) = payload
                .and_then(|data| data.get("turn_id"))
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
            else {
                return Vec::new();
            };
            let started_at = payload
                .and_then(|data| data.get("started_at"))
                .and_then(Value::as_str)
                .unwrap_or(&timestamp)
                .to_string();
            session.active_turn = Some(ActiveTurn {
                id: turn_id,
                started_at,
                task_title: None,
            });
            Vec::new()
        }
        "user_message" => {
            let Some(turn) = session.active_turn.as_mut() else {
                return Vec::new();
            };
            turn.task_title = payload
                .and_then(|data| data.get("message"))
                .and_then(Value::as_str)
                .and_then(task_title);
            event(session, TaskEventStatus::Working, timestamp, None)
                .into_iter()
                .collect()
        }
        "approval_request" | "permission_request" | "request_user_input" => {
            event(session, TaskEventStatus::NeedsInput, timestamp, None)
                .into_iter()
                .collect()
        }
        "task_complete" | "turn_complete" | "turn_completed" => {
            let duration_ms = payload
                .and_then(|data| data.get("duration_ms"))
                .and_then(Value::as_u64)
                .or_else(|| {
                    let started = session
                        .active_turn
                        .as_ref()?
                        .started_at
                        .parse::<chrono::DateTime<chrono::FixedOffset>>()
                        .ok()?;
                    let completed = timestamp
                        .parse::<chrono::DateTime<chrono::FixedOffset>>()
                        .ok()?;
                    u64::try_from((completed - started).num_milliseconds()).ok()
                });
            let result = event(session, TaskEventStatus::Completed, timestamp, duration_ms)
                .into_iter()
                .collect();
            session.active_turn = None;
            result
        }
        "task_failed" | "turn_failed" => {
            let result = event(session, TaskEventStatus::Failed, timestamp, None)
                .into_iter()
                .collect();
            session.active_turn = None;
            result
        }
        "task_aborted" | "turn_aborted" | "turn_interrupted" => {
            let result = event(session, TaskEventStatus::Interrupted, timestamp, None)
                .into_iter()
                .collect();
            session.active_turn = None;
            result
        }
        _ => Vec::new(),
    }
}

fn read_appended(path: &Path, session: &mut ObservedSession) -> Vec<TaskCompanionEvent> {
    let Ok(length) = fs::metadata(path).map(|metadata| metadata.len()) else {
        return Vec::new();
    };
    if length < session.offset {
        session.offset = 0;
        session.active_turn = None;
    }
    if length == session.offset {
        return Vec::new();
    }
    let Ok(mut file) = File::open(path) else {
        return Vec::new();
    };
    if file.seek(SeekFrom::Start(session.offset)).is_err() {
        return Vec::new();
    }

    let mut reader = BufReader::new(file);
    let mut events = Vec::new();
    let mut line = String::new();
    loop {
        line.clear();
        let Ok(bytes) = reader.read_line(&mut line) else {
            break;
        };
        if bytes == 0 {
            break;
        }
        session.offset += bytes as u64;
        if bytes <= MAX_LINE_BYTES {
            events.extend(consume_line(session, &line));
        }
    }
    events
}

#[cfg(test)]
mod tests {
    use std::{fs::OpenOptions, io::Write};

    use super::*;

    fn append(path: &Path, lines: &[&str]) {
        let mut file = OpenOptions::new().append(true).open(path).unwrap();
        for line in lines {
            writeln!(file, "{line}").unwrap();
        }
    }

    #[test]
    fn observes_only_new_local_session_events_and_keeps_task_title_in_memory() {
        let root = tempfile::tempdir().unwrap();
        let path = root
            .path()
            .join("rollout-2026-08-06T10-00-00-019fd5b8-6e9e-7ce2-8e94-58b33778d29d.jsonl");
        fs::write(
            &path,
            "{\"type\":\"event_msg\",\"payload\":{\"type\":\"task_complete\"}}\n",
        )
        .unwrap();
        let mut observer = SessionObserver::new(root.path().to_path_buf());
        assert!(observer.poll().is_empty());

        append(
            &path,
            &[
                r#"{"timestamp":"2026-08-06T10:00:00Z","type":"event_msg","payload":{"type":"task_started","turn_id":"turn-1","started_at":"2026-08-06T10:00:00Z"}}"#,
                r###"{"timestamp":"2026-08-06T10:00:01Z","type":"event_msg","payload":{"type":"user_message","message":"## My request for Codex:\n优化任务胶囊的自适应位置"}}"###,
                r#"{"timestamp":"2026-08-06T10:00:05Z","type":"event_msg","payload":{"type":"task_complete","turn_id":"turn-1","duration_ms":5000}}"#,
            ],
        );
        let events = observer.poll();
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].status, TaskEventStatus::Working);
        assert_eq!(
            events[0].task_title.as_deref(),
            Some("优化任务胶囊的自适应位置")
        );
        assert_eq!(events[1].status, TaskEventStatus::Completed);
        assert_eq!(events[1].duration_ms, Some(5000));
        assert_eq!(events[1].source, "sessionObserver");
    }

    #[test]
    fn maps_structured_attention_and_failure_markers_without_reading_tool_content() {
        let mut session = ObservedSession {
            thread_id: Some("thread-1".into()),
            active_turn: Some(ActiveTurn {
                id: "turn-1".into(),
                started_at: "2026-08-06T10:00:00Z".into(),
                task_title: Some("本机任务".into()),
            }),
            ..ObservedSession::default()
        };
        let attention = consume_line(
            &mut session,
            r#"{"timestamp":"2026-08-06T10:00:01Z","type":"event_msg","payload":{"type":"permission_request","secret":"ignored"}}"#,
        );
        assert_eq!(attention[0].status, TaskEventStatus::NeedsInput);
        let failed = consume_line(
            &mut session,
            r#"{"timestamp":"2026-08-06T10:00:02Z","type":"event_msg","payload":{"type":"turn_failed","error":"ignored"}}"#,
        );
        assert_eq!(failed[0].status, TaskEventStatus::Failed);
    }

    #[test]
    fn continues_observing_a_recently_active_thread_created_on_an_older_date() {
        let root = tempfile::tempdir().unwrap();
        let today = chrono::Local::now().date_naive();
        let today_dir = root
            .path()
            .join(today.format("%Y").to_string())
            .join(today.format("%m").to_string())
            .join(today.format("%d").to_string());
        fs::create_dir_all(&today_dir).unwrap();
        fs::write(
            today_dir
                .join("rollout-2026-08-06T10-00-00-019fd5b8-6e9e-7ce2-8e94-58b33778d29e.jsonl"),
            "",
        )
        .unwrap();

        let older_dir = root.path().join("2020/01/02");
        fs::create_dir_all(&older_dir).unwrap();
        let older = older_dir
            .join("rollout-2020-01-02T10-00-00-019fd5b8-6e9e-7ce2-8e94-58b33778d29d.jsonl");
        fs::write(&older, "").unwrap();
        let mut observer = SessionObserver::new(root.path().to_path_buf());

        append(
            &older,
            &[
                r#"{"timestamp":"2026-08-06T10:00:00Z","type":"event_msg","payload":{"type":"task_started","turn_id":"turn-old","started_at":"2026-08-06T10:00:00Z"}}"#,
                r#"{"timestamp":"2026-08-06T10:00:01Z","type":"event_msg","payload":{"type":"user_message","message":"继续旧任务"}}"#,
            ],
        );

        let events = observer.poll();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].status, TaskEventStatus::Working);
        assert_eq!(events[0].task_title.as_deref(), Some("继续旧任务"));
    }
}
