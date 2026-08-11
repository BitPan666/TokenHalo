// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { TaskCompanionEntry } from "./taskCompanion";

const native = vi.hoisted(() => ({
  invoke: vi.fn(async () => undefined),
  setSize: vi.fn(async () => undefined),
  setPosition: vi.fn(async () => undefined),
  show: vi.fn(async () => undefined),
  emitTo: vi.fn(async () => undefined),
}));

const widgetWindow = {
  outerPosition: vi.fn(async () => ({ x: 1_000, y: 1_000 })),
  outerSize: vi.fn(async () => ({ width: 200, height: 200 })),
  scaleFactor: vi.fn(async () => 2),
};

const toastWindow = {
  setSize: native.setSize,
  setPosition: native.setPosition,
  show: native.show,
  hide: vi.fn(async () => undefined),
};

vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ emitTo: native.emitTo }));
vi.mock("@tauri-apps/api/window", () => ({
  LogicalSize: class LogicalSize {
    constructor(public width: number, public height: number) {}
  },
  PhysicalPosition: class PhysicalPosition {
    constructor(public x: number, public y: number) {}
  },
  Window: {
    getByLabel: vi.fn(async (label: string) => (
      label === "widget" ? widgetWindow : toastWindow
    )),
  },
  monitorFromPoint: vi.fn(async () => ({
    workArea: {
      position: { x: 0, y: 0 },
      size: { width: 2_880, height: 1_800 },
    },
  })),
  currentMonitor: vi.fn(async () => null),
}));

function entry(
  threadId: string,
  status: TaskCompanionEntry["event"]["status"],
): TaskCompanionEntry {
  return {
    event: {
    schemaVersion: 1,
    eventId: `event-${threadId}`,
    threadId,
    turnId: `turn-${threadId}`,
    status,
    occurredAt: "2026-08-04T10:00:00.000Z",
    projectName: "TokenHalo",
    taskTitle: "Task one",
    durationMs: 12_000,
    source: "simulator",
  },
    acknowledged: false,
    postponedUntil: null,
    toastExpired: false,
  };
}

afterEach(() => {
  native.invoke.mockClear();
  native.setSize.mockClear();
  native.setPosition.mockClear();
  native.show.mockClear();
  native.emitTo.mockClear();
});

describe("task toast native frame", () => {
  it("applies the expanded frame atomically so hover is not interrupted", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      value: {},
      configurable: true,
    });
    const { showTaskToast } = await import("./bridge");

    await showTaskToast({
      entries: [
        entry("input", "needsInput"),
        entry("failed", "failed"),
        entry("completed", "completed"),
        entry("working", "working"),
      ],
      layout: { outerExpanded: true, expandedStatus: null },
      language: "zh-CN",
      openAction: "app",
    });

    expect(native.invoke).toHaveBeenCalledWith("set_task_toast_frame", {
      x: 828,
      y: 240,
      width: 272,
      height: 372,
    });
    expect(native.setSize).not.toHaveBeenCalled();
    expect(native.setPosition).not.toHaveBeenCalled();
    expect(native.invoke).toHaveBeenNthCalledWith(2, "show_task_toast_without_focus");
    expect(native.show).not.toHaveBeenCalled();
  });
});
