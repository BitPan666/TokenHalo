import { describe, expect, it } from "vitest";
import type { TaskCompanionEntry, TaskCompanionStatus } from "./taskCompanion";
import {
  groupTaskEntries,
  taskStatusGroupLabel,
} from "./taskStatusGroups";

function entry(
  threadId: string,
  status: TaskCompanionStatus,
  occurredAt: string,
): TaskCompanionEntry {
  return {
    event: {
      schemaVersion: 1,
      eventId: `${threadId}-${status}`,
      threadId,
      turnId: `${threadId}-turn`,
      status,
      occurredAt,
      projectName: "TokenHalo",
      taskTitle: `任务 ${threadId}`,
      durationMs: 12_000,
      source: "simulator",
    },
    acknowledged: false,
    postponedUntil: null,
    toastExpired: false,
  };
}

describe("groupTaskEntries", () => {
  it("groups tasks by status priority and sorts each group newest first", () => {
    const groups = groupTaskEntries([
      entry("working", "working", "2026-08-11T10:05:00.000Z"),
      entry("input-old", "needsInput", "2026-08-11T10:01:00.000Z"),
      entry("completed", "completed", "2026-08-11T10:04:00.000Z"),
      entry("input-new", "needsInput", "2026-08-11T10:06:00.000Z"),
      entry("failed", "failed", "2026-08-11T10:03:00.000Z"),
    ]);

    expect(groups.map((group) => group.status)).toEqual([
      "needsInput",
      "failed",
      "completed",
      "working",
    ]);
    expect(groups[0].entries.map((item) => item.event.threadId)).toEqual([
      "input-new",
      "input-old",
    ]);
  });

  it("omits empty statuses without changing the remaining priority", () => {
    const groups = groupTaskEntries([
      entry("working", "working", "2026-08-11T10:05:00.000Z"),
      entry("failed", "failed", "2026-08-11T10:03:00.000Z"),
    ]);

    expect(groups.map((group) => group.status)).toEqual(["failed", "working"]);
  });
});

describe("taskStatusGroupLabel", () => {
  it("adds an explicit task count only when a status contains multiple tasks", () => {
    expect(taskStatusGroupLabel("needsInput", 3, "zh-CN")).toBe("需要处理 · 3");
    expect(taskStatusGroupLabel("working", 1, "zh-CN")).toBe("正在工作");
    expect(taskStatusGroupLabel("completed", 2, "en")).toBe("Completed · 2");
  });
});
