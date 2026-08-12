use std::{
    collections::HashMap,
    fs::{self, File},
    io::{BufRead, BufReader, Seek, SeekFrom},
    path::{Path, PathBuf},
};

use rusqlite::{Connection, OpenFlags, OptionalExtension};
use serde_json::Value;
use walkdir::WalkDir;

use super::models::{TaskCompanionEvent, TaskEventStatus};

const MAX_LINE_BYTES: usize = 2 * 1024 * 1024;
const TITLE_LIMIT: usize = 56;

#[derive(Debug, Default)]
struct ActiveTurn {
    id: String,
    started_at: String,
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
    session_index_path: Option<PathBuf>,
    state_db_paths: Vec<PathBuf>,
    files: HashMap<PathBuf, ObservedSession>,
}

impl SessionObserver {
    pub fn new(sessions_root: PathBuf) -> Self {
        let codex_root = sessions_root.parent();
        let session_index_path = codex_root.map(|root| root.join("session_index.jsonl"));
        let state_db_paths = codex_root
            .map(|root| {
                vec![
                    root.join("state_5.sqlite"),
                    root.join("sqlite").join("state_5.sqlite"),
                ]
            })
            .unwrap_or_default();
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
            session_index_path,
            state_db_paths,
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
            let mut appended = read_appended(&path, session);
            for event in &mut appended {
                event.task_title = resolve_task_title(
                    self.session_index_path.as_deref(),
                    &self.state_db_paths,
                    &event.thread_id,
                );
            }
            events.extend(appended);
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

fn sidebar_task_title(session_index_path: &Path, thread_id: &str) -> Option<String> {
    let reader = BufReader::new(File::open(session_index_path).ok()?);
    let mut latest = None;
    for line in reader.lines().map_while(Result::ok) {
        if line.len() > MAX_LINE_BYTES {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if value.get("id").and_then(Value::as_str) != Some(thread_id) {
            continue;
        }
        latest = value
            .get("thread_name")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|title| !title.is_empty())
            .map(ToOwned::to_owned);
    }
    latest
}

fn limited_task_title(title: String) -> Option<String> {
    let trimmed = title.trim();
    if trimmed.is_empty() {
        return None;
    }
    let mut title: String = trimmed.chars().take(TITLE_LIMIT).collect();
    if trimmed.chars().count() > TITLE_LIMIT {
        title.push('…');
    }
    Some(title)
}

fn resolve_task_title(
    session_index_path: Option<&Path>,
    state_db_paths: &[PathBuf],
    thread_id: &str,
) -> Option<String> {
    if let Some(title) = session_index_path
        .and_then(|path| sidebar_task_title(path, thread_id))
        .and_then(limited_task_title)
    {
        return Some(title);
    }

    let flags = OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX;
    let title = state_db_paths.iter().find_map(|path| {
        let connection = Connection::open_with_flags(path, flags).ok()?;
        connection
            .query_row(
                "SELECT title
                 FROM threads
                 WHERE id = ?1
                   AND trim(title) <> ''",
                [thread_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .ok()
            .flatten()
    })?;
    limited_task_title(title)
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
        task_title: None,
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
            });
            Vec::new()
        }
        "user_message" => {
            let Some(_) = session.active_turn.as_ref() else {
                return Vec::new();
            };
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

    use rusqlite::Connection;

    use super::*;

    fn append(path: &Path, lines: &[&str]) {
        let mut file = OpenOptions::new().append(true).open(path).unwrap();
        for line in lines {
            writeln!(file, "{line}").unwrap();
        }
    }

    #[test]
    fn observes_only_new_local_session_events_without_using_message_as_title() {
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
        assert_eq!(events[0].task_title, None);
        assert_eq!(events[1].status, TaskEventStatus::Completed);
        assert_eq!(events[1].duration_ms, Some(5000));
        assert_eq!(events[1].source, "sessionObserver");
    }

    #[test]
    fn uses_codex_task_title_instead_of_user_message_content() {
        let root = tempfile::tempdir().unwrap();
        let codex_root = root.path().join(".codex");
        let sessions_root = codex_root.join("sessions");
        fs::create_dir_all(&sessions_root).unwrap();
        let path = sessions_root
            .join("rollout-2026-08-10T10-00-00-019fea73-29fb-7fa0-beb4-70393b3af5a8.jsonl");
        fs::write(&path, "").unwrap();

        let connection = Connection::open(codex_root.join("state_5.sqlite")).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE threads (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    first_user_message TEXT NOT NULL
                );",
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO threads (id, title, first_user_message) VALUES (?1, ?2, ?3)",
                (
                    "019fea73-29fb-7fa0-beb4-70393b3af5a8",
                    "优化任务胶囊",
                    "这是一段对话内容，不应该显示在胶囊里",
                ),
            )
            .unwrap();
        drop(connection);

        let mut observer = SessionObserver::new(sessions_root);
        append(
            &path,
            &[
                r#"{"timestamp":"2026-08-10T10:00:00Z","type":"event_msg","payload":{"type":"task_started","turn_id":"turn-1","started_at":"2026-08-10T10:00:00Z"}}"#,
                r#"{"timestamp":"2026-08-10T10:00:01Z","type":"event_msg","payload":{"type":"user_message","message":"我又输入了一段对话内容"}}"#,
            ],
        );

        let events = observer.poll();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].task_title.as_deref(), Some("优化任务胶囊"));
    }

    #[test]
    fn prefers_the_latest_sidebar_thread_name_over_the_persisted_first_message_title() {
        let root = tempfile::tempdir().unwrap();
        let codex_root = root.path().join(".codex");
        let sessions_root = codex_root.join("sessions");
        fs::create_dir_all(&sessions_root).unwrap();
        let thread_id = "019fea73-29fb-7fa0-beb4-70393b3af5aa";
        let path = sessions_root.join(format!("rollout-2026-08-10T10-00-00-{thread_id}.jsonl"));
        fs::write(&path, "").unwrap();
        fs::write(
            codex_root.join("session_index.jsonl"),
            format!(
                "{{\"id\":\"{thread_id}\",\"thread_name\":\"旧侧边栏名称\"}}\n{{\"id\":\"{thread_id}\",\"thread_name\":\"优化用量浮层交互体验\"}}\n"
            ),
        )
        .unwrap();

        let connection = Connection::open(codex_root.join("state_5.sqlite")).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE threads (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    first_user_message TEXT NOT NULL
                );",
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO threads (id, title, first_user_message) VALUES (?1, ?2, ?3)",
                (
                    thread_id,
                    "你帮我看看迭代的方向可以往哪走",
                    "你帮我看看迭代的方向可以往哪走",
                ),
            )
            .unwrap();
        drop(connection);

        let mut observer = SessionObserver::new(sessions_root);
        append(
            &path,
            &[
                r#"{"timestamp":"2026-08-10T10:00:00Z","type":"event_msg","payload":{"type":"task_started","turn_id":"turn-1","started_at":"2026-08-10T10:00:00Z"}}"#,
                r#"{"timestamp":"2026-08-10T10:00:01Z","type":"event_msg","payload":{"type":"user_message","message":"继续处理这个任务"}}"#,
            ],
        );

        let events = observer.poll();
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].task_title.as_deref(),
            Some("优化用量浮层交互体验")
        );
    }

    #[test]
    fn uses_the_persisted_codex_title_even_before_codex_shortens_it() {
        let root = tempfile::tempdir().unwrap();
        let codex_root = root.path().join(".codex");
        let sessions_root = codex_root.join("sessions");
        fs::create_dir_all(&sessions_root).unwrap();
        let path = sessions_root
            .join("rollout-2026-08-10T10-00-00-019fea73-29fb-7fa0-beb4-70393b3af5a9.jsonl");
        fs::write(&path, "").unwrap();

        let connection = Connection::open(codex_root.join("state_5.sqlite")).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE threads (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    first_user_message TEXT NOT NULL
                );",
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO threads (id, title, first_user_message) VALUES (?1, ?2, ?3)",
                (
                    "019fea73-29fb-7fa0-beb4-70393b3af5a9",
                    "整理发布说明",
                    "整理发布说明",
                ),
            )
            .unwrap();
        drop(connection);

        let mut observer = SessionObserver::new(sessions_root);
        append(
            &path,
            &[
                r#"{"timestamp":"2026-08-10T10:00:00Z","type":"event_msg","payload":{"type":"task_started","turn_id":"turn-1","started_at":"2026-08-10T10:00:00Z"}}"#,
                r#"{"timestamp":"2026-08-10T10:00:01Z","type":"event_msg","payload":{"type":"user_message","message":"继续处理刚才的按钮"}}"#,
            ],
        );

        let events = observer.poll();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].task_title.as_deref(), Some("整理发布说明"));
    }

    #[test]
    fn maps_structured_attention_and_failure_markers_without_reading_tool_content() {
        let mut session = ObservedSession {
            thread_id: Some("thread-1".into()),
            active_turn: Some(ActiveTurn {
                id: "turn-1".into(),
                started_at: "2026-08-06T10:00:00Z".into(),
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
        assert_eq!(events[0].task_title, None);
    }
}
