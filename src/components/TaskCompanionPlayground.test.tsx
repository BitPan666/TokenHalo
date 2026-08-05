// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TaskCompanionPlayground } from "./TaskCompanionPlayground";

afterEach(cleanup);

describe("TaskCompanionPlayground", () => {
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
  });
});
