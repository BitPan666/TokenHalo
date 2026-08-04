// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TaskStatusRing } from "./TaskStatusRing";

afterEach(cleanup);

describe("TaskStatusRing", () => {
  it.each([
    ["working", "Codex 正在工作"],
    ["needsInput", "Codex 需要你的输入"],
    ["completed", "Codex 任务已完成"],
    ["failed", "Codex 任务失败"],
  ] as const)("exposes an explicit accessible label for %s", (status, label) => {
    render(<TaskStatusRing status={status} attentionCount={0} language="zh-CN" />);

    expect(screen.getByRole("status", { name: label })).toHaveClass(
      "task-status-ring",
      `task-status-ring--${status}`,
    );
  });

  it("caps the unresolved attention badge at 9+", () => {
    render(<TaskStatusRing status="needsInput" attentionCount={12} language="en" />);

    expect(screen.getByText("9+")).toHaveAttribute("aria-label", "12 tasks need attention");
  });

  it("does not render a badge for a single unresolved task", () => {
    render(<TaskStatusRing status="failed" attentionCount={1} language="en" />);

    expect(screen.queryByText("1")).not.toBeInTheDocument();
  });
});
