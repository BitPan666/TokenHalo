export type TaskCompanionStatus = "working" | "needsInput" | "completed" | "failed";
export type TaskCompanionEventStatus = TaskCompanionStatus | "interrupted";
export type TaskCompanionSource = "codexHook" | "sessionReconciliation" | "simulator";

export interface TaskCompanionEvent {
  schemaVersion: 1;
  eventId: string;
  threadId: string;
  turnId: string | null;
  status: TaskCompanionEventStatus;
  occurredAt: string;
  projectName: string | null;
  taskTitle: string | null;
  durationMs: number | null;
  source: TaskCompanionSource;
}

export interface TaskCompanionEntry {
  event: TaskCompanionEvent & { status: TaskCompanionStatus };
  acknowledged: boolean;
  postponedUntil: number | null;
  toastExpired: boolean;
}

export interface TaskCompanionState {
  entries: Record<string, TaskCompanionEntry>;
  seenEventIds: string[];
}

export type TaskCompanionAction =
  | { type: "event"; event: TaskCompanionEvent; nowMs: number }
  | { type: "acknowledge"; threadId: string; nowMs: number }
  | { type: "postpone"; threadId: string; nowMs: number }
  | { type: "expireToast"; threadId: string; nowMs: number };

export interface TaskCompanionDisplay {
  selected: TaskCompanionEntry | null;
  ring: TaskCompanionEntry | null;
  unresolvedCount: number;
}

const MAX_ORDINARY_QUEUE_SIZE = 5;
const MAX_SEEN_EVENT_IDS = 256;
const POSTPONE_DURATION_MS = 10 * 60_000;

const STATUS_PRIORITY: Record<TaskCompanionStatus, number> = {
  needsInput: 4,
  failed: 3,
  completed: 2,
  working: 1,
};

export function createTaskCompanionState(): TaskCompanionState {
  return { entries: {}, seenEventIds: [] };
}

export function taskToastDurationMs(status: TaskCompanionStatus): number | null {
  if (status === "working") return 2_000;
  if (status === "completed") return 7_000;
  if (status === "failed") return 12_000;
  return null;
}

function eventTime(event: TaskCompanionEvent) {
  const value = Date.parse(event.occurredAt);
  return Number.isFinite(value) ? value : 0;
}

function newestFirst(left: TaskCompanionEntry, right: TaskCompanionEntry) {
  const priority = STATUS_PRIORITY[right.event.status as TaskCompanionStatus]
    - STATUS_PRIORITY[left.event.status as TaskCompanionStatus];
  if (priority !== 0) return priority;
  return eventTime(right.event) - eventTime(left.event);
}

function trimOrdinaryEntries(entries: Record<string, TaskCompanionEntry>) {
  const next = { ...entries };
  const removable = Object.values(next)
    .filter(({ event }) => event.status === "completed" || event.status === "working")
    .sort((left, right) => {
      if (left.event.status !== right.event.status) {
        return left.event.status === "completed" ? -1 : 1;
      }
      return eventTime(left.event) - eventTime(right.event);
    });

  while (Object.keys(next).length > MAX_ORDINARY_QUEUE_SIZE && removable.length > 0) {
    const entry = removable.shift();
    if (entry) delete next[entry.event.threadId];
  }
  return next;
}

export function taskCompanionReducer(
  state: TaskCompanionState,
  action: TaskCompanionAction,
): TaskCompanionState {
  if (action.type === "event") {
    const incoming = action.event;
    if (state.seenEventIds.includes(incoming.eventId)) return state;

    const seenEventIds = [...state.seenEventIds, incoming.eventId]
      .slice(-MAX_SEEN_EVENT_IDS);
    const current = state.entries[incoming.threadId];
    if (current && eventTime(incoming) < eventTime(current.event)) {
      return { ...state, seenEventIds };
    }

    const entries = { ...state.entries };
    if (incoming.status === "interrupted") {
      delete entries[incoming.threadId];
      return { entries, seenEventIds };
    }

    entries[incoming.threadId] = {
      event: { ...incoming, status: incoming.status },
      acknowledged: false,
      postponedUntil: null,
      toastExpired: false,
    };
    return { entries: trimOrdinaryEntries(entries), seenEventIds };
  }

  const current = state.entries[action.threadId];
  if (!current) return state;

  if (action.type === "acknowledge") {
    const entries = { ...state.entries };
    delete entries[action.threadId];
    return { ...state, entries };
  }

  if (action.type === "postpone") {
    if (current.event.status !== "needsInput") return state;
    return {
      ...state,
      entries: {
        ...state.entries,
        [action.threadId]: {
          ...current,
          postponedUntil: action.nowMs + POSTPONE_DURATION_MS,
        },
      },
    };
  }

  if (current.event.status === "completed") {
    const entries = { ...state.entries };
    delete entries[action.threadId];
    return { ...state, entries };
  }

  return {
    ...state,
    entries: {
      ...state.entries,
      [action.threadId]: { ...current, toastExpired: true },
    },
  };
}

export function selectTaskCompanionDisplay(
  state: TaskCompanionState,
  nowMs: number,
): TaskCompanionDisplay {
  const entries = Object.values(state.entries);
  const unresolvedCount = entries.filter(({ event, acknowledged }) => (
    !acknowledged && (event.status === "needsInput" || event.status === "failed")
  )).length;
  const ring = entries
    .filter(({ event, acknowledged, toastExpired }) => (
      !acknowledged && (event.status !== "completed" || !toastExpired)
    ))
    .sort(newestFirst)[0] ?? null;
  const selected = entries
    .filter(({ event, acknowledged, postponedUntil, toastExpired }) => {
      if (acknowledged || toastExpired) return false;
      if (event.status === "needsInput" && postponedUntil !== null) {
        return postponedUntil <= nowMs;
      }
      return true;
    })
    .sort(newestFirst)[0] ?? null;

  return { selected, ring, unresolvedCount };
}

export function taskCompanionLabel(event: TaskCompanionEvent) {
  return event.taskTitle?.trim()
    || event.projectName?.trim()
    || "Codex task";
}

export function formatTaskDuration(durationMs: number | null) {
  if (durationMs === null || !Number.isFinite(durationMs) || durationMs < 0) return null;
  const totalSeconds = Math.floor(durationMs / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}
