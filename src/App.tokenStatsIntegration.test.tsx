// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { Profiler } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  StatsGranularity,
  TokenStatsSnapshot,
  WidgetPreferences,
} from "./types";

const mocks = vi.hoisted(() => ({
  fetchSnapshots: vi.fn(),
  getPreferences: vi.fn(),
  listenDesktopEvents: vi.fn(),
  setAlwaysOnTop: vi.fn(),
  setWidgetMode: vi.fn(),
  startDragging: vi.fn(),
  updatePreferences: vi.fn(),
  fetchTokenStats: vi.fn(),
}));

vi.mock("./lib/bridge", () => ({
  fetchSnapshots: mocks.fetchSnapshots,
  getPreferences: mocks.getPreferences,
  listenDesktopEvents: mocks.listenDesktopEvents,
  setAlwaysOnTop: mocks.setAlwaysOnTop,
  setWidgetMode: mocks.setWidgetMode,
  startDragging: mocks.startDragging,
  updatePreferences: mocks.updatePreferences,
}));

vi.mock("./lib/tokenStats", () => ({
  fetchTokenStats: mocks.fetchTokenStats,
}));

import App from "./App";

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

const quotaSnapshot = {
  provider: "codex" as const,
  displayName: "CODEX",
  plan: "PRO",
  shortWindow: {
    remainingPercent: 74,
    resetsAt: "2026-07-24T10:00:00Z",
    windowSeconds: 18_000,
  },
  weeklyWindow: null,
  resetCredits: 0,
  resetCreditExpiresAt: [],
  updatedAt: "2026-07-24T06:00:00Z",
  status: "ok" as const,
  message: null,
};

