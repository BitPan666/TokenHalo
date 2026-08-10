// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TaskCompanionPlayground } from "./TaskCompanionPlayground";

afterEach(cleanup);

describe("TaskCompanionPlayground", () => {
  it("previews the production multi-task stack and expands it on hover", () => {
    const { container } = render(<TaskCompanionPlayground />);

    fireEvent.click(screen.getByRole("button", { name: "多任务堆叠" }));
    const stack = screen.getByRole("group", { name: "5 条任务提醒" });
    expect(screen.getByText("+2")).toBeInTheDocument();
    expect(stack).toHaveAttribute("data-expanded", "false");

    fireEvent.mouseEnter(stack);
    expect(stack).toHaveAttribute("data-expanded", "true");
    expect(container.querySelector(".task-playground-toast"))
      .toHaveStyle({ height: "304px" });
  });

  it("drives the production ring and toast through status, direction, and language controls", () => {
    const { container } = render(<TaskCompanionPlayground />);

    expect(screen.getByText("正在工作")).toBeInTheDocument();
    expect(container.querySelector(".task-toast--top")).toBeInTheDocument();
    expect(container.querySelector(".task-playground-toast"))
      .toHaveStyle({ transform: "translate(0px, -106px)" });

    fireEvent.click(screen.getByRole("button", { name: "Needs input" }));
    fireEvent.click(screen.getByRole("button", { name: "Left" }));
    fireEvent.click(screen.getByRole("button", { name: "English" }));

    expect(screen.getByText("Needs your input")).toBeInTheDocument();
    expect(container.querySelector(".task-toast--left")).toBeInTheDocument();
    expect(container.querySelector(".task-playground-toast"))
      .toHaveStyle({ transform: "translate(-188px, 0px)" });
    expect(screen.getByRole("status", { name: "Codex needs your input" }))
      .toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "中文" }));
    fireEvent.click(screen.getByRole("button", { name: "首次询问" }));
    expect(screen.getByText("是否开启任务提醒")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "开启" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "暂不开启" })).toBeInTheDocument();
  });
});
