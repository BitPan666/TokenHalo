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

function event(status: TaskCompanionEventStatus, seconds = 0): TaskCompanionEvent {
  return {
    schemaVersion: 1,
    eventId: `${status}-${seconds}`,
    threadId: "thread-one",
    turnId: "turn-one",
    status,
    occurredAt: new Date(BASE_TIME + seconds * 1_000).toISOString(),
    projectName: "TokenHalo",
    taskTitle: null,
    durationMs: null,
    source: "simulator",
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
  it("expires the working capsule after two seconds but retains its ring", async () => {
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

    act(() => fake.emit(event("working")));
    await act(async () => undefined);
    expect(fake.bridge.show).toHaveBeenCalledOnce();
    act(() => vi.advanceTimersByTime(2_000));

    expect(result.current.taskStatus?.status).toBe("working");
    expect(fake.bridge.hide).toHaveBeenCalled();
  });

  it("removes completed after seven seconds and keeps failed after twelve", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_TIME);
    const fake = fakeBridge();
    const { result } = renderHook(() => useTaskCompanion({ compact: true, language: "en", codexForeground: false, bridge: fake.bridge }));
    await act(async () => undefined);

    act(() => fake.emit(event("completed")));
    act(() => vi.advanceTimersByTime(7_000));
    expect(result.current.taskStatus).toBeNull();

    act(() => fake.emit(event("failed", 8)));
    act(() => vi.advanceTimersByTime(12_000));
    expect(result.current.taskStatus?.status).toBe("failed");
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

  it("suppresses ordinary capsules in Codex foreground but preserves attention", async () => {
    const fake = fakeBridge();
    const { rerender } = renderHook(
      ({ foreground }) => useTaskCompanion({ compact: true, language: "en", codexForeground: foreground, bridge: fake.bridge }),
      { initialProps: { foreground: true } },
    );
    await act(async () => undefined);

    act(() => fake.emit(event("working")));
    expect(fake.bridge.show).not.toHaveBeenCalled();
    act(() => fake.emit(event("needsInput", 1)));
    await waitFor(() => expect(fake.bridge.show).toHaveBeenCalledOnce());

    rerender({ foreground: false });
  });
});