function statsSnapshot(granularity: StatsGranularity): TokenStatsSnapshot {
  return {
    status: "ok",
    granularity,
    buckets: [{
      key: `${granularity}-latest`,
      label: `${granularity} latest`,
      rangeStart: "2026-07-23T00:00:00+08:00",
      rangeEnd: "2026-07-24T00:00:00+08:00",
      totals: {
        totalTokens: 5_250_000,
        inputTokens: 4_000_000,
        cachedInputTokens: 1_000_000,
        outputTokens: 1_250_000,
        reasoningTokens: 0,
      },
      taskCount: 8,
      peakTaskTokens: 1_340_000,
      isFuture: false,
    }],
    updatedAt: "2026-07-24T06:00:00Z",
    message: null,
    partial: false,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("App statistics integration", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 400,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 400,
    });
    mocks.fetchSnapshots.mockReset().mockResolvedValue([quotaSnapshot]);
    mocks.getPreferences.mockReset().mockResolvedValue(preferences);
    mocks.listenDesktopEvents.mockReset().mockResolvedValue(() => undefined);
    mocks.setAlwaysOnTop.mockReset();
    mocks.setWidgetMode.mockReset().mockResolvedValue(undefined);
    mocks.startDragging.mockReset();
    mocks.updatePreferences.mockReset().mockResolvedValue(undefined);
    mocks.fetchTokenStats.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("commits loading, never empty, on the first real-hook statistics render", async () => {
    const request = deferred<TokenStatsSnapshot>();
    const commits: string[] = [];
    mocks.fetchTokenStats.mockReturnValue(request.promise);

    render(
      <Profiler
        id="statistics"
        onRender={() => commits.push(document.body.textContent ?? "")}
      >
        <App />
      </Profiler>,
    );

    await waitFor(() => {
      expect(commits.some((value) => value.includes("CODEX · 本机统计")))
        .toBe(true);
    });
    const firstStatisticsCommit = commits.find((value) => (
      value.includes("CODEX · 本机统计")
    ));

    expect(firstStatisticsCommit).toContain("正在读取本机统计");
    expect(firstStatisticsCommit).not.toContain("暂无本机 Token 统计");

    await act(async () => {
      request.reject(new Error("index failed"));
      await request.promise.catch(() => undefined);
    });
    expect(screen.getByText("暂时无法读取本机 Token 统计"))
      .toBeInTheDocument();
    expect(screen.queryByRole("main")).not.toHaveAttribute("aria-busy");
  });

  it("commits loading before the new-granularity effect starts", async () => {
    const weekRequest = deferred<TokenStatsSnapshot>();
    const commits: string[] = [];
    mocks.fetchTokenStats
      .mockResolvedValueOnce(statsSnapshot("day"))
      .mockReturnValueOnce(weekRequest.promise);

    render(
      <Profiler
        id="statistics"
        onRender={() => commits.push(document.body.textContent ?? "")}
      >
        <App />
      </Profiler>,
    );
    await screen.findByTestId("stats-total");
    commits.length = 0;

    fireEvent.click(screen.getByRole("button", { name: "近 12 周" }));

    expect(commits[0]).toContain("正在读取本机统计");
    expect(commits[0]).not.toContain("暂无本机 Token 统计");
    expect(commits[0]).not.toContain("5.25M");

    await act(async () => {
      weekRequest.resolve(statsSnapshot("week"));
      await weekRequest.promise;
    });
  });

  it("shows the quota plan and shared statistics action order", async () => {
    mocks.fetchTokenStats.mockResolvedValue(statsSnapshot("day"));

    render(<App />);

    expect(await screen.findByText(/^PRO · 更新于 /)).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "悬浮窗控制" });
    expect(within(nav).getAllByRole("button").map((button) => (
      button.getAttribute("aria-label")
    ))).toEqual([
      "刷新本机统计",
      "切换到剩余额度",
      "Switch to English",
      "取消置顶",
      "设置与说明",
    ]);
  });

  it("persists language from the statistics chrome", async () => {
    mocks.fetchTokenStats.mockResolvedValue(statsSnapshot("day"));
    render(<App />);

    fireEvent.click(await screen.findByRole("button", {
      name: "Switch to English",
    }));

    await waitFor(() => expect(mocks.updatePreferences).toHaveBeenCalledWith(
      expect.objectContaining({ language: "en", expandedView: "tokenStats" }),
    ));
  });

  it("toggles always-on-top from the statistics chrome", async () => {
    mocks.fetchTokenStats.mockResolvedValue(statsSnapshot("day"));
    mocks.setAlwaysOnTop.mockResolvedValue({
      ...preferences,
      alwaysOnTop: false,
    });
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "取消置顶" }));

    await waitFor(() => expect(mocks.setAlwaysOnTop).toHaveBeenCalledWith(false));
  });

  it("opens the appearance sheet from the statistics chrome", async () => {
    mocks.fetchTokenStats.mockResolvedValue(statsSnapshot("day"));
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "设置与说明" }));

    expect(screen.getByRole("dialog", { name: "设置与说明" }))
      .toBeInTheDocument();
  });

  it("refreshes only statistics from the statistics chrome", async () => {
    mocks.fetchTokenStats.mockResolvedValue(statsSnapshot("day"));
    render(<App />);
    const refresh = await screen.findByRole("button", {
      name: "刷新本机统计",
    });
    await waitFor(() => expect(mocks.fetchTokenStats).toHaveBeenCalledTimes(1));
    expect(mocks.fetchSnapshots).toHaveBeenCalledTimes(1);

    fireEvent.click(refresh);

    await waitFor(() => expect(mocks.fetchTokenStats).toHaveBeenCalledTimes(2));
    expect(mocks.fetchSnapshots).toHaveBeenCalledTimes(1);
  });

  it("persists quota before resizing when Gauge switches pages", async () => {
    const calls: string[] = [];
    mocks.fetchTokenStats.mockResolvedValue(statsSnapshot("day"));
    mocks.updatePreferences.mockImplementation(async (next) => {
      calls.push(`persist:${next.expandedView}`);
    });
    mocks.setWidgetMode.mockImplementation(async (mode) => {
      calls.push(`mode:${mode}`);
    });
    render(<App />);

    fireEvent.click(await screen.findByRole("button", {
      name: "切换到剩余额度",
    }));

    expect(await screen.findByText("5 小时额度剩余")).toBeInTheDocument();
    expect(calls).toEqual(["persist:quota", "mode:quota"]);
  });

  it("never renders a raw statistics backend failure", async () => {
    mocks.fetchTokenStats.mockRejectedValue(
      new Error("index failed at /Users/private/.codex/sessions"),
    );
    render(<App />);

    expect(await screen.findByText("暂时无法读取本机 Token 统计"))
      .toBeInTheDocument();
    expect(screen.getByText("请稍后重试。")).toBeInTheDocument();
    expect(screen.queryByText(/index failed|Users\/private/))
      .not.toBeInTheDocument();
  });
});
