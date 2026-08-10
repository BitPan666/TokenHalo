// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

afterEach(cleanup);

describe("TaskToastApp", () => {
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
    await screen.findByText("Needs your input");
    fireEvent.mouseEnter(screen.getByRole("status"));
    fireEvent.click(screen.getByRole("button", { name: "Later" }));
    expect(emitAction).toHaveBeenCalledWith({ type: "postpone", threadId: "thread-one" });

    hide?.();
    await waitFor(() => expect(screen.queryByText("Needs your input")).not.toBeInTheDocument());
  });

  it("renders the shared task stack and reports expansion changes", async () => {
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

    show?.({ ...payload, hiddenCount: 2 });
    const stack = await screen.findByRole("group", { name: "3 task notifications" });
    fireEvent.mouseEnter(stack);

    expect(emitAction).toHaveBeenCalledWith({ type: "setStackExpanded", expanded: true });
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
