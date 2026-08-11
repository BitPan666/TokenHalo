// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskCompanionPlayground } from "./TaskCompanionPlayground";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("TaskCompanionPlayground", () => {
  it("previews four status groups without an ambiguous overflow badge", () => {
    render(<TaskCompanionPlayground />);
    const stack = screen.getByRole("group", { name: "4 种任务状态，9 个任务" });

    expect(screen.getByText("需要处理 · 3")).toBeInTheDocument();
    expect(screen.queryByText("执行失败 · 2")).not.toBeInTheDocument();
    expect(screen.queryByText("+1")).not.toBeInTheDocument();

    fireEvent.mouseEnter(stack);

    expect(screen.getAllByTestId("task-status-group")).toHaveLength(4);
    expect(screen.getByText("执行失败 · 2")).toBeInTheDocument();
    expect(screen.getByText("任务已完成 · 2")).toBeInTheDocument();
    expect(screen.getByText("正在工作 · 2")).toBeInTheDocument();
  });

  it("shows five same-status tasks in one expandable group", () => {
    render(<TaskCompanionPlayground />);
    fireEvent.click(screen.getByRole("button", { name: "同状态 5 条" }));

    expect(screen.getByRole("group", { name: "1 种任务状态，5 个任务" })).toBeInTheDocument();
    expect(screen.getByText("正在工作 · 5")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "展开正在工作的 5 个任务" }));

    const region = screen.getByRole("region", { name: "正在工作任务" });
    expect(region).toHaveClass("task-group-list");
    expect(within(region).getAllByRole("status")).toHaveLength(5);
  });

  it("dismisses the newest task and promotes the next task in its status", () => {
    render(<TaskCompanionPlayground />);
    const card = screen.getByRole("status", { name: "需要处理：确认开发版通知权限" });
    fireEvent.mouseEnter(card);
    fireEvent.click(screen.getByRole("button", { name: "忽略任务：确认开发版通知权限" }));

    expect(screen.queryByText("确认开发版通知权限")).not.toBeInTheDocument();
    expect(screen.getByText("审核任务提醒设置")).toBeInTheDocument();
    expect(screen.getByText("需要处理 · 2")).toBeInTheDocument();
  });

  it("switches placement and reduced motion from the preview controls", () => {
    const { container } = render(<TaskCompanionPlayground />);
    fireEvent.click(screen.getByRole("button", { name: "右侧" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "减少动态效果" }));

    expect(container.querySelector(".task-playground-group-preview"))
      .toHaveAttribute("data-direction", "right");
    expect(container.querySelector(".task-group-stack"))
      .toHaveAttribute("data-reduced-motion", "true");
  });

  it("pauses the six-second completed countdown while the stack is active", () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-08-11T12:00:00.000Z"));
    render(<TaskCompanionPlayground />);
    const stack = screen.getByRole("group", { name: "4 种任务状态，9 个任务" });

    fireEvent.mouseEnter(stack);
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByRole("group", { name: "4 种任务状态，9 个任务" })).toBeInTheDocument();

    fireEvent.mouseLeave(stack);
    act(() => vi.advanceTimersByTime(160));
    act(() => vi.advanceTimersByTime(5_999));
    expect(screen.getByRole("group", { name: "4 种任务状态，9 个任务" })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole("group", { name: "3 种任务状态，7 个任务" })).toBeInTheDocument();
  });
});
