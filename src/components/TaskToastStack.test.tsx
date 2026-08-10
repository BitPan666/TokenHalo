// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TaskCompanionEntry, TaskCompanionStatus } from "../lib/taskCompanion";
import { TaskToastStack } from "./TaskToastStack";

function entry(threadId: string, status: TaskCompanionStatus): TaskCompanionEntry {
  return {
    event: {
      schemaVersion: 1,
      eventId: `${threadId}-${status}`,
      threadId,
      turnId: `${threadId}-turn`,
      status,
      occurredAt: "2026-08-10T08:00:00.000Z",
      projectName: "TokenHalo",
      taskTitle: `Task ${threadId}`,
      durationMs: 12_000,
      source: "simulator",
    },
    acknowledged: false,
    postponedUntil: null,
    toastExpired: false,
  };
}

const entries = [
  entry("input", "needsInput"),
  entry("failed", "failed"),
  entry("completed", "completed"),
];

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function props(overrides: Partial<Parameters<typeof TaskToastStack>[0]> = {}) {
  return {
    entries,
    hiddenCount: 2,
    expanded: false,
    growth: "up" as const,
    direction: "top" as const,
    language: "zh-CN" as const,
    openAction: "app" as const,
    onExpandedChange: vi.fn(),
    onOpen: vi.fn(),
    onAcknowledge: vi.fn(),
    onPostpone: vi.fn(),
    ...overrides,
  };
}

describe("TaskToastStack", () => {
  it("defines transparent 11px peeks and 104px expanded steps", () => {
    const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

    expect(styles).toContain("--task-stack-collapsed-offset: 11px");
    expect(styles).toContain("--task-stack-expanded-step: 104px");
    expect(styles).toContain(".task-toast-stack[data-expanded=\"false\"]");
    expect(styles).toContain("background: transparent");
  });

  it("shows three stacked cards and expands the shared region on hover", () => {
    const onExpandedChange = vi.fn();
    const view = render(<TaskToastStack {...props({ onExpandedChange })} />);
    const stack = view.container.querySelector(".task-toast-stack");

    expect(screen.getAllByRole("status")).toHaveLength(3);
    expect(screen.getByText("+2")).toBeInTheDocument();
    expect(stack).toHaveAttribute("data-expanded", "false");

    fireEvent.mouseEnter(stack!);
    expect(onExpandedChange).toHaveBeenCalledWith(true);

    view.rerender(<TaskToastStack {...props({ expanded: true, onExpandedChange })} />);
    expect(stack).toHaveAttribute("data-expanded", "true");
  });

  it("shows actions only on the card currently under the pointer", () => {
    render(<TaskToastStack {...props({ expanded: true })} />);
    const cards = screen.getAllByRole("status");

    expect(screen.queryByRole("button", { name: "打开 Codex" })).not.toBeInTheDocument();
    fireEvent.mouseEnter(cards[1]);
    expect(screen.getAllByRole("button", { name: "打开 Codex" })).toHaveLength(1);
    fireEvent.mouseLeave(cards[1]);
    expect(screen.queryByRole("button", { name: "打开 Codex" })).not.toBeInTheDocument();
  });

  it("collapses 160ms after the pointer leaves the whole stack", () => {
    vi.useFakeTimers();
    const onExpandedChange = vi.fn();
    const view = render(<TaskToastStack {...props({ expanded: true, onExpandedChange })} />);
    const stack = view.container.querySelector(".task-toast-stack");

    fireEvent.mouseLeave(stack!);
    act(() => vi.advanceTimersByTime(159));
    expect(onExpandedChange).not.toHaveBeenCalledWith(false);
    act(() => vi.advanceTimersByTime(1));
    expect(onExpandedChange).toHaveBeenCalledWith(false);
  });

  it("routes a card action to its own task without toggling the stack", () => {
    const onOpen = vi.fn();
    const onExpandedChange = vi.fn();
    render(<TaskToastStack {...props({ expanded: true, onOpen, onExpandedChange })} />);
    const failedCard = screen.getAllByRole("status")[1];

    fireEvent.mouseEnter(failedCard);
    fireEvent.click(screen.getByRole("button", { name: "打开 Codex" }));

    expect(onOpen).toHaveBeenCalledWith("failed");
    expect(onExpandedChange).not.toHaveBeenCalled();
  });

  it("expands for keyboard focus and collapses on Escape", () => {
    const onExpandedChange = vi.fn();
    const view = render(<TaskToastStack {...props({ expanded: false, onExpandedChange })} />);
    const stack = view.container.querySelector(".task-toast-stack");
    const firstCard = screen.getAllByRole("status")[0];

    fireEvent.focus(firstCard);
    expect(onExpandedChange).toHaveBeenCalledWith(true);
    fireEvent.keyDown(stack!, { key: "Escape" });
    expect(onExpandedChange).toHaveBeenLastCalledWith(false);
  });
});
