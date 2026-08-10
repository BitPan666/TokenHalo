// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TaskCompanionEntry, TaskCompanionStatus } from "./taskCompanion";
import { useTaskToastTimers } from "./useTaskToastTimers";

const BASE_TIME = Date.parse("2026-08-10T08:00:00.000Z");

function entry(threadId: string, status: TaskCompanionStatus): TaskCompanionEntry {
  return {
    event: {
      schemaVersion: 1,
      eventId: `${threadId}-${status}`,
      threadId,
      turnId: `${threadId}-turn`,
      status,
      occurredAt: new Date(BASE_TIME).toISOString(),
      projectName: "TokenHalo",
      taskTitle: `Task ${threadId}`,
      durationMs: null,
      source: "simulator",
    },
    acknowledged: false,
    postponedUntil: null,
    toastExpired: false,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("useTaskToastTimers", () => {
  it("expires each visible task on its own status duration", () => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_TIME);
    const onExpire = vi.fn();

    renderHook(() => useTaskToastTimers({
      entries: [entry("working", "working"), entry("completed", "completed")],
      paused: false,
      onExpire,
    }));

    act(() => vi.advanceTimersByTime(2_000));
    expect(onExpire).toHaveBeenCalledWith("working");
    expect(onExpire).not.toHaveBeenCalledWith("completed");

    act(() => vi.advanceTimersByTime(5_000));
    expect(onExpire).toHaveBeenCalledWith("completed");
  });

  it("pauses all visible countdowns and resumes their remaining time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_TIME);
    const onExpire = vi.fn();
    const visible = [entry("working", "working")];
    const { rerender } = renderHook(
      ({ paused }) => useTaskToastTimers({ entries: visible, paused, onExpire }),
      { initialProps: { paused: false } },
    );

    act(() => vi.advanceTimersByTime(1_000));
    rerender({ paused: true });
    act(() => vi.advanceTimersByTime(5_000));
    expect(onExpire).not.toHaveBeenCalled();

    rerender({ paused: false });
    act(() => vi.advanceTimersByTime(999));
    expect(onExpire).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onExpire).toHaveBeenCalledWith("working");
  });

  it("starts a hidden task countdown only after it becomes visible", () => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_TIME);
    const onExpire = vi.fn();
    const completed = entry("completed", "completed");
    const { rerender } = renderHook(
      ({ entries }) => useTaskToastTimers({ entries, paused: false, onExpire }),
      { initialProps: { entries: [] as TaskCompanionEntry[] } },
    );

    act(() => vi.advanceTimersByTime(20_000));
    rerender({ entries: [completed] });
    act(() => vi.advanceTimersByTime(6_999));
    expect(onExpire).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onExpire).toHaveBeenCalledWith("completed");
  });

  it("keeps a completed task for thirty seconds after its initial notice settles", () => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_TIME);
    const onExpire = vi.fn();
    const completed = entry("completed", "completed");
    const { rerender } = renderHook(
      ({ entries }) => useTaskToastTimers({ entries, paused: false, onExpire }),
      { initialProps: { entries: [completed] } },
    );

    act(() => vi.advanceTimersByTime(7_000));
    expect(onExpire).toHaveBeenCalledTimes(1);
    rerender({ entries: [{ ...completed, toastExpired: true }] });
    act(() => vi.advanceTimersByTime(29_999));
    expect(onExpire).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(1));
    expect(onExpire).toHaveBeenCalledTimes(2);
  });
});
