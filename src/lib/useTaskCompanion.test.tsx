// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TaskCompanionEvent, TaskCompanionEventStatus } from "./taskCompanion";
import type { TaskToastActionPayload } from "./taskToastWindow";
import {
  useTaskCompanion,
  type TaskCompanionBridge,
} from "./useTaskCompanion";

const BASE_TIME = Date.parse("2026-08-04T10:00:00.000Z");

function event(
  status: TaskCompanionEventStatus,
  seconds = 0,
  source: TaskCompanionEvent["source"] = "simulator",
  threadId = "thread-one",
): TaskCompanionEvent {
  return {
    schemaVersion: 1,
    eventId: `${threadId}-${status}-${seconds}`,
    threadId,
    turnId: `${threadId}-turn`,
    status,
    occurredAt: new Date(BASE_TIME + seconds * 1_000).toISOString(),
    projectName: "TokenHalo",
    taskTitle: null,
    durationMs: null,
    source,
  };
}

function fakeBridge() {
  let onEvent = (_event: TaskCompanionEvent) => undefined;
  let onAction = (_action: TaskToastActionPayload) => undefined;
  const bridge: TaskCompanionBridge = {
    listenEvents: vi.fn(async (handler) => {
      onEvent = handler;
      return () => undefined;
    }),
    listenActions: vi.fn(async (handler) => {
      onAction = handler;
      return () => undefined;
    }),
    show: vi.fn(async () => null),
    hide: vi.fn(async () => undefined),
    open: vi.fn(async () => "openedApp" as const),
  };
  return { bridge, emit: (value: TaskCompanionEvent) => onEvent(value), action: (value: TaskToastActionPayload) => onAction(value) };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("useTaskCompanion", () => {
  it("sends the three highest-priority tasks and the hidden count to the toast window", async () => {
    const fake = fakeBridge();
    renderHook(() => useTaskCompanion({
      compact: true,
      language: "zh-CN",
      codexForeground: false,
      bridge: fake.bridge,
    }));
    await act(async () => undefined);

    act(() => {
      fake.emit(event("working", 4, "simulator", "working"));
      fake.emit(event("completed", 3, "simulator", "completed"));
      fake.emit(event("failed", 2, "simulator", "failed"));
      fake.emit(event("needsInput", 1, "simulator", "input"));
    });
    await act(async () => undefined);

    expect(fake.bridge.show).toHaveBeenLastCalledWith(expect.objectContaining({
      entries: expect.arrayContaining([
        expect.objectContaining({ event: expect.objectContaining({ threadId: "input" }) }),
        expect.objectContaining({ event: expect.objectContaining({ threadId: "failed" }) }),
        expect.objectContaining({ event: expect.objectContaining({ threadId: "completed" }) }),
      ]),
      hiddenCount: 1,
      expanded: false,
      language: "zh-CN",
      openAction: "app",
    }));
    const request = vi.mocked(fake.bridge.show).mock.calls.at(-1)?.[0];
    if (!request || request.kind === "permission") throw new Error("task stack request missing");
    expect(request.entries.map((item) => item.event.threadId))
      .toEqual(["input", "failed", "completed"]);
  });

  it("settles the working capsule after two seconds without hiding it", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_TIME);
    const fake = fakeBridge();
    const { result } = renderHook(() => useTaskCompanion({
      compact: true,
      language: "en",
      codexForeground: false,
      bridge: fake.bridge,
    }));
    await act(async () => undefined);

    act(() => fake.emit(event("working", 0, "sessionObserver")));
    await act(async () => undefined);
    expect(fake.bridge.show).toHaveBeenCalledOnce();
    vi.mocked(fake.bridge.hide).mockClear();
    act(() => vi.advanceTimersByTime(2_000));

    expect(result.current.taskStatus?.status).toBe("working");
    expect(result.current.activeEntry?.event.status).toBe("working");
    expect(result.current.activeEntry?.toastExpired).toBe(true);
    expect(fake.bridge.hide).not.toHaveBeenCalled();
  });

  it("pauses visible task timers while the capsule stack is expanded", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_TIME);
    const fake = fakeBridge();
    const { result } = renderHook(() => useTaskCompanion({
      compact: true,
      language: "en",
      codexForeground: false,
      bridge: fake.bridge,
    }));
    await act(async () => undefined);

    act(() => fake.emit(event("working", 0, "sessionObserver")));
    act(() => vi.advanceTimersByTime(1_000));
    act(() => fake.action({
      type: "setStackExpanded",
      expanded: true,
    } as unknown as TaskToastActionPayload));
    act(() => vi.advanceTimersByTime(5_000));
    expect(result.current.activeEntry?.event.threadId).toBe("thread-one");

    act(() => fake.action({
      type: "setStackExpanded",
      expanded: false,
    } as unknown as TaskToastActionPayload));
    act(() => vi.advanceTimersByTime(1_000));
    expect(result.current.activeEntry?.event.status).toBe("working");
    expect(result.current.activeEntry?.toastExpired).toBe(true);
  });

  it("retains completed for thirty seconds after settling and keeps failed visible", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_TIME);
    const fake = fakeBridge();
    const { result } = renderHook(() => useTaskCompanion({ compact: true, language: "en", codexForeground: false, bridge: fake.bridge }));
    await act(async () => undefined);

    act(() => fake.emit(event("completed")));
    act(() => vi.advanceTimersByTime(7_000));
    expect(result.current.taskStatus).toBeNull();
    expect(result.current.activeEntry?.event.status).toBe("completed");
    act(() => vi.advanceTimersByTime(29_999));
    expect(result.current.activeEntry?.event.status).toBe("completed");
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.activeEntry).toBeNull();

    act(() => fake.emit(event("failed", 38)));
    act(() => vi.advanceTimersByTime(60_000));
    expect(result.current.taskStatus?.status).toBe("failed");
    expect(result.current.activeEntry?.event.status).toBe("failed");
  });

  it("postpones needs input for ten minutes and restores it afterward", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_TIME);
    const fake = fakeBridge();
    renderHook(() => useTaskCompanion({ compact: true, language: "en", codexForeground: false, bridge: fake.bridge }));
    await act(async () => undefined);

    act(() => fake.emit(event("needsInput")));
    act(() => fake.action({ type: "postpone", threadId: "thread-one" }));
    expect(fake.bridge.hide).toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(10 * 60_000));
    await act(async () => undefined);
    expect(fake.bridge.show).toHaveBeenCalledTimes(2);
  });

  it("shows an ordinary capsule while Codex is in the foreground", async () => {
    const fake = fakeBridge();
    renderHook(() => useTaskCompanion({
      compact: true,
      language: "en",
      codexForeground: true,
      bridge: fake.bridge,
    }));
    await act(async () => undefined);

    act(() => fake.emit(event("working", 0, "sessionObserver")));
    await waitFor(() => expect(fake.bridge.show).toHaveBeenCalledOnce());
  });

  it("shows a test preview even while the widget is expanded and Codex is foreground", async () => {
    const fake = fakeBridge();
    renderHook(() => useTaskCompanion({
      compact: false,
      language: "zh-CN",
      codexForeground: true,
      bridge: fake.bridge,
    }));
    await act(async () => undefined);

    act(() => fake.emit(event("completed")));

    await waitFor(() => expect(fake.bridge.show).toHaveBeenCalledOnce());
  });

  it("leaves first-use task reminder actions to the onboarding flow", async () => {
    const fake = fakeBridge();
    renderHook(() => useTaskCompanion({
      compact: true,
      language: "zh-CN",
      codexForeground: false,
      bridge: fake.bridge,
    }));
    await act(async () => undefined);

    act(() => fake.action({ type: "enableTaskNotifications" }));
    act(() => fake.action({ type: "dismissTaskNotifications" }));

    expect(fake.bridge.open).not.toHaveBeenCalled();
  });

  it("keeps lifecycle ordering across attention, completion, failure, and interruption", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_TIME);
    const fake = fakeBridge();
    const { result } = renderHook(() => useTaskCompanion({
      compact: true,
      language: "en",
      codexForeground: false,
      bridge: fake.bridge,
    }));
    await act(async () => undefined);

    act(() => fake.emit(event("working", 0)));
    expect(result.current.taskStatus?.status).toBe("working");
    act(() => fake.emit(event("needsInput", 1)));
    expect(result.current.taskStatus?.status).toBe("needsInput");
    act(() => fake.emit(event("working", 2)));
    expect(result.current.taskStatus?.status).toBe("working");
    act(() => fake.emit(event("completed", 3)));
    expect(result.current.taskStatus?.status).toBe("completed");
    act(() => fake.emit(event("failed", 4)));
    expect(result.current.taskStatus?.status).toBe("failed");
    act(() => fake.emit(event("interrupted", 5)));
    expect(result.current.taskStatus).toBeNull();
  });
});
