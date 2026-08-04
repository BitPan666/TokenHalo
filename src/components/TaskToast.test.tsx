// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TaskCompanionEntry, TaskCompanionStatus } from "../lib/taskCompanion";
import { TaskToast } from "./TaskToast";

function entry(
  status: TaskCompanionStatus,
  overrides: Partial<TaskCompanionEntry["event"]> = {},
): TaskCompanionEntry {
  return {
    event: {
      schemaVersion: 1,
      eventId: `event-${status}`,
      threadId: "thread-one",
      turnId: "turn-one",
      status,
      occurredAt: "2026-08-04T10:00:00.000Z",
      projectName: "TokenHalo",
      taskTitle: "Implement companion",
      durationMs: 65_000,
      source: "simulator",
      ...overrides,
    },
    acknowledged: false,
    postponedUntil: null,
    toastExpired: false,
  };
}

const actions = {
  onOpen: vi.fn(),
  onAcknowledge: vi.fn(),
  onPostpone: vi.fn(),
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TaskToast", () => {
  it.each([
    ["working", "正在工作"],
    ["needsInput", "需要你的输入"],
    ["completed", "任务已完成"],
    ["failed", "任务失败"],
  ] as const)("renders explicit Chinese copy for %s", (status, copy) => {
    render(
      <TaskToast
        entry={entry(status)}
        direction="top"
        language="zh-CN"
        openAction="app"
        {...actions}
      />,
    );

    expect(screen.getByText(copy)).toBeInTheDocument();
    expect(screen.getByText("TokenHalo")).toBeInTheDocument();
    expect(screen.getByText("1m 5s")).toBeInTheDocument();
  });

  it("falls back from project name to task title and then Codex task", () => {
    const { rerender } = render(
      <TaskToast
        entry={entry("working", { projectName: "", taskTitle: "Refactor settings" })}
        direction="left"
        language="en"
        openAction="none"
        {...actions}
      />,
    );
    expect(screen.getByText("Refactor settings")).toBeInTheDocument();

    rerender(
      <TaskToast
        entry={entry("working", { projectName: null, taskTitle: null })}
        direction="left"
        language="en"
        openAction="none"
        {...actions}
      />,
    );
    expect(screen.getByText("Codex task")).toBeInTheDocument();
  });

  it("uses the selected direction for the connector and entrance class", () => {
    const { container } = render(
      <TaskToast
        entry={entry("completed")}
        direction="right"
        language="en"
        openAction="app"
        {...actions}
      />,
    );

    expect(container.firstElementChild).toHaveClass("task-toast--right");
    expect(container.querySelector(".task-toast-connector")).toBeInTheDocument();
  });

  it("offers Later for needs input and dismiss for terminal states", () => {
    const { rerender } = render(
      <TaskToast
        entry={entry("needsInput")}
        direction="top"
        language="en"
        openAction="app"
        {...actions}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Later" }));
    expect(actions.onPostpone).toHaveBeenCalledOnce();

    rerender(
      <TaskToast
        entry={entry("failed")}
        direction="top"
        language="en"
        openAction="app"
        {...actions}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(actions.onAcknowledge).toHaveBeenCalledOnce();
  });

  it("labels the primary action by its real capability", () => {
    const { rerender } = render(
      <TaskToast
        entry={entry("failed")}
        direction="bottom"
        language="en"
        openAction="task"
        {...actions}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open task" }));
    expect(actions.onOpen).toHaveBeenCalledOnce();

    rerender(
      <TaskToast
        entry={entry("failed")}
        direction="bottom"
        language="en"
        openAction="app"
        {...actions}
      />,
    );
    expect(screen.getByRole("button", { name: "Open Codex" })).toBeInTheDocument();

    rerender(
      <TaskToast
        entry={entry("failed")}
        direction="bottom"
        language="en"
        openAction="none"
        {...actions}
      />,
    );
    expect(screen.queryByRole("button", { name: /Open/ })).not.toBeInTheDocument();
  });
});
