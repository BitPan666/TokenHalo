// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
// @ts-expect-error Vitest executes this test in Node; the app does not ship Node types.
import { readFileSync } from "node:fs";
// @ts-expect-error Vitest executes this test in Node; the app does not ship Node types.
import { resolve } from "node:path";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  StatsGranularity,
  TokenStatsBucket,
  TokenStatsSnapshot,
  WidgetPreferences,
} from "../types";
import { DesignPlayground } from "./DesignPlayground";
import { TokenStatsCard } from "./TokenStatsCard";

declare const process: { cwd: () => string };

const preferences: WidgetPreferences = {
  locked: false,
  alwaysOnTop: true,
  pinnedProvider: "codex",
  autoRotateSeconds: 12,
  language: "zh-CN",
  expandedView: "tokenStats",
  glassTransparency: 40,
  glassBlurStrength: 40,
  glassStyle: "regular",
};

function bucket(index: number): TokenStatsBucket {
  const day = String(index + 1).padStart(2, "0");
  const totalTokens = index === 6 ? 5_250_000 : (index + 1) * 10_000;
  return {
    key: `2026-07-${day}`,
    label: `7/${index + 1}`,
    rangeStart: `2026-07-${day}T00:00:00+08:00`,
    rangeEnd: `2026-07-${day}T23:59:59+08:00`,
    totals: {
      totalTokens,
      inputTokens: totalTokens - 4_000,
      cachedInputTokens: index * 1_000,
      outputTokens: 3_000 + index,
      reasoningTokens: 1_000,
    },
    taskCount: index + 1,
    peakTaskTokens: totalTokens - 5_000,
    isFuture: false,
  };
}

function snapshot(
  status: TokenStatsSnapshot["status"] = "ok",
  buckets = Array.from({ length: 7 }, (_, index) => bucket(index)),
): TokenStatsSnapshot {
  return {
    status,
    granularity: "day",
    buckets,
    updatedAt: "2026-07-30T06:26:00Z",
    message: status === "unavailable" ? "索引目录不可读" : null,
    partial: false,
  };
}

const noop = () => {};
const chromeProps = {
  plan: null,
  onLanguage: noop,
  onAlwaysOnTop: noop,
};

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

function ControlledCard({
  value = snapshot(),
  initialKey = null,
  onSelectedBucketChange,
  language = preferences.language,
}: {
  value?: TokenStatsSnapshot;
  initialKey?: string | null;
  onSelectedBucketChange?: (key: string) => void;
  language?: WidgetPreferences["language"];
}) {
  const [granularity, setGranularity] = useState<StatsGranularity>("day");
  const [selectedBucketKey, setSelectedBucketKey] = useState<string | null>(initialKey);
  return (
    <TokenStatsCard
      {...chromeProps}
      snapshot={{ ...value, granularity }}
      granularity={granularity}
      selectedBucketKey={selectedBucketKey}
      preferences={{ ...preferences, language }}
      onGranularityChange={setGranularity}
      onSelectedBucketChange={(key) => {
        setSelectedBucketKey(key);
        onSelectedBucketChange?.(key);
      }}
      onSwitchToQuota={noop}
      onRefresh={noop}
      onOpenSettings={noop}
    />
  );
}

