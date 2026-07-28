// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
// @ts-expect-error Vitest executes this test in Node; the app does not ship Node types.
import { readFileSync } from "node:fs";
// @ts-expect-error Vitest executes this test in Node; the app does not ship Node types.
import { resolve } from "node:path";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ProviderSnapshot,
  WidgetPreferences,
} from "../types";
import { QuotaCard, QuotaOrb } from "./QuotaCard";

declare const process: { cwd: () => string };

const snapshot: ProviderSnapshot = {
  provider: "codex",
  displayName: "CODEX",
  plan: "PRO",
  shortWindow: {
    remainingPercent: 73,
    resetsAt: null,
    windowSeconds: 18_000,
  },
  weeklyWindow: {
    remainingPercent: 42,
    resetsAt: null,
    windowSeconds: 604_800,
  },
  resetCredits: 1,
  resetCreditExpiresAt: [],
  updatedAt: "2026-07-25T10:32:00Z",
  status: "ok",
  message: null,
};

const preferences: WidgetPreferences = {
  locked: false,
  alwaysOnTop: true,
  pinnedProvider: "codex",
  autoRotateSeconds: 12,
  language: "zh-CN",
  expandedView: "quota",
  glassTransparency: 40,
  glassBlurStrength: 40,
  glassStyle: "regular",
};

const callbacks = {
  onLock: vi.fn(),
  onLanguage: vi.fn(),
  onDrag: vi.fn(),
  onHover: vi.fn(),
  onSwitchToStats: vi.fn(),
  onRefresh: vi.fn(),
  onOpenSettings: vi.fn(),
  onCloseSettings: vi.fn(),
  onSavePreferences: vi.fn(async () => undefined),
};

function renderQuota(
  snapshotOverrides: Partial<ProviderSnapshot> = {},
  propOverrides: Record<string, unknown> = {},
) {
  return render(
    <QuotaCard
      snapshot={{ ...snapshot, ...snapshotOverrides }}
      preferences={preferences}
      {...callbacks}
      {...propOverrides}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.querySelectorAll("style[data-quota-card-test-style]")
    .forEach((style) => style.remove());
});

