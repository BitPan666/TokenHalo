// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
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
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WidgetPreferences } from "../types";
import {
  CardChrome,
  type CardChromeProps,
} from "./CardChrome";

declare const process: { cwd: () => string };

vi.mock("@phosphor-icons/react", () => ({
  ArrowClockwise: () => <svg data-icon="ArrowClockwise" />,
  ChartBar: () => <svg data-icon="ChartBar" />,
  Gauge: () => <svg data-icon="Gauge" />,
  GearSix: () => <svg data-icon="GearSix" />,
  PushPin: () => <svg data-icon="PushPin" />,
  PushPinSlash: () => <svg data-icon="PushPinSlash" />,
  Translate: () => <svg data-icon="Translate" />,
}));

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

function renderChrome(overrides: Partial<CardChromeProps> = {}) {
  return render(
    <CardChrome
      title="CODEX · 剩余额度"
      subtitle="PRO · 更新于 7/25 18:32"
      statusTone="ok"
      statusLabel="额度数据已同步"
      view="quota"
      preferences={preferences}
      onRefresh={vi.fn()}
      onSwitchView={vi.fn()}
      onLanguage={vi.fn()}
      onAlwaysOnTop={vi.fn()}
      onOpenSettings={vi.fn()}
      {...overrides}
    />,
  );
}

afterEach(() => {
  cleanup();
  document.querySelectorAll("style[data-card-chrome-test-style]")
    .forEach((style) => style.remove());
});

