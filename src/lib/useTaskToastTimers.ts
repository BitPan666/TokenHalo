import { useEffect, useRef } from "react";
import { taskToastDurationMs, type TaskCompanionEntry } from "./taskCompanion";

interface TaskToastTimerRecord {
  threadId: string;
  remainingMs: number;
  startedAt: number | null;
  timeoutId: number | null;
}

interface UseTaskToastTimersOptions {
  entries: TaskCompanionEntry[];
  paused: boolean;
  onExpire: (threadId: string) => void;
  durationForEntry?: (entry: TaskCompanionEntry) => number | null;
}

const COMPLETED_RETENTION_MS = 30_000;

function timerKey(entry: TaskCompanionEntry) {
  return `${entry.event.eventId}\u0000${entry.toastExpired ? "retained" : "notice"}`;
}

function timerDurationMs(entry: TaskCompanionEntry) {
  if (entry.toastExpired) {
    return entry.event.status === "completed" ? COMPLETED_RETENTION_MS : null;
  }
  return taskToastDurationMs(entry.event.status);
}

export function useTaskToastTimers({
  entries,
  paused,
  onExpire,
  durationForEntry,
}: UseTaskToastTimersOptions) {
  const recordsRef = useRef(new Map<string, TaskToastTimerRecord>());
  const onExpireRef = useRef(onExpire);
  const durationForEntryRef = useRef(durationForEntry);
  onExpireRef.current = onExpire;
  durationForEntryRef.current = durationForEntry;
  const entryKey = entries.map(timerKey).join("\u0001");

  useEffect(() => {
    const records = recordsRef.current;
    const visibleTimerKeys = new Set(entries.map(timerKey));

    for (const [key, record] of records) {
      if (visibleTimerKeys.has(key)) continue;
      if (record.timeoutId !== null) window.clearTimeout(record.timeoutId);
      records.delete(key);
    }

    for (const entry of entries) {
      const key = timerKey(entry);
      if (records.has(key)) continue;
      const duration = durationForEntryRef.current
        ? durationForEntryRef.current(entry)
        : timerDurationMs(entry);
      if (duration === null) continue;
      records.set(key, {
        threadId: entry.event.threadId,
        remainingMs: duration,
        startedAt: null,
        timeoutId: null,
      });
    }

    if (!paused) {
      const startedAt = Date.now();
      for (const [key, record] of records) {
        if (record.timeoutId !== null) continue;
        record.startedAt = startedAt;
        record.timeoutId = window.setTimeout(() => {
          records.delete(key);
          onExpireRef.current(record.threadId);
        }, record.remainingMs);
      }
    }

    return () => {
      const stoppedAt = Date.now();
      for (const record of records.values()) {
        if (record.timeoutId === null || record.startedAt === null) continue;
        window.clearTimeout(record.timeoutId);
        record.remainingMs = Math.max(0, record.remainingMs - (stoppedAt - record.startedAt));
        record.startedAt = null;
        record.timeoutId = null;
      }
    };
  }, [entryKey, entries, paused]);
}