describe("TokenStatsCard", () => {
  it("renders the shared statistics chrome and routes every action in order", () => {
    const callbacks = {
      onRefresh: vi.fn(),
      onSwitchToQuota: vi.fn(),
      onLanguage: vi.fn(),
      onAlwaysOnTop: vi.fn(),
      onOpenSettings: vi.fn(),
    };
    const { container } = render(
      <TokenStatsCard
      {...chromeProps}
        snapshot={snapshot()}
        granularity="day"
        selectedBucketKey={null}
        plan="PROLITE"
        preferences={preferences}
        onGranularityChange={noop}
        onSelectedBucketChange={noop}
        {...callbacks}
      />,
    );

    expect(screen.getByRole("main")).toHaveClass(
      "expanded-card-surface",
      "token-stats-card",
    );
    expect(screen.getByText("CODEX · 本机统计")).toBeInTheDocument();
    expect(screen.getByText(/^PROLITE · 更新于 /)).toBeInTheDocument();

    const nav = screen.getByRole("navigation", { name: "悬浮窗控制" });
    expect(nav.firstElementChild).toHaveClass(
      "usage-indicator",
      "usage-indicator--ok",
    );
    const buttons = within(nav).getAllByRole("button");
    const labels = [
      "刷新本机统计",
      "切换到剩余额度",
      "Switch to English",
      "取消置顶",
      "设置与说明",
    ];
    expect(buttons.map((button) => button.getAttribute("aria-label")))
      .toEqual(labels);

    labels.forEach((label) => {
      fireEvent.click(screen.getByRole("button", { name: label }));
    });
    expect(callbacks.onRefresh).toHaveBeenCalledOnce();
    expect(callbacks.onSwitchToQuota).toHaveBeenCalledOnce();
    expect(callbacks.onLanguage).toHaveBeenCalledOnce();
    expect(callbacks.onAlwaysOnTop).toHaveBeenCalledOnce();
    expect(callbacks.onOpenSettings).toHaveBeenCalledOnce();
    expect(container.querySelector(".token-stats-header")).not.toBeInTheDocument();
    expect(container.querySelector(".token-stats-actions")).not.toBeInTheDocument();
  });

  it.each([
    ["ok", false, "ok"],
    ["ok", true, "active"],
    ["stale", false, "stale"],
    ["unavailable", false, "error"],
  ] as const)(
    "maps a %s snapshot with loading=%s to the %s chrome tone",
    (status, loading, tone) => {
      const { container } = render(
        <TokenStatsCard
      {...chromeProps}
          snapshot={snapshot(
            status,
            status === "unavailable" ? [] : undefined,
          )}
          granularity="day"
          selectedBucketKey={null}
          plan={null}
          preferences={preferences}
          loading={loading}
          onGranularityChange={noop}
          onSelectedBucketChange={noop}
          onSwitchToQuota={noop}
          onRefresh={noop}
          onLanguage={noop}
          onAlwaysOnTop={noop}
          onOpenSettings={noop}
        />,
      );

      expect(container.querySelector(".usage-indicator"))
        .toHaveClass(`usage-indicator--${tone}`);
    },
  );

  it.each([
    ["zh-CN", "正在读取本机统计"],
    ["en", "Loading local statistics"],
  ] as const)(
    "renders a localized accessible loading state without a matching %s snapshot",
    (language, label) => {
      render(
        <TokenStatsCard
      {...chromeProps}
          snapshot={snapshot("empty", [])}
          granularity="week"
          selectedBucketKey={null}
          preferences={{ ...preferences, language }}
          loading
          hasMatchingSnapshot={false}
          onGranularityChange={noop}
          onSelectedBucketChange={noop}
          onSwitchToQuota={noop}
          onRefresh={noop}
          onOpenSettings={noop}
        />,
      );

      expect(screen.getByRole("main")).toHaveAttribute("aria-busy", "true");
      expect(screen.getByRole("status", { name: label })).toBeInTheDocument();
      expect(screen.queryByText(
        language === "en"
          ? "No local Token statistics yet"
          : "暂无本机 Token 统计",
      )).not.toBeInTheDocument();
      expect(screen.getByText(
        language === "en"
          ? /Local logs and statistics cache/
          : /本机日志与统计缓存/,
      )).toBeInTheDocument();
    },
  );

  it("keeps matching statistics visible during a background refresh", () => {
    render(
      <TokenStatsCard
      {...chromeProps}
        snapshot={snapshot()}
        granularity="day"
        selectedBucketKey={null}
        preferences={preferences}
        loading
        hasMatchingSnapshot
        onGranularityChange={noop}
        onSelectedBucketChange={noop}
        onSwitchToQuota={noop}
        onRefresh={noop}
        onOpenSettings={noop}
      />,
    );

    expect(screen.getByRole("main")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByTestId("stats-total")).toHaveTextContent("525万");
    expect(document.querySelector(".token-stats-status"))
      .toHaveTextContent("正在更新本机统计");
    expect(screen.queryByText("暂无本机 Token 统计")).not.toBeInTheDocument();
  });

  it("opens the accessible appearance sheet, previews the card, and restores focus on close", async () => {
    const onSavePreferences = vi.fn().mockResolvedValue(undefined);
    function SettingsCard() {
      const [open, setOpen] = useState(false);
      return (
        <TokenStatsCard
      {...chromeProps}
          snapshot={snapshot()}
          granularity="day"
          selectedBucketKey={null}
          preferences={preferences}
          onGranularityChange={noop}
          onSelectedBucketChange={noop}
          onSwitchToQuota={noop}
          onRefresh={noop}
          onOpenSettings={() => setOpen(true)}
          settingsOpen={open}
          onCloseSettings={() => setOpen(false)}
          onSavePreferences={onSavePreferences}
        />
      );
    }
    const { container } = render(<SettingsCard />);
    const openButton = screen.getByRole("button", { name: "设置与说明" });

    fireEvent.click(openButton);
    expect(screen.getByRole("dialog", { name: "设置与说明" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "关闭设置与说明" }))
      .toHaveFocus();

    fireEvent.change(screen.getByRole("slider", { name: "玻璃透明度" }), {
      target: { value: "55" },
    });
    expect(container.firstElementChild).toHaveStyle({
      "--glass-transparency": "55",
      "--glass-alpha": "0.45",
    });
    expect(onSavePreferences).not.toHaveBeenCalled();

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(openButton).toHaveFocus());
  });

  it("does not start dragging when a settings slider is used", () => {
    const onDrag = vi.fn();
    render(
      <TokenStatsCard
      {...chromeProps}
        snapshot={snapshot()}
        granularity="day"
        selectedBucketKey={null}
        preferences={preferences}
        onGranularityChange={noop}
        onSelectedBucketChange={noop}
        onSwitchToQuota={noop}
        onRefresh={noop}
        onOpenSettings={noop}
        settingsOpen
        onCloseSettings={noop}
        onSavePreferences={vi.fn().mockResolvedValue(undefined)}
        onDrag={onDrag}
      />,
    );

    const slider = screen.getByRole("slider", { name: "玻璃透明度" });
    fireEvent.pointerDown(slider);
    fireEvent.mouseDown(slider);
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(onDrag).not.toHaveBeenCalled();
  });

  it("keeps the expanded hover state while the appearance sheet is open", () => {
    const onHover = vi.fn();
    render(
      <TokenStatsCard
      {...chromeProps}
        snapshot={snapshot()}
        granularity="day"
        selectedBucketKey={null}
        plan="PROLITE"
        preferences={preferences}
        onGranularityChange={noop}
        onSelectedBucketChange={noop}
        onSwitchToQuota={noop}
        onRefresh={noop}
        onLanguage={noop}
        onAlwaysOnTop={noop}
        onOpenSettings={noop}
        settingsOpen
        onCloseSettings={noop}
        onSavePreferences={vi.fn().mockResolvedValue(undefined)}
        onHover={onHover}
      />,
    );

    fireEvent.mouseLeave(screen.getByRole("main"));

    expect(onHover).not.toHaveBeenCalled();
  });

  it("makes underlying card controls inert while the modal is open", () => {
    const { container, rerender } = render(
      <TokenStatsCard
      {...chromeProps}
        snapshot={snapshot()}
        granularity="day"
        selectedBucketKey={null}
        preferences={preferences}
        onGranularityChange={noop}
        onSelectedBucketChange={noop}
        onSwitchToQuota={noop}
        onRefresh={noop}
        onOpenSettings={noop}
        settingsOpen
        onCloseSettings={noop}
        onSavePreferences={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(container.querySelector(".token-stats-content"))
      .toHaveAttribute("inert");
    expect(container.querySelector(".token-stats-content"))
      .toHaveAttribute("aria-hidden", "true");

    rerender(
      <TokenStatsCard
      {...chromeProps}
        snapshot={snapshot()}
        granularity="day"
        selectedBucketKey={null}
        preferences={preferences}
        onGranularityChange={noop}
        onSelectedBucketChange={noop}
        onSwitchToQuota={noop}
        onRefresh={noop}
        onOpenSettings={noop}
        settingsOpen={false}
        onCloseSettings={noop}
        onSavePreferences={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    expect(container.querySelector(".token-stats-content"))
      .not.toHaveAttribute("inert");
    expect(container.querySelector(".token-stats-content"))
      .not.toHaveAttribute("aria-hidden");
  });

  it("shows only compact start, selected, and end axis labels for daily data", () => {
    render(<ControlledCard initialKey="2026-07-03" />);
    const chart = screen.getByRole("group", { name: "近 7 日 Token 图表" });
    const axis = within(chart).getByTestId("stats-axis");

    expect(within(axis).getAllByText(/./)).toHaveLength(3);
    expect(within(axis).getByText("7/1")).toBeVisible();
    expect(within(axis).getByText("7/3")).toBeVisible();
    expect(within(axis).getByText("7/7")).toBeVisible();
    expect(within(axis).queryByText("7/2")).not.toBeInTheDocument();
    expect(within(chart).getByRole("button", { name: /7\/2 · 2 万 Token/ }))
      .toHaveAttribute("title", "7/2 · 2 万 Token");
  });

  it.each([
    ["week", ["W1", "W7", "W12"]],
    ["month", ["1月", "7月", "12月"]],
  ] as const)("shows safe key labels for %s buckets", (granularity, labels) => {
    const buckets = Array.from({ length: 12 }, (_, index) => ({
      ...bucket(index),
      key: `${granularity}-${index + 1}`,
      label: granularity === "week" ? `W${index + 1}` : `${index + 1}月`,
      isFuture: granularity === "month" && index > 6,
    }));
    const value = { ...snapshot("ok", buckets), granularity };
    render(
      <TokenStatsCard
      {...chromeProps}
        snapshot={value}
        granularity={granularity}
        selectedBucketKey={granularity === "month" ? "month-7" : null}
        preferences={preferences}
        onGranularityChange={noop}
        onSelectedBucketChange={noop}
        onSwitchToQuota={noop}
        onRefresh={noop}
        onOpenSettings={noop}
      />,
    );
    const axis = within(screen.getByRole("group", {
      name: `${granularity === "week" ? "近 12 周" : "今年"} Token 图表`,
    })).getByTestId("stats-axis");

    expect(within(axis).getAllByText(/./)).toHaveLength(3);
    labels.forEach((label) => expect(within(axis).getByText(label)).toBeVisible());
  });

  it("omits the axis safely for empty and granularity-mismatched snapshots", () => {
    const props = {
      selectedBucketKey: null,
      preferences,
      onGranularityChange: noop,
      onSelectedBucketChange: noop,
      onSwitchToQuota: noop,
      onRefresh: noop,
      onOpenSettings: noop,
    };
    const { rerender } = render(
      <TokenStatsCard
      {...chromeProps}
        {...props}
        snapshot={snapshot("empty", [])}
        granularity="day"
      />,
    );
    expect(screen.queryByTestId("stats-axis")).not.toBeInTheDocument();

    rerender(
      <TokenStatsCard
      {...chromeProps}
        {...props}
        snapshot={snapshot("ok")}
        granularity="week"
      />,
    );
    expect(screen.queryByTestId("stats-axis")).not.toBeInTheDocument();
  });

  it("combines stale and partial notices into one readable status region", () => {
    render(
      <ControlledCard value={{ ...snapshot("stale"), partial: true }} />,
    );

    const status = document.querySelector(".token-stats-status") as HTMLElement;
    expect(status).toHaveAttribute("role", "status");
    expect(within(status).getByText("数据可能已过期")).toBeVisible();
    expect(within(status).getByText("部分日志无法读取，统计可能不完整"))
      .toBeVisible();
  });

  it("keeps AA tab colors and explicit keyboard focus rings in the stylesheet", () => {
    const stylesText = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

    expect(stylesText).toMatch(
      /\.token-stats-tab\s*\{[^}]*color:\s*#33465c/s,
    );
    expect(stylesText).toMatch(
      /\.token-stats-tab--active\s*\{[^}]*color:\s*#03101b/s,
    );
    expect(stylesText).toMatch(/\.token-stats-tab:focus-visible/);
    expect(stylesText).toMatch(/\.card-chrome-actions button:focus-visible/);
    expect(stylesText).toMatch(/\.token-stats-bar:focus-visible/);
    expect(stylesText).toMatch(
      /\.token-stats-disclaimer\s*\{[^}]*max-width:\s*352px/s,
    );
    expect(stylesText).toMatch(
      /\.token-stats-chart\s*\{[^}]*height:\s*82px;[^}]*margin-top:\s*10px;/s,
    );
    expect(stylesText).toMatch(
      /\.token-stats-disclaimer\s*\{[^}]*border-top:\s*0;/s,
    );
    expect(stylesText).not.toMatch(
      /\.(?:token-stats-header|token-stats-actions|card-header|card-actions)\b/,
    );
    expect(stylesText).not.toMatch(
      /\.expanded-card-surface,\s*\.token-stats-card/,
    );
    expect(stylesText).not.toMatch(
      /\.token-stats-card \.card-chrome-(?:title|subtitle|actions)/,
    );
  });

  it("marks screenshot previews as synthetic without overlaying the 400px card", () => {
    window.history.replaceState(null, "", "/?designer&shot=1&mode=daily");
    const { container } = render(<DesignPlayground />);

    expect(container.querySelector(".screenshot-stage"))
      .toHaveAttribute("data-preview-kind", "synthetic");
    expect(screen.queryByText("模拟数据 · SAMPLE DATA")).not.toBeInTheDocument();
  });

  it("exposes the unavailable statistics state in the screenshot playground", () => {
    window.history.replaceState(
      null,
      "",
      "/?designer&shot=1&mode=stats-unavailable",
    );
    render(<DesignPlayground />);

    expect(screen.getByText("暂时无法读取本机 Token 统计"))
      .toBeInTheDocument();
    expect(screen.getByRole("button", { name: "刷新本机统计" }))
      .toBeEnabled();
  });

  it("exposes stable glass styling hooks and the selected density contract", () => {
    const { container } = render(<ControlledCard />);
    const card = container.firstElementChild as HTMLElement;
    const chart = screen.getByRole("group", { name: "近 7 日 Token 图表" });
    const activeTab = screen.getByRole("button", { name: "近 7 日" });
    const selectedBar = within(chart).getByRole("button", {
      name: /7\/7 · 525 万 Token/,
    });

    expect(card).toHaveClass("token-stats-card", "token-stats-card--day");
    expect(card).toHaveStyle({
      "--glass-transparency": "40",
      "--glass-blur-strength": "40",
      "--bucket-count": "7",
    });
    expect(container.querySelector(".token-stats-tabs")).toBeInTheDocument();
    expect(activeTab).toHaveClass("token-stats-tab--active");
    expect(chart).toHaveClass("token-stats-chart");
    expect(selectedBar).toHaveClass("token-stats-bar--selected");
    expect(screen.getByText("万")).toHaveClass("token-stats-suffix");
    expect(screen.getByText(/本机日志与统计缓存/))
      .toHaveClass("token-stats-disclaimer");
  });

  it.each([
    ["week", "近 12 周", 12],
    ["month", "今年", 12],
  ] as const)("exposes the %s density class and bucket count", (granularity, label, count) => {
    const value = {
      ...snapshot("ok", Array.from({ length: count }, (_, index) => bucket(index))),
      granularity,
    };
    const { container } = render(
      <TokenStatsCard
      {...chromeProps}
        snapshot={value}
        granularity={granularity}
        selectedBucketKey={null}
        preferences={preferences}
        onGranularityChange={noop}
        onSelectedBucketChange={noop}
        onSwitchToQuota={noop}
        onRefresh={noop}
        onOpenSettings={noop}
      />,
    );

    expect(container.firstElementChild).toHaveClass(`token-stats-card--${granularity}`);
    expect(container.firstElementChild).toHaveStyle({ "--bucket-count": String(count) });
    expect(within(screen.getByRole("group", { name: `${label} Token 图表` }))
      .getAllByRole("button")).toHaveLength(count);
  });

  it("renders seven semantic daily bars and selects the latest valid bucket", () => {
    render(<ControlledCard />);

    expect(screen.getByRole("button", { name: "近 7 日" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "近 12 周" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "今年" })).toBeInTheDocument();

    const chart = screen.getByRole("group", { name: "近 7 日 Token 图表" });
    const bars = within(chart).getAllByRole("button");
    expect(bars).toHaveLength(7);
    expect(bars[6]).toHaveAccessibleName(/7\/7 · 525 万 Token/);
    expect(bars[6]).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("stats-total")).toHaveTextContent("525万");
  });

  it.each([
    ["zh-CN", "525万", "万", /7\/7 · 525 万 Token/],
    ["en", "5.25M", "M", /7\/7 · 5\.25M Token/],
  ] as const)("formats the selected Token total for %s", (language, total, unit, barLabel) => {
    render(<ControlledCard language={language} />);

    expect(screen.getByTestId("stats-total")).toHaveTextContent(total);
    expect(screen.getByText(unit)).toHaveClass("token-stats-suffix");
    expect(screen.getByRole("button", { name: barLabel })).toBeInTheDocument();
  });

  it("uses 亿 for a Chinese total at one hundred million Tokens", () => {
    const hundredMillion = bucket(0);
    hundredMillion.totals = { ...hundredMillion.totals, totalTokens: 100_000_000 };
    render(<ControlledCard value={snapshot("ok", [hundredMillion])} />);

    expect(screen.getByTestId("stats-total")).toHaveTextContent("1亿");
    expect(screen.getByText("亿")).toHaveClass("token-stats-suffix");
  });

  it.each([
    ["zh-CN", ["近 7 日", "近 12 周", "今年"], "近 7 日 Token 图表"],
    ["en", ["Last 7 days", "Last 12 weeks", "This year"], "Last 7 days Token chart"],
  ] as const)("renders localized range tabs for %s", (language, labels, chartLabel) => {
    render(<ControlledCard language={language} />);

    labels.forEach((label) => {
      expect(screen.getByRole("button", { name: label })).toBeVisible();
    });
    expect(screen.getByRole("group", { name: chartLabel })).toBeVisible();
  });

  it("ignores trailing future buckets when choosing the latest valid bucket", () => {
    const buckets = Array.from({ length: 7 }, (_, index) => bucket(index));
    buckets[6] = { ...buckets[6], isFuture: true };
    render(<ControlledCard value={snapshot("ok", buckets)} />);

    expect(screen.getByRole("button", { name: /7\/6 · 6 万 Token/ }))
      .toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /7\/7 · 525 万 Token/ }))
      .toBeDisabled();
  });

  it("updates every summary value when another bucket is selected", () => {
    render(<ControlledCard />);

    fireEvent.click(screen.getByRole("button", { name: /7\/2 · 2 万 Token/ }));

    expect(screen.getByTestId("stats-total")).toHaveTextContent("2万");
    expect(screen.getByTestId("stats-input")).toHaveTextContent("1.6 万");
    expect(screen.getByTestId("stats-output")).toHaveTextContent("3,001");
    expect(screen.getByTestId("stats-cache")).toHaveTextContent("1,000");
    expect(screen.getByTestId("stats-tasks")).toHaveTextContent("2");
    expect(screen.getByTestId("stats-peak")).toHaveTextContent("1.5 万");
  });

  it.each(["Enter", " "])("selects a focused bar with the %s key", (key) => {
    render(<ControlledCard />);
    const target = screen.getByRole("button", { name: /7\/3 · 3 万 Token/ });

    target.focus();
    fireEvent.keyDown(target, { key });

    expect(target).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("stats-total")).toHaveTextContent("3万");
  });

  it("uses the specified two-percent, eight-percent, and scaled bar heights", () => {
    const zero = { ...bucket(0), totals: { ...bucket(0).totals, totalTokens: 0 } };
    const small = { ...bucket(1), totals: { ...bucket(1).totals, totalTokens: 1 } };
    const max = { ...bucket(2), totals: { ...bucket(2).totals, totalTokens: 100 } };
    render(<ControlledCard value={snapshot("ok", [zero, small, max])} />);
    const bars = within(screen.getByRole("group", { name: "近 7 日 Token 图表" }))
      .getAllByRole("button");

    expect(bars[0]).toHaveStyle({ height: "2%" });
    expect(bars[1]).toHaveStyle({ height: "8%" });
    expect(bars[2]).toHaveStyle({ height: "100%" });
  });

  it("falls back from an invalid controlled key and synchronizes the effective key", () => {
    const onSelectedBucketChange = vi.fn();
    render(
      <ControlledCard
        initialKey="missing"
        onSelectedBucketChange={onSelectedBucketChange}
      />,
    );

    expect(screen.getByRole("button", { name: /7\/7 · 525 万 Token/ }))
      .toHaveAttribute("aria-pressed", "true");
    expect(onSelectedBucketChange).toHaveBeenCalledWith("2026-07-07");
  });

  it("shows empty, stale, and unavailable states with the required disclaimer", () => {
    const { rerender } = render(<ControlledCard value={snapshot("empty", [])} />);
    expect(screen.getByText("暂无本机 Token 统计")).toBeInTheDocument();

    rerender(<ControlledCard value={snapshot("stale")} />);
    expect(screen.getByText("数据可能已过期")).toBeInTheDocument();
    expect(screen.getByText(/本机日志与统计缓存/)).toBeInTheDocument();

    rerender(<ControlledCard value={snapshot("unavailable", [])} />);
    expect(screen.getByText("暂时无法读取本机 Token 统计")).toBeInTheDocument();
    expect(screen.getByText("请稍后重试。")).toBeInTheDocument();
    expect(screen.queryByText("索引目录不可读")).not.toBeInTheDocument();
    expect(screen.getByText(/本机日志与统计缓存/))
      .toBeInTheDocument();
  });

  it.each([
    ["zh-CN", "ok"],
    ["zh-CN", "empty"],
    ["zh-CN", "stale"],
    ["zh-CN", "unavailable"],
    ["en", "ok"],
    ["en", "empty"],
    ["en", "stale"],
    ["en", "unavailable"],
  ] as const)(
    "shows the complete %s data boundary for the %s status",
    (language, status) => {
      const value = snapshot(
        status,
        status === "empty" || status === "unavailable" ? [] : undefined,
      );
      render(
        <TokenStatsCard
      {...chromeProps}
          snapshot={value}
          granularity="day"
          selectedBucketKey={null}
          preferences={{ ...preferences, language }}
          onGranularityChange={noop}
          onSelectedBucketChange={noop}
          onSwitchToQuota={noop}
          onRefresh={noop}
          onOpenSettings={noop}
        />,
      );

      expect(screen.getByText(
        language === "en"
          ? "Local logs and statistics cache stay on this Mac and are not uploaded; data may be incomplete and is not official billing, account-level usage, or remaining quota."
          : "本机日志与统计缓存仅留在本机、不上传；数据可能不完整，不代表官方账单、账户级用量或剩余额度。",
      )).toHaveClass("token-stats-disclaimer");
    },
  );

  it("warns when an empty snapshot is partial without changing unavailable semantics", () => {
    const emptyPartial = { ...snapshot("empty", []), partial: true };
    const { rerender } = render(<ControlledCard value={emptyPartial} />);

    expect(screen.getByText("暂无本机 Token 统计")).toBeInTheDocument();
    expect(screen.getByText("部分日志无法读取，统计可能不完整")).toBeInTheDocument();

    const unavailablePartial = { ...snapshot("unavailable", []), partial: true };
    rerender(<ControlledCard value={unavailablePartial} />);
    expect(screen.getByText("暂时无法读取本机 Token 统计")).toBeInTheDocument();
    expect(screen.queryByText("部分日志无法读取，统计可能不完整"))
      .not.toBeInTheDocument();
  });

  it("keeps the disclaimer in successful states", () => {
    render(<ControlledCard />);
    expect(screen.getByText(
      "本机日志与统计缓存仅留在本机、不上传；数据可能不完整，不代表官方账单、账户级用量或剩余额度。",
    )).toBeInTheDocument();
  });

  it("exposes semantic tab and card action callbacks", () => {
    const onGranularityChange = vi.fn();
    const onSwitchToQuota = vi.fn();
    const onRefresh = vi.fn();
    const onOpenSettings = vi.fn();
    render(
      <TokenStatsCard
      {...chromeProps}
        snapshot={snapshot()}
        granularity="day"
        selectedBucketKey={null}
        preferences={preferences}
        onGranularityChange={onGranularityChange}
        onSelectedBucketChange={noop}
        onSwitchToQuota={onSwitchToQuota}
        onRefresh={onRefresh}
        onOpenSettings={onOpenSettings}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "近 12 周" }));
    fireEvent.click(screen.getByRole("button", { name: "切换到剩余额度" }));
    fireEvent.click(screen.getByRole("button", { name: "刷新本机统计" }));
    fireEvent.click(screen.getByRole("button", { name: "设置与说明" }));

    expect(onGranularityChange).toHaveBeenCalledWith("week");
    expect(onSwitchToQuota).toHaveBeenCalledOnce();
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });
});