describe("CardChrome", () => {
  it("renders the status and five icon actions in the required order", () => {
    const { container } = renderChrome();
    const nav = screen.getByRole("navigation", { name: "悬浮窗控制" });
    const buttons = within(nav).getAllByRole("button");
    const labels = [
      "刷新额度数据",
      "切换到本机 Token 统计",
      "Switch to English",
      "取消置顶",
      "设置与说明",
    ];

    expect(buttons.map((button) => button.getAttribute("aria-label")))
      .toEqual(labels);
    expect(buttons.map((button) => button.getAttribute("title")))
      .toEqual(labels);
    expect(buttons.map((button) =>
      button.querySelector("svg")?.getAttribute("data-icon"))).toEqual([
      "ArrowClockwise",
      "ChartBar",
      "Translate",
      "PushPin",
      "GearSix",
    ]);
    expect(nav.firstElementChild).toHaveAttribute("role", "status");
    expect(screen.getByRole("status", { name: "额度数据已同步" }))
      .toHaveAttribute("title", "额度数据已同步");
    expect(buttons.every((button) => button.querySelector("svg"))).toBe(true);
    expect(buttons.every((button) => button.textContent === "")).toBe(true);
    expect(container).not.toHaveTextContent(/^(EN|中)$/);
    expect(screen.getByText("CODEX · 剩余额度")).toBeInTheDocument();
    expect(screen.getByText("PRO · 更新于 7/25 18:32")).toBeInTheDocument();
  });

  it("uses the statistics labels when switching back to remaining usage", () => {
    renderChrome({
      title: "CODEX · 本机统计",
      view: "tokenStats",
    });

    expect(screen.getByRole("button", { name: "刷新本机统计" }))
      .toHaveAttribute("title", "刷新本机统计");
    expect(screen.getByRole("button", { name: "切换到剩余额度" })
      .querySelector("svg")).toHaveAttribute("data-icon", "Gauge");
  });

  it("localizes every control name and tooltip from preferences", () => {
    renderChrome({
      preferences: {
        ...preferences,
        alwaysOnTop: false,
        language: "en",
      },
    });
    const nav = screen.getByRole("navigation", {
      name: "Floating widget controls",
    });
    const labels = [
      "Refresh quota data",
      "Switch to local Token statistics",
      "Switch to Chinese",
      "Keep always on top",
      "Settings and information",
    ];
    const buttons = within(nav).getAllByRole("button");

    expect(buttons.map((button) => button.getAttribute("aria-label")))
      .toEqual(labels);
    expect(buttons.map((button) => button.getAttribute("title")))
      .toEqual(labels);
    expect(buttons[3].querySelector("svg"))
      .toHaveAttribute("data-icon", "PushPinSlash");
  });

  it("keeps every quota action at a practical rendered size inside 320px", () => {
    const style = document.createElement("style");
    style.dataset.cardChromeTestStyle = "true";
    style.textContent = readFileSync(
      resolve(process.cwd(), "src/styles.css"),
      "utf8",
    );
    document.head.append(style);
    const { container } = render(
      <section className="quota-card" style={{ width: 320, height: 320 }}>
        <CardChrome
          title="CODEX · Remaining usage"
          subtitle="PRO · Updated 7/25, 18:32"
          statusTone="ok"
          statusLabel="Quota data synced"
          view="quota"
          preferences={{ ...preferences, language: "en" }}
          onRefresh={vi.fn()}
          onSwitchView={vi.fn()}
          onLanguage={vi.fn()}
          onAlwaysOnTop={vi.fn()}
          onOpenSettings={vi.fn()}
        />
      </section>,
    );
    const card = container.querySelector<HTMLElement>(".quota-card");
    const chrome = container.querySelector<HTMLElement>(".card-chrome");
    const title = container.querySelector<HTMLElement>(".card-chrome-title");
    const actions = container.querySelector<HTMLElement>(".card-chrome-actions");
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>(
      ".card-chrome-actions button",
    ));

    expect(card).not.toBeNull();
    expect(chrome).not.toBeNull();
    expect(title).not.toBeNull();
    expect(actions).not.toBeNull();
    expect(buttons).toHaveLength(5);
    const actionButtonRule = Array.from(style.sheet?.cssRules ?? [])
      .find((rule) =>
        rule instanceof CSSStyleRule
        && rule.selectorText === ".card-chrome-actions button"
      ) as CSSStyleRule | undefined;
    expect(actionButtonRule).toBeDefined();
    expect(parseFloat(actionButtonRule!.style.width))
      .toBeGreaterThanOrEqual(24);
    expect(parseFloat(actionButtonRule!.style.height))
      .toBeGreaterThanOrEqual(24);
    for (const button of buttons) {
      expect(parseFloat(getComputedStyle(button).width)).toBeGreaterThanOrEqual(24);
      expect(parseFloat(getComputedStyle(button).height)).toBeGreaterThanOrEqual(24);
    }
    expect(getComputedStyle(chrome!).display).toBe("flex");
    expect(getComputedStyle(actions!).flexWrap).toBe("nowrap");
    expect(getComputedStyle(title!).whiteSpace).toBe("nowrap");
    expect(getComputedStyle(card!).overflow).toBe("hidden");
  });

  it("locks identical title typography and action metrics across expanded cards", () => {
    const style = document.createElement("style");
    style.dataset.cardChromeTestStyle = "true";
    style.textContent = readFileSync(
      resolve(process.cwd(), "src/styles.css"),
      "utf8",
    );
    document.head.append(style);
    const shellSpecificChromeRules = Array.from(style.sheet?.cssRules ?? [])
      .filter((rule) => (
        rule instanceof CSSStyleRule
        && rule.selectorText.startsWith(".quota-card .card-chrome")
      ))
      .map((rule) => (rule as CSSStyleRule).selectorText);
    const sharedProps = {
      subtitle: "PRO · 更新于 7/26 09:10",
      statusTone: "ok" as const,
      statusLabel: "数据已同步",
      preferences,
      onRefresh: vi.fn(),
      onSwitchView: vi.fn(),
      onLanguage: vi.fn(),
      onAlwaysOnTop: vi.fn(),
      onOpenSettings: vi.fn(),
    };
    const { container } = render(
      <>
        <section className="quota-card">
          <CardChrome
            {...sharedProps}
            title="CODEX · 剩余额度"
            view="quota"
          />
        </section>
        <section className="token-stats-card">
          <CardChrome
            {...sharedProps}
            title="CODEX · 本机统计"
            view="tokenStats"
          />
        </section>
      </>,
    );

    const metrics = (scope: string) => {
      const surface = container.querySelector<HTMLElement>(scope)!;
      const title = container.querySelector<HTMLElement>(`${scope} .card-chrome-title`)!;
      const subtitle = container.querySelector<HTMLElement>(`${scope} .card-chrome-subtitle`)!;
      const actions = container.querySelector<HTMLElement>(`${scope} .card-chrome-actions`)!;
      const button = container.querySelector<HTMLButtonElement>(`${scope} .card-chrome-actions button`)!;
      const icon = button.querySelector<SVGElement>("svg")!;
      const indicator = container.querySelector<HTMLElement>(`${scope} .usage-indicator i`)!;
      const chrome = container.querySelector<HTMLElement>(`${scope} .card-chrome`)!;
      const titleStyle = getComputedStyle(title);
      const subtitleStyle = getComputedStyle(subtitle);
      const surfaceStyle = getComputedStyle(surface);
      return {
        surfacePaddingTop: surfaceStyle.paddingTop,
        surfacePaddingRight: surfaceStyle.paddingRight,
        surfacePaddingLeft: surfaceStyle.paddingLeft,
        titleFontSize: titleStyle.fontSize,
        titleFontWeight: titleStyle.fontWeight,
        titleLetterSpacing: titleStyle.letterSpacing,
        subtitleFontSize: subtitleStyle.fontSize,
        subtitleFontWeight: subtitleStyle.fontWeight,
        subtitleLetterSpacing: subtitleStyle.letterSpacing,
        chromeGap: getComputedStyle(chrome).gap,
        actionGap: getComputedStyle(actions).gap,
        buttonWidth: getComputedStyle(button).width,
        buttonHeight: getComputedStyle(button).height,
        iconWidth: getComputedStyle(icon).width,
        iconHeight: getComputedStyle(icon).height,
        indicatorWidth: getComputedStyle(indicator).width,
        indicatorHeight: getComputedStyle(indicator).height,
      };
    };

    const sharedMetrics = {
      surfacePaddingTop: "20px",
      surfacePaddingRight: "24px",
      surfacePaddingLeft: "24px",
      titleFontSize: "12px",
      titleFontWeight: "720",
      titleLetterSpacing: ".055em",
      subtitleFontSize: "8px",
      subtitleFontWeight: "520",
      subtitleLetterSpacing: ".025em",
      chromeGap: "8px",
      actionGap: "3px",
      buttonWidth: "24px",
      buttonHeight: "24px",
      iconWidth: "13px",
      iconHeight: "13px",
      indicatorWidth: "7px",
      indicatorHeight: "7px",
    };
    expect(shellSpecificChromeRules).toEqual([]);
    expect(metrics(".quota-card")).toEqual(sharedMetrics);
    expect(metrics(".token-stats-card")).toEqual(sharedMetrics);
  });

  it("keeps both expanded card surfaces at a shared 40px radius", () => {
    const style = document.createElement("style");
    style.dataset.cardChromeTestStyle = "true";
    style.textContent = readFileSync(
      resolve(process.cwd(), "src/styles.css"),
      "utf8",
    );
    document.head.append(style);
    const { container } = render(
      <>
        <section className="expanded-card-surface quota-card" />
        <section className="expanded-card-surface token-stats-card" />
      </>,
    );

    const sharedRadius = "var(--card-radius, 40px)";
    expect(getComputedStyle(
      container.querySelector<HTMLElement>(".quota-card")!,
    ).borderRadius).toBe(sharedRadius);
    expect(getComputedStyle(
      container.querySelector<HTMLElement>(".token-stats-card")!,
    ).borderRadius).toBe(sharedRadius);
  });

  it("routes each action click to its matching callback exactly once", () => {
    const callbacks = {
      onRefresh: vi.fn(),
      onSwitchView: vi.fn(),
      onLanguage: vi.fn(),
      onAlwaysOnTop: vi.fn(),
      onOpenSettings: vi.fn(),
    };
    renderChrome(callbacks);

    const actions = [
      ["刷新额度数据", callbacks.onRefresh],
      ["切换到本机 Token 统计", callbacks.onSwitchView],
      ["Switch to English", callbacks.onLanguage],
      ["取消置顶", callbacks.onAlwaysOnTop],
      ["设置与说明", callbacks.onOpenSettings],
    ] as const;

    actions.forEach(([label, callback], index) => {
      fireEvent.click(screen.getByRole("button", { name: label }));
      expect(callback).toHaveBeenCalledTimes(1);
      expect(Object.values(callbacks)
        .reduce((total, candidate) => total + candidate.mock.calls.length, 0))
        .toBe(index + 1);
    });
    for (const callback of Object.values(callbacks)) {
      expect(callback).toHaveBeenCalledOnce();
    }
  });

  it("keeps error-state refresh available while preference actions are disabled", () => {
    const onRefresh = vi.fn();
    const blockedCallbacks = [
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
    ];
    renderChrome({
      statusTone: "error",
      statusLabel: "额度接口暂时不可用",
      disabled: true,
      onRefresh,
      onSwitchView: blockedCallbacks[0],
      onLanguage: blockedCallbacks[1],
      onAlwaysOnTop: blockedCallbacks[2],
      onOpenSettings: blockedCallbacks[3],
    });

    const refresh = screen.getByRole("button", { name: "刷新额度数据" });
    expect(refresh).toBeEnabled();
    fireEvent.click(refresh);
    expect(onRefresh).toHaveBeenCalledTimes(1);

    const preferenceButtons = screen.getAllByRole("button").slice(1);
    expect(preferenceButtons).toHaveLength(4);
    expect(preferenceButtons.every((button) => button.hasAttribute("disabled")))
      .toBe(true);
    preferenceButtons.forEach((button) => fireEvent.click(button));
    blockedCallbacks.forEach((callback) =>
      expect(callback).not.toHaveBeenCalled());
  });

  it("disables refresh only while that page is refreshing", () => {
    renderChrome({ refreshing: true });

    expect(screen.getByRole("button", { name: "刷新额度数据" }))
      .toBeDisabled();
    expect(screen.getAllByRole("button").slice(1)
      .every((button) => !button.hasAttribute("disabled"))).toBe(true);
  });

  it("returns focus to settings after the appearance sheet closes", () => {
    const props = {
      settingsOpen: true,
      onOpenSettings: vi.fn(),
    };
    const { rerender } = renderChrome(props);
    const settings = screen.getByRole("button", { name: "设置与说明" });

    expect(settings).not.toHaveFocus();
    rerender(
      <CardChrome
        title="CODEX · 剩余额度"
        subtitle="PRO · 更新于 7/25 18:32"
        statusTone="ok"
        statusLabel="额度数据已同步"
        view="quota"
        preferences={preferences}
        onRefresh={vi.fn()}
        onSwitchView={vi.fn()}
        onLanguage={vi.fn()}
        onAlwaysOnTop={vi.fn()}
        onOpenSettings={props.onOpenSettings}
        settingsOpen={false}
      />,
    );

    expect(settings).toHaveFocus();
  });

  it("keeps action-bar mouse down from starting a card drag", () => {
    const onMouseDown = vi.fn();
    render(
      <div onMouseDown={onMouseDown}>
        <CardChrome
          title="CODEX · 剩余额度"
          subtitle="更新于 7/25 18:32"
          statusTone="ok"
          statusLabel="额度数据已同步"
          view="quota"
          preferences={preferences}
          onRefresh={vi.fn()}
          onSwitchView={vi.fn()}
          onLanguage={vi.fn()}
          onAlwaysOnTop={vi.fn()}
          onOpenSettings={vi.fn()}
        />
      </div>,
    );

    fireEvent.mouseDown(screen.getByRole("navigation", {
      name: "悬浮窗控制",
    }));

    expect(onMouseDown).not.toHaveBeenCalled();
  });
});
