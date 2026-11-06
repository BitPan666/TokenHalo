// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TaskToastDisplayPayload } from "./lib/taskToastWindow";
import { TaskToastApp, type TaskToastAppBridge } from "./TaskToastApp";

const payload: TaskToastDisplayPayload = {
  entries: [{
    event: {
      schemaVersion: 1,
      eventId: "event-one",
      threadId: "thread-one",
      turnId: "turn-one",
      status: "needsInput",
      occurredAt: "2026-08-04T10:00:00.000Z",
      projectName: "TokenHalo",
      taskTitle: null,
      durationMs: null,
      source: "simulator",
    },
    acknowledged: false,
    postponedUntil: null,
    toastExpired: false,
  }],
  hiddenCount: 0,
  expanded: false,
  visibleCapacity: 1,
  growth: "up",
  direction: "left",
  language: "en",
  openAction: "app",
};

const groupedPayload: TaskToastDisplayPayload = {
  ...payload,
  entries: [
    payload.entries[0],
    {
      ...payload.entries[0],
      event: {
        ...payload.entries[0].event,
        eventId: "event-two",
        threadId: "thread-two",
        status: "needsInput",
        taskTitle: "Approve the release",
      },
    },
    {
      ...payload.entries[0],
      event: {
        ...payload.entries[0].event,
        eventId: "event-three",
        threadId: "thread-three",
        status: "failed",
        taskTitle: "Repair desktop build",
      },
    },
    {
      ...payload.entries[0],
      event: {
        ...payload.entries[0].event,
        eventId: "event-four",
        threadId: "thread-four",
        status: "completed",
        taskTitle: "Polish task capsule",
      },
    },
    {
      ...payload.entries[0],
      event: {
        ...payload.entries[0].event,
        eventId: "event-five",
        threadId: "thread-five",
        status: "working",
        taskTitle: "Generate desktop interaction",
      },
    },
  ],
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("TaskToastApp", () => {
  it("does not restart collapse when the desktop watchdog repeats an outside pointer state", async () => {
    vi.useFakeTimers();
    let show: ((value: TaskToastDisplayPayload) => void) | undefined;
    let nativePointer: ((value: { inside: boolean; x?: number; y?: number }) => void) | undefined;
    const bridge: TaskToastAppBridge = {
      listen: vi.fn(async (handlers) => {
        show = handlers.onDisplay;
        nativePointer = handlers.onNativePointer;
        return () => undefined;
      }),
      emitAction: vi.fn(async () => undefined),
    };
    render(<TaskToastApp bridge={bridge} />);
    await act(async () => Promise.resolve());

    act(() => show?.(groupedPayload));
    act(() => nativePointer?.({ inside: true, x: 120, y: 48 }));
    expect(screen.getByRole("group", { name: "4 task statuses, 5 tasks" }))
      .toHaveAttribute("data-outer-expanded", "true");

    act(() => nativePointer?.({ inside: false }));
    act(() => vi.advanceTimersByTime(120));
    act(() => nativePointer?.({ inside: false }));
    act(() => vi.advanceTimersByTime(40));

    expect(screen.getByRole("group", { name: "4 task statuses, 5 tasks" }))
      .toHaveAttribute("data-outer-expanded", "false");
  });

  it("polls the desktop pointer so an inactive capsule expands, reveals actions, and collapses", async () => {
    vi.useFakeTimers();
    let show: ((value: TaskToastDisplayPayload) => void) | undefined;
    let pointer = { inside: false } as { inside: boolean; x?: number; y?: number };
    const bridge: TaskToastAppBridge = {
      listen: vi.fn(async (handlers) => {
        show = handlers.onDisplay;
        return () => undefined;
      }),
      emitAction: vi.fn(async () => undefined),
      readPointer: vi.fn(async () => pointer),
    };
    render(<TaskToastApp bridge={bridge} />);
    await act(async () => Promise.resolve());

    act(() => show?.(groupedPayload));
    expect(screen.getByRole("group", { name: "4 task statuses, 5 tasks" }))
      .toHaveAttribute("data-outer-expanded", "false");
    await act(async () => {
      await Promise.resolve();
    });

    pointer = { inside: true, x: 120, y: 48 };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120);
    });
    expect(screen.getByRole("group", { name: "4 task statuses, 5 tasks" }))
      .toHaveAttribute("data-outer-expanded", "true");
    expect(screen.getByRole("button", { name: "Go to Codex" })).toBeInTheDocument();

    pointer = { inside: false };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(160);
    });
    expect(screen.getByRole("group", { name: "4 task statuses, 5 tasks" }))
      .toHaveAttribute("data-outer-expanded", "false");
    expect(screen.queryByRole("button", { name: "Go to Codex" })).not.toBeInTheDocument();
  });

  it("reveals the hovered task actions from native pointer events while another app is active", async () => {
    let show: ((value: TaskToastDisplayPayload) => void) | undefined;
    let nativePointer: ((value: { inside: boolean; x?: number; y?: number }) => void) | undefined;
    const bridge: TaskToastAppBridge = {
      listen: vi.fn(async (handlers) => {
        show = handlers.onDisplay;
        nativePointer = handlers.onNativePointer;
        return () => undefined;
      }),
      emitAction: vi.fn(async () => undefined),
    };
    render(<TaskToastApp bridge={bridge} />);
    await waitFor(() => expect(show).toBeDefined());

    show?.(payload);
    await screen.findByText("Needs input");
    expect(screen.queryByRole("button", { name: "Go to Codex" })).not.toBeInTheDocument();

    nativePointer?.({ inside: true, x: 120, y: 48 });
    expect(await screen.findByRole("button", { name: "Go to Codex" })).toBeInTheDocument();
  });

  it("renders display events, emits actions, and clears on hide", async () => {
    let show: ((value: TaskToastDisplayPayload) => void) | undefined;
    let hide: (() => void) | undefined;
    const emitAction = vi.fn(async () => undefined);
    const bridge: TaskToastAppBridge = {
      listen: vi.fn(async (handlers) => {
        show = handlers.onDisplay;
        hide = handlers.onHide;
        return () => undefined;
      }),
      emitAction,
    };
    render(<TaskToastApp bridge={bridge} />);
    await waitFor(() => expect(show).toBeDefined());

    show?.(payload);
    await screen.findByText("Needs input");
    fireEvent.mouseEnter(screen.getByRole("status"));
    fireEvent.click(screen.getByRole("button", { name: "Remind me later" }));
    expect(emitAction).toHaveBeenCalledWith({ type: "postpone", threadId: "thread-one" });

    hide?.();
    await waitFor(() => expect(screen.queryByText("Needs input")).not.toBeInTheDocument());
  });

  it("renders grouped task statuses and reports both expansion levels", async () => {
    let show: ((value: TaskToastDisplayPayload) => void) | undefined;
    const emitAction = vi.fn(async () => undefined);
    const bridge: TaskToastAppBridge = {
      listen: vi.fn(async (handlers) => {
        show = handlers.onDisplay;
        return () => undefined;
      }),
      emitAction,
    };
    render(<TaskToastApp bridge={bridge} />);
    await waitFor(() => expect(show).toBeDefined());

    show?.(groupedPayload);
    const stack = await screen.findByRole("group", { name: "4 task statuses, 5 tasks" });
    expect(screen.getAllByTestId("task-status-group")).toHaveLength(1);
    fireEvent.mouseEnter(stack);

    await waitFor(() => expect(emitAction).toHaveBeenCalledWith({
      type: "setGroupLayout",
      layout: { outerExpanded: true, expandedStatus: null },
    }));
    expect(screen.getAllByTestId("task-status-group")).toHaveLength(4);

    fireEvent.click(screen.getByRole("button", { name: "Expand 2 Needs input tasks" }));

    await waitFor(() => expect(emitAction).toHaveBeenCalledWith({
      type: "setGroupLayout",
      layout: { outerExpanded: true, expandedStatus: "needsInput" },
    }));
    expect(screen.getByRole("region", { name: "Needs input tasks" })).toBeInTheDocument();
  });

  it("renders the first-use task reminder choice and emits either decision", async () => {
    let show: ((value: TaskToastDisplayPayload) => void) | undefined;
    const emitAction = vi.fn(async () => undefined);
    const bridge: TaskToastAppBridge = {
      listen: vi.fn(async (handlers) => {
        show = handlers.onDisplay;
        return () => undefined;
      }),
      emitAction,
    };
    render(<TaskToastApp bridge={bridge} />);
    await waitFor(() => expect(show).toBeDefined());

    show?.({ kind: "permission", direction: "top", language: "zh-CN" });
    expect(await screen.findByText("是否开启任务提醒")).toBeInTheDocument();
    expect(document.querySelector(".task-permission-toast .task-toast-dot"))
      .not.toBeInTheDocument();
    expect(screen.getByText("Codex 任务需要处理或完成时，在悬浮球旁提醒你。"))
      .toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "开启" }));
    fireEvent.click(screen.getByRole("button", { name: "暂不开启" }));
    expect(emitAction).toHaveBeenNthCalledWith(1, { type: "enableTaskNotifications" });
    expect(emitAction).toHaveBeenNthCalledWith(2, { type: "dismissTaskNotifications" });
  });
});
