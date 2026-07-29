// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
// @ts-expect-error Vitest executes this test in Node; the app does not ship Node types.
import { readFileSync } from "node:fs";
// @ts-expect-error Vitest executes this test in Node; the app does not ship Node types.
import { resolve } from "node:path";
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

declare const process: { cwd: () => string };

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

afterEach(() => {
  cleanup();
  document.querySelectorAll("style[data-appearance-sheet-test-style]")
    .forEach((style) => style.remove());
});

describe("AppearanceSheet", () => {
  it("switches from appearance controls to local data and version information", () => {
    render(
      <AppearanceSheet
        preferences={preferences}
        onPreview={vi.fn()}
        onSave={vi.fn().mockResolvedValue(undefined)}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("tab", { name: "外观" }))
      .toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("slider", { name: "玻璃透明度" }))
      .toBeInTheDocument();
    expect(screen.queryByText("版本与更新")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "关于" }));

    expect(screen.getByRole("tab", { name: "关于" }))
      .toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("slider", { name: "玻璃透明度" }))
      .not.toBeInTheDocument();
    expect(screen.getByText("数据来源与准确性")).toBeInTheDocument();
    expect(screen.getByText("版本与更新")).toBeInTheDocument();
    expect(screen.getByText("当前版本 v0.1.6")).toBeInTheDocument();
    expect(screen.getByText("尚未检查更新")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "检查更新" }))
      .toBeEnabled();
  });

  it("reports that the installed version is current after a manual check", async () => {
    const onCheckForUpdates = vi.fn().mockResolvedValue({
      currentVersion: "0.1.5",
      latestVersion: "0.1.5",
      updateAvailable: false,
      releaseUrl: "https://github.com/BitPan666/TokenHalo/releases/tag/v0.1.5",
    });
    render(
      <AppearanceSheet
        preferences={preferences}
        onPreview={vi.fn()}
        onSave={vi.fn().mockResolvedValue(undefined)}
        onClose={vi.fn()}
        onCheckForUpdates={onCheckForUpdates}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "关于" }));
    fireEvent.click(screen.getByRole("button", { name: "检查更新" }));

    expect(await screen.findByText("已是最新版本")).toBeInTheDocument();
    expect(onCheckForUpdates).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "检查更新" })).toBeEnabled();
  });

  it.each([
    ["local statistics", undefined],
    ["remaining quota", "quota-card"],
  ])(
    "uses the agreed settings typography in the %s card",
    (_card, wrapperClassName) => {
      const style = document.createElement("style");
      style.dataset.appearanceSheetTestStyle = "true";
      style.textContent = readFileSync(
        resolve(process.cwd(), "src/styles.css"),
        "utf8",
      );
      document.head.append(style);
      render(
        <div className={wrapperClassName}>
          <AppearanceSheet
            preferences={preferences}
            onPreview={vi.fn()}
            onSave={vi.fn().mockResolvedValue(undefined)}
            onClose={vi.fn()}
          />
        </div>,
      );

      fireEvent.click(screen.getByRole("tab", { name: "关于" }));
      const requestedTypography = [
        ["title", screen.getByRole("heading", { name: "设置与说明" }), "16px"],
        ["subtitle", screen.getByText("外观参数、数据说明与版本信息"), "11px"],
        ["close", screen.getByRole("button", { name: "关闭设置与说明" }), "18px"],
        ["tabs", screen.getByRole("tab", { name: "关于" }), "12px"],
        ["data title", screen.getByText("数据来源与准确性"), "11px"],
        ["data copy", screen.getByText(/仅统计本机可读取的 Codex 日志/), "10px"],
        ["version title", screen.getByText("版本与更新"), "11px"],
        ["current version", screen.getByText("当前版本 v0.1.6"), "10px"],
        ["update status", screen.getByRole("status"), "10px"],
        [
          "GitHub note",
          screen.getByText("仅在点击按钮时连接 GitHub 检查正式版本。"),
          "9px",
        ],
        ["update button", screen.getByRole("button", { name: "检查更新" }), "10px"],
      ] as const;

      for (const [label, element, expectedFontSize] of requestedTypography) {
        expect(
          getComputedStyle(element).fontSize,
          `${label} should use ${expectedFontSize}`,
        ).toBe(expectedFontSize);
      }
    },
  );

  it.each([
    ["local statistics", undefined],
    ["remaining quota", "quota-card"],
  ])(
    "uses the same appearance-page vertical rhythm in the %s card",
    (_card, wrapperClassName) => {
      const style = document.createElement("style");
      style.dataset.appearanceSheetTestStyle = "true";
      style.textContent = readFileSync(
        resolve(process.cwd(), "src/styles.css"),
        "utf8",
      );
      document.head.append(style);
      render(
        <div className={wrapperClassName}>
          <AppearanceSheet
            preferences={preferences}
            onPreview={vi.fn()}
            onSave={vi.fn().mockResolvedValue(undefined)}
            onClose={vi.fn()}
          />
        </div>,
      );

      const subtitle = screen.getByText(
        "外观参数、数据说明与版本信息",
      );
      const appearancePage = screen.getByRole("tabpanel", { name: "外观" });
      const transparencyControl = screen.getByText(
        "玻璃透明度",
      ).parentElement?.parentElement as HTMLElement;

      expect(getComputedStyle(screen.getByRole("dialog")).gap).toBe("12px");
      expect(getComputedStyle(subtitle).marginTop).toBe("5px");
      expect(getComputedStyle(subtitle).lineHeight).toBe("1.4");
      expect(getComputedStyle(appearancePage).gap).toBe("12px");
      expect(getComputedStyle(transparencyControl).gap).toBe("7px");
    },
  );

  it("keeps the remaining-quota header and tabs fixed while switching sections", () => {
    const style = document.createElement("style");
    style.dataset.appearanceSheetTestStyle = "true";
    style.textContent = readFileSync(
      resolve(process.cwd(), "src/styles.css"),
      "utf8",
    );
    document.head.append(style);
    render(
      <div className="quota-card">
        <AppearanceSheet
          preferences={preferences}
          onPreview={vi.fn()}
          onSave={vi.fn().mockResolvedValue(undefined)}
          onClose={vi.fn()}
        />
      </div>,
    );

    const fixedMetrics = () => {
      const dialogStyle = getComputedStyle(screen.getByRole("dialog"));
      const headerStyle = getComputedStyle(
        screen.getByRole("heading", { name: "设置与说明" }).parentElement
          ?.parentElement as HTMLElement,
      );
      const subtitleStyle = getComputedStyle(screen.getByText(
        "外观参数、数据说明与版本信息",
      ));
      const tabsStyle = getComputedStyle(screen.getByRole("tablist"));

      return {
        dialogGap: dialogStyle.gap,
        headerFlexShrink: headerStyle.flexShrink,
        subtitleMarginTop: subtitleStyle.marginTop,
        subtitleLineHeight: subtitleStyle.lineHeight,
        tabsFlexShrink: tabsStyle.flexShrink,
        tabsHeight: tabsStyle.height,
        tabsPaddingTop: tabsStyle.paddingTop,
        tabsPaddingBottom: tabsStyle.paddingBottom,
      };
    };

    const appearanceMetrics = fixedMetrics();
    expect(appearanceMetrics.headerFlexShrink).toBe("0");
    expect(appearanceMetrics.tabsFlexShrink).toBe("0");
    fireEvent.click(screen.getByRole("tab", { name: "关于" }));

    expect(fixedMetrics()).toEqual(appearanceMetrics);
    expect(getComputedStyle(
      screen.getByRole("tabpanel", { name: "关于" }),
    ).overflowY).toBe("auto");
  });

  it.each([
    ["local statistics", undefined],
    ["remaining quota", "quota-card"],
  ])(
    "uses the same appearance-control typography in the %s card",
    (_card, wrapperClassName) => {
      const style = document.createElement("style");
      style.dataset.appearanceSheetTestStyle = "true";
      style.textContent = readFileSync(
        resolve(process.cwd(), "src/styles.css"),
        "utf8",
      );
      document.head.append(style);
      render(
        <div className={wrapperClassName}>
          <AppearanceSheet
            preferences={preferences}
            onPreview={vi.fn()}
            onSave={vi.fn().mockResolvedValue(undefined)}
            onClose={vi.fn()}
          />
        </div>,
      );

      const requestedTypography = [
        ["title", screen.getByRole("heading", { name: "设置与说明" }), "16px"],
        ["subtitle", screen.getByText("外观参数、数据说明与版本信息"), "11px"],
        ["close", screen.getByRole("button", { name: "关闭设置与说明" }), "18px"],
        ["tabs", screen.getByRole("tab", { name: "外观" }), "12px"],
        [
          "transparency label",
          screen.getByText("玻璃透明度").parentElement as HTMLElement,
          "11px",
        ],
        ["transparency value", screen.getByText("40%"), "9px"],
        ["glass style label", screen.getByText("玻璃样式"), "11px"],
        ["clear option", screen.getByRole("button", { name: "清透" }), "10px"],
        ["regular option", screen.getByRole("button", { name: "标准" }), "10px"],
        ["effect label", screen.getByText("效果强度"), "11px"],
        ["weak option", screen.getByRole("button", { name: "弱" }), "10px"],
        ["medium option", screen.getByRole("button", { name: "中" }), "10px"],
        ["strong option", screen.getByRole("button", { name: "强" }), "10px"],
        [
          "reset appearance",
          screen.getByRole("button", { name: "恢复默认外观" }),
          "10px",
        ],
      ] as const;

      for (const [label, element, expectedFontSize] of requestedTypography) {
        expect(
          getComputedStyle(element).fontSize,
          `${label} should use ${expectedFontSize}`,
        ).toBe(expectedFontSize);
      }
    },
  );

  it.each([
    ["local statistics", undefined],
    ["remaining quota", "quota-card"],
  ])(
    "uses the same relaxed explanatory line height in the %s card",
    (_card, wrapperClassName) => {
      const style = document.createElement("style");
      style.dataset.appearanceSheetTestStyle = "true";
      style.textContent = readFileSync(
        resolve(process.cwd(), "src/styles.css"),
        "utf8",
      );
      document.head.append(style);
      render(
        <div className={wrapperClassName}>
          <AppearanceSheet
            preferences={preferences}
            onPreview={vi.fn()}
            onSave={vi.fn().mockResolvedValue(undefined)}
            onClose={vi.fn()}
          />
        </div>,
      );

      fireEvent.click(screen.getByRole("tab", { name: "关于" }));

      expect(getComputedStyle(
        screen.getByText(/仅统计本机可读取的 Codex 日志/),
      ).lineHeight).toBe("1.35");
      expect(getComputedStyle(
        screen.getByText("仅在点击按钮时连接 GitHub 检查正式版本。"),
      ).lineHeight).toBe("1.35");
    },
  );

  it("shows the latest version and opens its release page when an update exists", async () => {
    const releaseUrl =
      "https://github.com/BitPan666/TokenHalo/releases/tag/v0.1.6";
    const onOpenReleasePage = vi.fn().mockResolvedValue(undefined);
    render(
      <AppearanceSheet
        preferences={preferences}
        onPreview={vi.fn()}
        onSave={vi.fn().mockResolvedValue(undefined)}
        onClose={vi.fn()}
        onCheckForUpdates={vi.fn().mockResolvedValue({
          currentVersion: "0.1.5",
          latestVersion: "0.1.6",
          updateAvailable: true,
          releaseUrl,
        })}
        onOpenReleasePage={onOpenReleasePage}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "关于" }));
    fireEvent.click(screen.getByRole("button", { name: "检查更新" }));

    expect(await screen.findByText("发现新版本 v0.1.6")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "前往下载" }));
    await waitFor(() => expect(onOpenReleasePage).toHaveBeenCalledWith(releaseUrl));
  });

  it("disables repeated checks while GitHub is still responding", () => {
    render(
      <AppearanceSheet
        preferences={preferences}
        onPreview={vi.fn()}
        onSave={vi.fn().mockResolvedValue(undefined)}
        onClose={vi.fn()}
        onCheckForUpdates={vi.fn().mockReturnValue(new Promise(() => {}))}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "关于" }));
    fireEvent.click(screen.getByRole("button", { name: "检查更新" }));

    expect(screen.getByText("正在检查 GitHub…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "正在检查" })).toBeDisabled();
  });

  it("keeps the check action available after a network failure", async () => {
    render(
      <AppearanceSheet
        preferences={preferences}
        onPreview={vi.fn()}
        onSave={vi.fn().mockResolvedValue(undefined)}
        onClose={vi.fn()}
        onCheckForUpdates={vi.fn().mockRejectedValue(new Error("offline"))}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "关于" }));
    fireEvent.click(screen.getByRole("button", { name: "检查更新" }));

    expect(await screen.findByText("检查失败，请稍后重试")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新检查" })).toBeEnabled();
  });

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

  it("keeps the settings glass fixed while previewing card transparency", () => {
    const style = document.createElement("style");
    style.dataset.appearanceSheetTestStyle = "true";
    style.textContent = readFileSync(
      resolve(process.cwd(), "src/styles.css"),
      "utf8",
    );
    document.head.append(style);
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
    const dialog = screen.getByRole("dialog");
    const initialStyle = getComputedStyle(dialog);

    expect(initialStyle.getPropertyValue("--appearance-sheet-alpha").trim())
      .toBe(".82");
    expect(initialStyle.getPropertyValue("--appearance-sheet-blur").trim())
      .toBe("32px");

    fireEvent.change(screen.getByRole("slider", { name: "玻璃透明度" }), {
      target: { value: "55" },
    });

    const previewStyle = getComputedStyle(dialog);
    expect(previewStyle.getPropertyValue("--appearance-sheet-alpha").trim())
      .toBe(".82");
    expect(previewStyle.getPropertyValue("--appearance-sheet-blur").trim())
      .toBe("32px");
    expect(dialog.style.getPropertyValue("--glass-alpha")).toBe("");
    expect(dialog.style.getPropertyValue("--glass-blur-strength")).toBe("");
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

    fireEvent.click(screen.getByRole("tab", { name: "关于" }));
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
