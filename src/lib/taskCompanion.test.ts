import { describe, expect, it } from "vitest";
import {
  createTaskCompanionState,
  formatTaskDuration,
  selectTaskCompanionDisplay,
  taskCompanionLabel,
  taskCompanionReducer,
  taskToastDurationMs,
  type TaskCompanionEvent,
  type TaskCompanionEventStatus,
} from "./taskCompanion";

const BASE_TIME = Date.parse("2026-08-04T10:00:00.000Z");

function event(
  threadId: string,
  status: TaskCompanionEventStatus,
  seconds: number,
  overrides: Partial<TaskCompanionEvent> = {},
): TaskCompanionEvent {
  return {
    schemaVersion: 1,
    eventId: `${threadId}-${status}-${seconds}`,
    threadId,
    turnId: `${threadId}-turn`,
    status,
    occurredAt: new Date(BASE_TIME + seconds * 1_000).toISOString(),
    projectName: `Project ${threadId}`,
    taskTitle: `Task ${threadId}`,
    durationMs: null,
    source: "simulator",
    ...overrides,
  };
}

function acceptAll(events: TaskCompanionEvent[]) {
  return events.reduce(
    (state, item) => taskCompanionReducer(state, {
      type: "event",
      event: item,
      nowMs: Date.parse(item.occurredAt),
    }),
    createTaskCompanionState(),
  );
}

describe("taskCompanionReducer", () => {
  it("prioritizes needs input over failed, completed, and working", () => {
    const state = acceptAll([
      event("working", "working", 4),
      event("complete", "completed", 3),
      event("failed", "failed", 2),
      event("input", "needsInput", 1),
    ]);

    expect(selectTaskCompanionDisplay(state, BASE_TIME + 5_000).selected?.event.threadId)
      .toBe("input");
  });

  it("keeps the newest event inside the same priority", () => {
    const state = acceptAll([
      event("older", "failed", 1),
      event("newer", "failed", 9),
    ]);

    expect(selectTaskCompanionDisplay(state, BASE_TIME + 10_000).selected?.event.threadId)
      .toBe("newer");
  });

  it("ignores a duplicate event id", () => {
    const first = event("alpha", "working", 1, { eventId: "duplicate" });
    const duplicate = event("alpha", "failed", 9, { eventId: "duplicate" });
    const state = acceptAll([first, duplicate]);

    expect(state.entries.alpha.event.status).toBe("working");
    expect(state.seenEventIds).toEqual(["duplicate"]);
  });

  it("does not let an older event roll a turn backward", () => {
    const state = acceptAll([
      event("alpha", "completed", 10),
      event("alpha", "working", 2, { eventId: "late-old-event" }),
    ]);

    expect(state.entries.alpha.event.status).toBe("completed");
  });

  it("clears terminal state when a newer turn starts", () => {
    const state = acceptAll([
      event("alpha", "failed", 1, { turnId: "turn-one" }),
      event("alpha", "working", 2, { turnId: "turn-two" }),
    ]);

    expect(state.entries.alpha.event.status).toBe("working");
    expect(state.entries.alpha.acknowledged).toBe(false);
  });

  it("treats interrupted as neutral and clears the ring", () => {
    const state = acceptAll([
      event("alpha", "working", 1),
      event("alpha", "interrupted", 2),
    ]);

    expect(state.entries.alpha).toBeUndefined();
    expect(selectTaskCompanionDisplay(state, BASE_TIME + 3_000).selected).toBeNull();
  });

  it("postpones needs input for ten minutes until a newer event arrives", () => {
    const waiting = acceptAll([event("alpha", "needsInput", 1)]);
    const postponed = taskCompanionReducer(waiting, {
      type: "postpone",
      threadId: "alpha",
      nowMs: BASE_TIME + 2_000,
    });

    expect(selectTaskCompanionDisplay(postponed, BASE_TIME + 9 * 60_000).selected).toBeNull();
    expect(selectTaskCompanionDisplay(postponed, BASE_TIME + 11 * 60_000).selected?.event.threadId)
      .toBe("alpha");

    const advanced = taskCompanionReducer(postponed, {
      type: "event",
      event: event("alpha", "needsInput", 3, { eventId: "new-attention" }),
      nowMs: BASE_TIME + 3_000,
    });
    expect(selectTaskCompanionDisplay(advanced, BASE_TIME + 4_000).selected?.event.threadId)
      .toBe("alpha");
  });

  it("caps ordinary queue entries at five without evicting needs input or unread failures", () => {
    const state = acceptAll([
      event("input", "needsInput", 1),
      event("failed", "failed", 2),
      event("complete-a", "completed", 3),
      event("working-a", "working", 4),
      event("complete-b", "completed", 5),
      event("working-b", "working", 6),
    ]);

    expect(Object.keys(state.entries)).toHaveLength(5);
    expect(state.entries.input).toBeDefined();
    expect(state.entries.failed).toBeDefined();
    expect(state.entries["complete-a"]).toBeUndefined();
  });

  it("counts only unresolved attention entries for the badge", () => {
    const state = acceptAll([
      event("working", "working", 1),
      event("complete", "completed", 2),
      event("failed", "failed", 3),
      event("input", "needsInput", 4),
    ]);

    expect(selectTaskCompanionDisplay(state, BASE_TIME + 5_000).unresolvedCount).toBe(2);
  });

  it("expires completed capsules but keeps working and failed rings", () => {
    const completed = acceptAll([event("complete", "completed", 1)]);
    const completedExpired = taskCompanionReducer(completed, {
      type: "expireToast",
      threadId: "complete",
      nowMs: BASE_TIME + 8_000,
    });
    expect(completedExpired.entries.complete).toBeUndefined();

    for (const status of ["working", "failed"] as const) {
      const active = acceptAll([event(status, status, 1)]);
      const expired = taskCompanionReducer(active, {
        type: "expireToast",
        threadId: status,
        nowMs: BASE_TIME + 20_000,
      });
      expect(expired.entries[status].toastExpired).toBe(true);
      expect(selectTaskCompanionDisplay(expired, BASE_TIME + 21_000).ring?.event.status)
        .toBe(status);
    }
  });

  it("uses the approved state-specific toast durations", () => {
    expect(taskToastDurationMs("working")).toBe(2_000);
    expect(taskToastDurationMs("needsInput")).toBeNull();
    expect(taskToastDurationMs("completed")).toBe(7_000);
    expect(taskToastDurationMs("failed")).toBe(12_000);
  });

  it("uses safe task labels and compact durations", () => {
    expect(taskCompanionLabel(event("alpha", "working", 1))).toBe("Project alpha");
    expect(taskCompanionLabel(event("alpha", "working", 1, { projectName: "", taskTitle: "Refactor" })))
      .toBe("Refactor");
    expect(taskCompanionLabel(event("alpha", "working", 1, { projectName: null, taskTitle: null })))
      .toBe("Codex task");
    expect(formatTaskDuration(null)).toBeNull();
    expect(formatTaskDuration(65_000)).toBe("1m 5s");
    expect(formatTaskDuration(3_661_000)).toBe("1h 1m");
  });
});
