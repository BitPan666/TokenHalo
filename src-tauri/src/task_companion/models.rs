use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum HookSignal {
    Working,
    NeedsInput,
    TerminalCandidate,
    Health,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HookRecord {
    pub schema_version: u8,
    pub event_id: String,
    pub thread_id: String,
    pub turn_id: Option<String>,
    pub status: HookSignal,
    pub occurred_at: String,
    pub project_name: Option<String>,
    pub duration_ms: Option<u64>,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TaskEventStatus {
    Working,
    NeedsInput,
    Completed,
    Failed,
    Interrupted,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskCompanionEvent {
    pub schema_version: u8,
    pub event_id: String,
    pub thread_id: String,
    pub turn_id: Option<String>,
    pub status: TaskEventStatus,
    pub occurred_at: String,
    pub project_name: Option<String>,
    pub task_title: Option<String>,
    pub duration_ms: Option<u64>,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ConnectionState {
    Disconnected,
    NeedsTrust,
    Connected,
    Degraded,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionStatus {
    pub state: ConnectionState,
}
