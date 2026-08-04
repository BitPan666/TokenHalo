// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TaskToastDisplayPayload } from "./lib/taskToastWindow";
import { TaskToastApp, type TaskToastAppBridge } from "./TaskToastApp";

const payload: TaskToastDisplayPayload = {
  entry: {
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
  },
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
    fireEvent.click(screen.getByRole("button", { name: "Later" }));
    expect(emitAction).toHaveBeenCalledWith({ type: "postpone", threadId: "thread-one" });

    hide?.();
    await waitFor(() => expect(screen.queryByText("Needs your input")).not.toBeInTheDocument());
  });
});
