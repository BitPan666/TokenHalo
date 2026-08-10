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
}

export function useTaskToastTimers({
  entries,
  paused,
  onExpire,
}: UseTaskToastTimersOptions) {
  const recordsRef = useRef(new Map<string, TaskToastTimerRecord>());
  const expiredEventIdsRef = useRef(new Set<string>());
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;
  const entryKey = entries.map((entry) => entry.event.eventId).join("\u0000");

  useEffect(() => {
    const records = recordsRef.current;
    const expiredEventIds = expiredEventIdsRef.current;
    const visibleEventIds = new Set(entries.map((entry) => entry.event.eventId));

    for (const [eventId, record] of records) {
      if (visibleEventIds.has(eventId)) continue;
      if (record.timeoutId !== null) window.clearTimeout(record.timeoutId);
      records.delete(eventId);
    }
    for (const eventId of expiredEventIds) {
      if (!visibleEventIds.has(eventId)) expiredEventIds.delete(eventId);
    }

    for (const entry of entries) {
      const eventId = entry.event.eventId;
      if (records.has(eventId) || expiredEventIds.has(eventId)) continue;
      const duration = taskToastDurationMs(entry.event.status);
      if (duration === null) continue;
      records.set(eventId, {
        threadId: entry.event.threadId,
        remainingMs: duration,
        startedAt: null,
        timeoutId: null,
      });
    }

    if (!paused) {
      const startedAt = Date.now();
      for (const [eventId, record] of records) {
        if (record.timeoutId !== null) continue;
        record.startedAt = startedAt;
        record.timeoutId = window.setTimeout(() => {
          records.delete(eventId);
          expiredEventIds.add(eventId);
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