describe("QuotaCard", () => {
  it("renders the remaining-usage progress track four pixels taller", () => {
    const style = document.createElement("style");
    style.dataset.quotaCardTestStyle = "true";
    style.textContent = readFileSync(
      resolve(process.cwd(), "src/styles.css"),
      "utf8",
    );
    document.head.append(style);
    renderQuota();

    const progressRule = Array.from(style.sheet?.cssRules ?? [])
      .find((rule) => (
        rule instanceof CSSStyleRule
        && rule.selectorText === ".progress"
      )) as CSSStyleRule | undefined;

    expect(progressRule).toBeDefined();
    expect(progressRule!.style.height).toBe("var(--progress-height, 10px)");
  });

  it("masks the diagonal card texture beneath the remaining-usage progress track", () => {
    const style = document.createElement("style");
    style.dataset.quotaCardTestStyle = "true";
    style.textContent = readFileSync(
      resolve(process.cwd(), "src/styles.css"),
      "utf8",
    );
    document.head.append(style);
    renderQuota();

    expect(getComputedStyle(screen.getByRole("progressbar")).backgroundColor)
      .toBe("rgb(196, 216, 236)");
  });

  it.each([
    [73, "healthy", "#397ae0", "#91baf0"],
    [35, "caution", "#e7822f", "#ffd978"],
    [19, "critical", "#e94e54", "#ff9290"],
  ] as const)(
    "renders the %s%% quota with the %s progress gradient",
    (remainingPercent, tier, start, end) => {
      const style = document.createElement("style");
      style.dataset.quotaCardTestStyle = "true";
      style.textContent = readFileSync(
        resolve(process.cwd(), "src/styles.css"),
        "utf8",
      );
      document.head.append(style);
      const { container } = renderQuota({
        shortWindow: {
          remainingPercent,
          resetsAt: null,
          windowSeconds: 18_000,
        },
      });

      const card = container.firstElementChild as HTMLElement;
      const styles = getComputedStyle(card);
      expect(card).toHaveClass(`quota-card--${tier}`);
      expect(styles.getPropertyValue("--progress-start").trim()).toBe(start);
      expect(styles.getPropertyValue("--progress-end").trim()).toBe(end);
    },
  );

  it("uses the shared main-number weight, unit size, and one-pixel sixty-percent highlight", () => {
    const style = document.createElement("style");
    style.dataset.quotaCardTestStyle = "true";
    style.textContent = readFileSync(
      resolve(process.cwd(), "src/styles.css"),
      "utf8",
    );
    document.head.append(style);
    const { container } = renderQuota();

    const number = container.querySelector(".primary-metric span") as HTMLElement;
    const unit = container.querySelector(".primary-metric small") as HTMLElement;
    expect(getComputedStyle(number).fontWeight).toBe("650");
    expect(getComputedStyle(number).textShadow).toBe("0 1px 0 rgb(255 255 255 / .6)");
    expect(getComputedStyle(unit).fontSize).toBe("24px");
    expect(getComputedStyle(unit).textShadow).toBe("0 1px 0 rgb(255 255 255 / .6)");
  });

  it("renders a weekly-only primary without an empty secondary metric", () => {
    renderQuota({
      shortWindow: {
        remainingPercent: 64,
        resetsAt: "2026-07-31T08:31:12Z",
        windowSeconds: 604_800,
      },
      weeklyWindow: null,
    });

    expect(screen.getByText("一周额度剩余")).toBeInTheDocument();
    expect(screen.getByText("64")).toBeInTheDocument();
    expect(screen.queryByText("--")).not.toBeInTheDocument();
    expect(screen.queryByText("较长周期额度剩余")).not.toBeInTheDocument();
    expect(screen.getByText("1 次重置机会")).toBeInTheDocument();
    expect(screen.getByLabelText("Codex")).toBeInTheDocument();
  });

  it("aligns a zero-credit label with the compact provider mark at the details-label size", () => {
    const style = document.createElement("style");
    style.dataset.quotaCardTestStyle = "true";
    style.textContent = readFileSync(
      resolve(process.cwd(), "src/styles.css"),
      "utf8",
    );
    document.head.append(style);
    const { container } = renderQuota({
      shortWindow: {
        remainingPercent: 51,
        resetsAt: null,
        windowSeconds: 604_800,
      },
      weeklyWindow: null,
      resetCredits: 0,
    });

    const creditLabel = screen.getByText("0 次重置机会");
    const compactFooter = container.querySelector<HTMLElement>(
      ".card-footer--compact",
    )!;
    const creditBlock = container.querySelector<HTMLElement>(
      ".quota-credit-block",
    )!;
    const labelStyle = getComputedStyle(creditLabel);

    expect(getComputedStyle(compactFooter).alignItems).toBe("flex-start");
    expect(getComputedStyle(creditBlock).transform).toBe("translateY(4px)");
    expect(labelStyle.fontSize).toBe("10px");
    expect(labelStyle.color).toBe("rgba(17, 20, 27, 0.9)");
  });

  it("renders five-hour primary and weekly secondary when both exist", () => {
    renderQuota({
      shortWindow: {
        remainingPercent: 73,
        resetsAt: null,
        windowSeconds: 18_000,
      },
      weeklyWindow: {
        remainingPercent: 42,
        resetsAt: null,
        windowSeconds: 604_800,
      },
    });

    expect(screen.getByText("5 小时额度剩余")).toBeInTheDocument();
    expect(screen.getByText("一周额度剩余")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("uses the shared surface, title, subtitle, and approved chrome order", () => {
    const { container } = renderQuota();
    const card = container.firstElementChild;
    const nav = screen.getByRole("navigation", { name: "悬浮窗控制" });

    expect(card).toHaveClass("expanded-card-surface", "quota-card");
    expect(screen.getByText("CODEX · 剩余额度")).toBeInTheDocument();
    expect(container.querySelectorAll(".card-chrome-subtitle")).toHaveLength(1);
    expect(container.querySelector(".card-chrome-subtitle"))
      .toHaveTextContent(/^PRO · 更新于 /);
    expect(within(nav).getAllByRole("button").map((button) =>
      button.getAttribute("aria-label"))).toEqual([
      "刷新额度数据",
      "切换到本机 Token 统计",
      "Switch to English",
      "取消置顶",
      "设置与说明",
    ]);
    expect(container.querySelector(".aurora")).not.toBeInTheDocument();
  });

  it("keeps the exact English title alongside all five chrome actions", () => {
    const { container } = renderQuota({}, {
      preferences: { ...preferences, language: "en" },
    });

    expect(container.querySelector(".card-chrome-title"))
      .toHaveTextContent(/^CODEX · Remaining usage$/);
    expect(within(screen.getByRole("navigation", {
      name: "Floating widget controls",
    })).getAllByRole("button")).toHaveLength(5);
  });

  it.each(["unavailable", "signed_out"] as const)(
    "keeps header refresh available while %s",
    (status) => {
      const onRefresh = vi.fn();
      renderQuota({
        status,
        shortWindow: null,
        weeklyWindow: null,
        message: status === "signed_out"
          ? "Please sign in."
          : "Usage endpoint failed.",
      }, {
        onRefresh,
        preferenceActionsDisabled: true,
      });

      const refresh = screen.getByRole("button", { name: "刷新额度数据" });
      expect(refresh).toBeEnabled();
      fireEvent.click(refresh);
      expect(onRefresh).toHaveBeenCalledOnce();
    },
  );

  it("opens the existing appearance dialog and previews glass variables", () => {
    function ControlledQuota() {
      const [settingsOpen, setSettingsOpen] = useState(false);
      return (
        <QuotaCard
          snapshot={snapshot}
          preferences={preferences}
          {...callbacks}
          settingsOpen={settingsOpen}
          onOpenSettings={() => setSettingsOpen(true)}
          onCloseSettings={() => setSettingsOpen(false)}
        />
      );
    }

    const { container } = render(<ControlledQuota />);
    fireEvent.click(screen.getByRole("button", { name: "设置与说明" }));

    expect(screen.getByRole("dialog", { name: "设置与说明" }))
      .toBeInTheDocument();
    const card = container.querySelector<HTMLElement>(".quota-card");
    fireEvent.change(screen.getByRole("slider", { name: "玻璃透明度" }), {
      target: { value: "68" },
    });
    fireEvent.click(screen.getByRole("button", { name: "弱" }));

    expect(card?.style.getPropertyValue("--glass-transparency")).toBe("68");
    expect(card?.style.getPropertyValue("--glass-blur-strength")).toBe("20");
  });

  it("does not expose a raw English backend message in Chinese", () => {
    renderQuota({
      status: "unavailable",
      shortWindow: null,
      weeklyWindow: null,
      message: "Usage endpoint failed.",
    });

    expect(screen.queryByText("Usage endpoint failed."))
      .not.toBeInTheDocument();
    expect(screen.getAllByText("Codex 用量服务暂时不可用，将自动重试。"))
      .not.toHaveLength(0);
  });

  it("does not expose an unrecognized backend failure in English", () => {
    renderQuota({
      status: "unavailable",
      shortWindow: null,
      weeklyWindow: null,
      message: "index failed at /Users/private/.codex/sessions",
    }, {
      preferences: { ...preferences, language: "en" },
    });

    expect(screen.queryByText(/index failed|Users\/private/))
      .not.toBeInTheDocument();
    expect(screen.getAllByText(
      "Codex usage service is temporarily unavailable. It will retry automatically.",
    )).not.toHaveLength(0);
  });

  it("uses the safe localized fallback for an unrecognized Chinese backend failure", () => {
    renderQuota({
      status: "unavailable",
      shortWindow: null,
      weeklyWindow: null,
      message: "Codex usage response contains no usable windows.",
    });

    expect(screen.queryByText(
      "Codex usage response contains no usable windows.",
    )).not.toBeInTheDocument();
    expect(screen.getAllByText(
      "Codex 用量服务暂时不可用，将自动重试。",
    )).not.toHaveLength(0);
  });

  it("preserves the collapsed orb aurora and uses its adaptive period label", () => {
    const { container } = render(
      <QuotaOrb
        snapshot={{
          ...snapshot,
          shortWindow: {
            remainingPercent: 64,
            resetsAt: null,
            windowSeconds: 604_800,
          },
          weeklyWindow: null,
        }}
        language="zh-CN"
        onDrag={vi.fn()}
        onHover={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("一周额度剩余 64%")).toBeInTheDocument();
    expect(container.querySelector(".quota-orb .aurora")).toBeInTheDocument();
  });

  it("keeps the collapsed orb appearance stable while idle and hovered", () => {
    vi.useFakeTimers();
    try {
      const { container } = render(
        <QuotaOrb
          snapshot={snapshot}
          language="zh-CN"
          onDrag={vi.fn()}
          onHover={vi.fn()}
        />,
      );
      const orb = container.querySelector(".quota-orb");

      expect(orb).not.toHaveClass("quota-orb--idle");
      act(() => vi.advanceTimersByTime(2_500));
      expect(orb).not.toHaveClass("quota-orb--idle");
      fireEvent.mouseEnter(orb!);
      expect(orb).not.toHaveClass("quota-orb--idle");
    } finally {
      vi.useRealTimers();
    }
  });
});
