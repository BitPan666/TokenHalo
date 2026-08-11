// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TaskCompanionEntry, TaskCompanionStatus } from "../lib/taskCompanion";
import { groupTaskEntries } from "../lib/taskStatusGroups";
import { TaskStatusGroupStack } from "./TaskStatusGroupStack";

function entry(
  threadId: string,
  status: TaskCompanionStatus,
  taskTitle: string,
  minute: number,
): TaskCompanionEntry {
  return {
    event: {
      schemaVersion: 1,
      eventId: `${threadId}-${status}`,
      threadId,
      turnId: `${threadId}-turn`,
      status,
      occurredAt: `2026-08-11T10:${String(minute).padStart(2, "0")}:00.000Z`,
      projectName: "TokenHalo",
      taskTitle,
      durationMs: 12_000,
      source: "simulator",
    },
    acknowledged: false,
    postponedUntil: null,
    toastExpired: false,
  };
}

const entries = [
  entry("input-a", "needsInput", "确认安装权限", 9),
  entry("input-b", "needsInput", "审核任务通知", 8),
  entry("input-c", "needsInput", "选择发布版本", 7),
  entry("failed-a", "failed", "修复桌面打包", 6),
  entry("failed-b", "failed", "恢复构建任务", 5),
  entry("completed-a", "completed", "完善任务胶囊", 4),
  entry("completed-b", "completed", "补充交互测试", 3),
  entry("working-a", "working", "生成网页版交互", 2),
  entry("working-b", "working", "整理视觉细节", 1),
];

function props(overrides: Partial<Parameters<typeof TaskStatusGroupStack>[0]> = {}) {
  return {
    groups: groupTaskEntries(entries),
    direction: "top" as const,
    language: "zh-CN" as const,
    reducedMotion: false,
    onOpen: vi.fn(),
    onDismiss: vi.fn(),
    onPostpone: vi.fn(),
    onInteractionChange: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("TaskStatusGroupStack", () => {
  it("shows only the highest-priority group until the shared region is hovered", () => {
    render(<TaskStatusGroupStack {...props()} />);
    const stack = screen.getByRole("group", { name: "4 种任务状态，9 个任务" });

    expect(stack).toHaveAttribute("data-outer-expanded", "false");
    expect(screen.getAllByTestId("task-status-group")).toHaveLength(1);
    expect(screen.getByText("需要处理 · 3")).toBeInTheDocument();
    expect(screen.queryByText("执行失败 · 2")).not.toBeInTheDocument();

    fireEvent.mouseEnter(stack);

    expect(stack).toHaveAttribute("data-outer-expanded", "true");
    expect(screen.getAllByTestId("task-status-group")).toHaveLength(4);
    expect(screen.getByText("执行失败 · 2")).toBeInTheDocument();
    expect(screen.queryByText("+1")).not.toBeInTheDocument();
  });

  it("expands one status group at a time and exposes all tasks in that group", () => {
    render(<TaskStatusGroupStack {...props()} />);
    const stack = screen.getByRole("group", { name: "4 种任务状态，9 个任务" });
    fireEvent.mouseEnter(stack);

    fireEvent.click(screen.getByRole("button", { name: "展开需要处理的 3 个任务" }));
    expect(screen.getByRole("region", { name: "需要处理任务" })).toBeInTheDocument();
    expect(screen.getByText("确认安装权限")).toBeInTheDocument();
    expect(screen.getByText("审核任务通知")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "展开执行失败的 2 个任务" }));
    expect(screen.queryByRole("region", { name: "需要处理任务" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "执行失败任务" })).toBeInTheDocument();
  });

  it("compacts the other status summaries while one status group is open", () => {
    render(<TaskStatusGroupStack {...props()} />);
    const stack = screen.getByRole("group", { name: "4 种任务状态，9 个任务" });
    fireEvent.mouseEnter(stack);

    fireEvent.click(screen.getByRole("button", { name: "展开需要处理的 3 个任务" }));

    expect(screen.getByRole("status", { name: "执行失败：修复桌面打包" }))
      .toHaveAttribute("data-compact", "true");
    expect(screen.getByRole("status", { name: "需要处理：确认安装权限" }))
      .toHaveAttribute("data-compact", "false");
  });

  it("dismisses only the hovered top task without triggering its other actions", () => {
    const onDismiss = vi.fn();
    const onOpen = vi.fn();
    const onPostpone = vi.fn();
    render(<TaskStatusGroupStack {...props({ onDismiss, onOpen, onPostpone })} />);
    const card = screen.getByRole("status", { name: "需要处理：确认安装权限" });

    fireEvent.mouseEnter(card);
    fireEvent.click(screen.getByRole("button", { name: "忽略任务：确认安装权限" }));

    expect(onDismiss).toHaveBeenCalledWith("input-a");
    expect(onOpen).not.toHaveBeenCalled();
    expect(onPostpone).not.toHaveBeenCalled();
  });

  it("shows actions only for the task under the pointer and routes them by task", () => {
    const onOpen = vi.fn();
    const onPostpone = vi.fn();
    render(<TaskStatusGroupStack {...props({ onOpen, onPostpone })} />);
    const card = screen.getByRole("status", { name: "需要处理：确认安装权限" });

    expect(screen.queryByRole("button", { name: "前往 Codex" })).not.toBeInTheDocument();
    fireEvent.mouseEnter(card);
    fireEvent.click(screen.getByRole("button", { name: "前往 Codex" }));
    fireEvent.click(screen.getByRole("button", { name: "稍后提醒" }));

    expect(onOpen).toHaveBeenCalledWith("input-a");
    expect(onPostpone).toHaveBeenCalledWith("input-a");
  });

  it("waits 160ms before collapsing the whole region", () => {
    vi.useFakeTimers();
    render(<TaskStatusGroupStack {...props()} />);
    const stack = screen.getByRole("group", { name: "4 种任务状态，9 个任务" });
    fireEvent.mouseEnter(stack);
    fireEvent.mouseLeave(stack);

    act(() => vi.advanceTimersByTime(159));
    expect(stack).toHaveAttribute("data-outer-expanded", "true");
    act(() => vi.advanceTimersByTime(1));
    expect(stack).toHaveAttribute("data-outer-expanded", "false");
  });

  it("uses Escape to close the inner group before collapsing the outer groups", () => {
    render(<TaskStatusGroupStack {...props()} />);
    const stack = screen.getByRole("group", { name: "4 种任务状态，9 个任务" });
    fireEvent.mouseEnter(stack);
    fireEvent.click(screen.getByRole("button", { name: "展开需要处理的 3 个任务" }));

    fireEvent.keyDown(stack, { key: "Escape" });
    expect(screen.queryByRole("region", { name: "需要处理任务" })).not.toBeInTheDocument();
    expect(stack).toHaveAttribute("data-outer-expanded", "true");

    fireEvent.keyDown(stack, { key: "Escape" });
    expect(stack).toHaveAttribute("data-outer-expanded", "false");
  });
});
