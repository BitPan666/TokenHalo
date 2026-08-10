// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error Vitest executes this test in Node; the app does not ship Node types.
import { readFileSync } from "node:fs";
// @ts-expect-error Vitest executes this test in Node; the app does not ship Node types.
import { resolve } from "node:path";
import { TaskStatusRing } from "./TaskStatusRing";

declare const process: { cwd: () => string };

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

  it("renders the working light as a restrained inward glow from every edge", () => {
    const style = document.createElement("style");
    style.textContent = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    document.head.append(style);
    render(<TaskStatusRing status="working" attentionCount={0} language="zh-CN" />);

    const ring = screen.getByRole("status");
    const glow = ring.querySelector(".task-status-inset-glow");
    const glowRule = Array.from((style.sheet as CSSStyleSheet).cssRules)
      .find((rule) => rule.cssText.startsWith(".task-status-inset-glow {")) as CSSStyleRule | undefined;
    const workingGlowRule = Array.from((style.sheet as CSSStyleSheet).cssRules)
      .find((rule): rule is CSSStyleRule => (
        rule instanceof CSSStyleRule
        && rule.selectorText === ".task-status-ring--working .task-status-inset-glow"
      ));
    expect(glow).toBeInTheDocument();
    expect(getComputedStyle(ring).boxShadow).toBe("none");
    expect(glowRule?.style.getPropertyValue("background-image")).toBe("none");
    expect(glowRule?.style.getPropertyValue("box-shadow")).toContain("inset 0 0");
    expect(glowRule?.style.transform).toBe("none");
    expect(workingGlowRule?.style.animation).toContain("task-inset-light-breathe");

    style.remove();
  });
});
