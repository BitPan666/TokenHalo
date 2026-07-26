// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WidgetPreferences } from "../types";
import { AppearanceSheet } from "./AppearanceSheet";

const preferences: WidgetPreferences = {
  locked: false,
  alwaysOnTop: true,
  pinnedProvider: null,
  autoRotateSeconds: 12,
  language: "zh-CN",
  expandedView: "tokenStats",
  glassTransparency: 40,
  glassBlurStrength: 40,
  glassStyle: "regular",
};

afterEach(cleanup);

describe("AppearanceSheet", () => {
  it("shows transparency plus native glass style and three effect strengths", () => {
    render(
      <AppearanceSheet
        preferences={preferences}
        onPreview={vi.fn()}
        onSave={vi.fn().mockResolvedValue(undefined)}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("slider", { name: "玻璃透明度" })).toHaveValue("40");
    expect(screen.getByRole("slider", { name: "玻璃透明度" }))
      .toHaveAttribute("min", "10");
    expect(screen.getByRole("slider", { name: "玻璃透明度" }))
      .toHaveAttribute("max", "90");
    expect(screen.getByRole("button", { name: "清透" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "标准" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "弱" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "中" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "强" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("slider", { name: "背景模糊强度" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/边框高光/)).not.toBeInTheDocument();
  });

  it("previews and saves native glass style and effect strength choices", async () => {
    const onPreview = vi.fn();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <AppearanceSheet
        preferences={preferences}
        onPreview={onPreview}
        onSave={onSave}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "清透" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      glassStyle: "clear",
    })));
    expect(onPreview).toHaveBeenCalledWith(expect.objectContaining({
      glassStyle: "clear",
    }));

    fireEvent.click(screen.getByRole("button", { name: "强" }));
    await waitFor(() => expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({
      glassStyle: "clear",
      glassBlurStrength: 60,
    })));
  });

  it("previews CSS variables immediately without writing during input", () => {
    const onPreview = vi.fn();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <AppearanceSheet
        preferences={preferences}
        onPreview={onPreview}
        onSave={onSave}
        onClose={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByRole("slider", { name: "玻璃透明度" }), {
      target: { value: "55" },
    });

    expect(screen.getByRole("dialog")).toHaveStyle({
      "--glass-transparency": "55",
      "--glass-blur-strength": "40",
      "--glass-alpha": "0.45",
    });
    expect(onPreview).toHaveBeenLastCalledWith(expect.objectContaining({
      glassTransparency: 55,
      glassBlurStrength: 40,
    }));
    expect(onSave).not.toHaveBeenCalled();
  });

  it("persists changed values once on release and retains them on success", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <AppearanceSheet
        preferences={preferences}
        onPreview={vi.fn()}
        onSave={onSave}
        onClose={vi.fn()}
      />,
    );
    const transparency = screen.getByRole("slider", { name: "玻璃透明度" });

    fireEvent.change(transparency, { target: { value: "55" } });
    fireEvent.pointerUp(transparency);
    fireEvent.keyUp(transparency, { key: "ArrowRight" });

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      glassTransparency: 55,
      glassBlurStrength: 40,
    }));
    expect(transparency).toHaveValue("55");
  });

  it("restores the latest saved values and reports a non-blocking error", async () => {
    const onPreview = vi.fn();
    const onSave = vi.fn().mockRejectedValue(new Error("disk full"));
    render(
      <AppearanceSheet
        preferences={preferences}
        onPreview={onPreview}
        onSave={onSave}
        onClose={vi.fn()}
      />,
    );
    const transparency = screen.getByRole("slider", { name: "玻璃透明度" });

    fireEvent.change(transparency, { target: { value: "55" } });
    fireEvent.pointerUp(transparency);

    expect(await screen.findByText(
      "设置保存失败，已恢复上一次保存的外观。",
    )).toHaveAttribute("role", "status");
    expect(transparency).toHaveValue("40");
    expect(onPreview).toHaveBeenLastCalledWith(expect.objectContaining({
      glassTransparency: 40,
      glassBlurStrength: 40,
    }));
  });

  it("keeps an active draft while adopting a newer external rollback baseline", async () => {
    const onPreview = vi.fn();
    const onSave = vi.fn().mockRejectedValue(new Error("disk full"));
    const { rerender } = render(
      <AppearanceSheet
        preferences={preferences}
        onPreview={onPreview}
        onSave={onSave}
        onClose={vi.fn()}
      />,
    );
    const transparency = screen.getByRole("slider", { name: "玻璃透明度" });

    fireEvent.change(transparency, { target: { value: "55" } });
    rerender(
      <AppearanceSheet
        preferences={{
          ...preferences,
          glassTransparency: 30,
          glassBlurStrength: 20,
        }}
        onPreview={onPreview}
        onSave={onSave}
        onClose={vi.fn()}
      />,
    );
    expect(transparency).toHaveValue("55");

    fireEvent.pointerUp(transparency);
    await screen.findByText("设置保存失败，已恢复上一次保存的外观。");
    expect(transparency).toHaveValue("30");
    expect(screen.getByRole("button", { name: "弱" }))
      .toHaveAttribute("aria-pressed", "true");
  });

  it("clears a dirty draft when the authoritative baseline catches up", () => {
    const onPreview = vi.fn();
    const props = {
      onPreview,
      onSave: vi.fn().mockResolvedValue(undefined),
      onClose: vi.fn(),
    };
    const { rerender } = render(
      <AppearanceSheet preferences={preferences} {...props} />,
    );
    const transparency = screen.getByRole("slider", { name: "玻璃透明度" });

    fireEvent.change(transparency, { target: { value: "55" } });
    rerender(
      <AppearanceSheet
        preferences={{ ...preferences, glassTransparency: 55 }}
        {...props}
      />,
    );
    expect(transparency).toHaveValue("55");

    rerender(
      <AppearanceSheet
        preferences={{ ...preferences, glassTransparency: 60 }}
        {...props}
      />,
    );
    expect(transparency).toHaveValue("60");
    expect(onPreview).toHaveBeenLastCalledWith(expect.objectContaining({
      glassTransparency: 60,
    }));
  });

  it("resets all appearance values and persists the reset exactly once", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <AppearanceSheet
        preferences={{
          ...preferences,
          glassTransparency: 65,
          glassBlurStrength: 25,
          glassStyle: "clear",
        }}
        onPreview={vi.fn()}
        onSave={onSave}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "恢复默认外观" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      glassTransparency: 40,
      glassBlurStrength: 40,
      glassStyle: "regular",
    }));
    expect(screen.getByRole("slider", { name: "玻璃透明度" })).toHaveValue("40");
    expect(screen.getByRole("button", { name: "中" }))
      .toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "标准" }))
      .toHaveAttribute("aria-pressed", "true");
  });

  it("always explains the local-only and potentially inaccurate data boundary", () => {
    render(
      <AppearanceSheet
        preferences={preferences}
        onPreview={vi.fn()}
        onSave={vi.fn().mockResolvedValue(undefined)}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText(/仅统计本机可读取的 Codex 日志/))
      .toBeInTheDocument();
    expect(screen.getByText(/不代表官方账单或账户级用量/))
      .toBeInTheDocument();
  });

  it("keeps keyboard focus inside the modal sheet", () => {
    render(
      <AppearanceSheet
        preferences={preferences}
        onPreview={vi.fn()}
        onSave={vi.fn().mockResolvedValue(undefined)}
        onClose={vi.fn()}
      />,
    );
    const dialog = screen.getByRole("dialog");
    const close = screen.getByRole("button", { name: "关闭设置与说明" });
    const reset = screen.getByRole("button", { name: "恢复默认外观" });

    reset.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(close).toHaveFocus();

    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(reset).toHaveFocus();
  });

  it("persists an active slider gesture when pointer release happens outside", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <AppearanceSheet
        preferences={preferences}
        onPreview={vi.fn()}
        onSave={onSave}
        onClose={vi.fn()}
      />,
    );
    const slider = screen.getByRole("slider", { name: "玻璃透明度" });

    fireEvent.pointerDown(slider, { pointerId: 7 });
    fireEvent.change(slider, { target: { value: "55" } });
    fireEvent.pointerUp(window, { pointerId: 7 });

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  });

  it.each(["pointerCancel", "blur"] as const)(
    "persists an active slider gesture on window %s fallback",
    async (terminalEvent) => {
      const onSave = vi.fn().mockResolvedValue(undefined);
      render(
        <AppearanceSheet
          preferences={preferences}
          onPreview={vi.fn()}
          onSave={onSave}
          onClose={vi.fn()}
        />,
      );
      const slider = screen.getByRole("slider", { name: "玻璃透明度" });

      fireEvent.pointerDown(slider, { pointerId: 8 });
      fireEvent.change(slider, { target: { value: "55" } });
      if (terminalEvent === "pointerCancel") {
        fireEvent.pointerCancel(window, { pointerId: 8 });
      } else {
        fireEvent.blur(window);
      }

      await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    },
  );

  it("deduplicates element and global pointer release for one gesture", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <AppearanceSheet
        preferences={preferences}
        onPreview={vi.fn()}
        onSave={onSave}
        onClose={vi.fn()}
      />,
    );
    const slider = screen.getByRole("slider", { name: "玻璃透明度" });

    fireEvent.pointerDown(slider, { pointerId: 9 });
    fireEvent.change(slider, { target: { value: "55" } });
    fireEvent.pointerUp(slider, { pointerId: 9 });
    fireEvent.pointerUp(window, { pointerId: 9 });

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  });

  it("defers a terminal gesture while disabled and persists it exactly once when re-enabled", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const sharedProps = {
      preferences,
      onPreview: vi.fn(),
      onSave,
      onClose: vi.fn(),
    };
    const { rerender } = render(
      <AppearanceSheet {...sharedProps} disabled={false} />,
    );
    const slider = screen.getByRole("slider", { name: "玻璃透明度" });

    fireEvent.pointerDown(slider, { pointerId: 10 });
    fireEvent.change(slider, { target: { value: "55" } });
    rerender(<AppearanceSheet {...sharedProps} disabled />);
    fireEvent.pointerUp(window, { pointerId: 10 });
    expect(onSave).not.toHaveBeenCalled();

    rerender(<AppearanceSheet {...sharedProps} disabled={false} />);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    fireEvent.pointerUp(window, { pointerId: 10 });
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("drops a deferred terminal save when the authoritative baseline catches up", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const sharedProps = {
      onPreview: vi.fn(),
      onSave,
      onClose: vi.fn(),
    };
    const { rerender } = render(
      <AppearanceSheet
        {...sharedProps}
        preferences={preferences}
        disabled={false}
      />,
    );
    const slider = screen.getByRole("slider", { name: "玻璃透明度" });

    fireEvent.pointerDown(slider, { pointerId: 11 });
    fireEvent.change(slider, { target: { value: "55" } });
    rerender(
      <AppearanceSheet {...sharedProps} preferences={preferences} disabled />,
    );
    fireEvent.pointerUp(window, { pointerId: 11 });
    rerender(
      <AppearanceSheet
        {...sharedProps}
        preferences={{ ...preferences, glassTransparency: 55 }}
        disabled
      />,
    );
    rerender(
      <AppearanceSheet
        {...sharedProps}
        preferences={{ ...preferences, glassTransparency: 55 }}
        disabled={false}
      />,
    );

    await Promise.resolve();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("removes active gesture terminal listeners on unmount", () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const props = {
      preferences,
      onPreview: vi.fn(),
      onSave,
      onClose: vi.fn(),
    };
    const { rerender, unmount } = render(
      <AppearanceSheet
        {...props}
        disabled={false}
      />,
    );
    const slider = screen.getByRole("slider", { name: "玻璃透明度" });

    fireEvent.pointerDown(slider, { pointerId: 12 });
    fireEvent.change(slider, { target: { value: "55" } });
    rerender(<AppearanceSheet {...props} disabled />);
    fireEvent.pointerUp(window, { pointerId: 12 });
    unmount();
    fireEvent.pointerUp(window, { pointerId: 12 });
    fireEvent.blur(window);

    expect(onSave).not.toHaveBeenCalled();
  });

  it("keeps focus and keyboard containment on the busy dialog until save completes", async () => {
    let resolveSave!: () => void;
    const save = new Promise<void>((resolve) => {
      resolveSave = resolve;
    });
    const onClose = vi.fn();
    const parentKeyDown = vi.fn();
    render(
      <div onKeyDown={parentKeyDown}>
        <AppearanceSheet
          preferences={preferences}
          onPreview={vi.fn()}
          onSave={() => save}
          onClose={onClose}
        />
      </div>,
    );
    const dialog = screen.getByRole("dialog");
    const slider = screen.getByRole("slider", { name: "玻璃透明度" });

    slider.focus();
    fireEvent.change(slider, { target: { value: "55" } });
    fireEvent.pointerUp(slider);

    await waitFor(() => {
      expect(dialog).toHaveAttribute("aria-busy", "true");
      expect(dialog).toHaveAttribute("tabindex", "-1");
      expect(dialog).toHaveFocus();
    });
    expect(fireEvent.keyDown(dialog, { key: "Tab" })).toBe(false);
    expect(dialog).toHaveFocus();
    expect(fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true })).toBe(false);
    expect(dialog).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(parentKeyDown).not.toHaveBeenCalled();

    resolveSave();
    await waitFor(() => {
      expect(dialog).toHaveAttribute("aria-busy", "false");
      expect(screen.getByRole("button", { name: "关闭设置与说明" }))
        .not.toBeDisabled();
    });
    const close = screen.getByRole("button", { name: "关闭设置与说明" });
    const reset = screen.getByRole("button", { name: "恢复默认外观" });
    expect(dialog).toHaveFocus();
    expect(fireEvent.keyDown(dialog, { key: "Tab" })).toBe(false);
    expect(close).toHaveFocus();

    dialog.focus();
    expect(fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true }))
      .toBe(false);
    expect(reset).toHaveFocus();
  });
});
