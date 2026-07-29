// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  StatsGranularity,
  TokenStatsSnapshot,
  WidgetPreferences,
} from "./types";

const mocks = vi.hoisted(() => ({
  checkForUpdates: vi.fn(),
  fetchSnapshots: vi.fn(),
  getPreferences: vi.fn(),
  listenDesktopEvents: vi.fn(),
  openReleasePage: vi.fn(),
  setAlwaysOnTop: vi.fn(),
  setWidgetMode: vi.fn(),
  startDragging: vi.fn(),
  updatePreferences: vi.fn(),
  useTokenStats: vi.fn(),
  statsRefresh: vi.fn(),
}));

vi.mock("./lib/bridge", () => ({
  checkForUpdates: mocks.checkForUpdates,
  fetchSnapshots: mocks.fetchSnapshots,
  getPreferences: mocks.getPreferences,
  listenDesktopEvents: mocks.listenDesktopEvents,
  openReleasePage: mocks.openReleasePage,
  setAlwaysOnTop: mocks.setAlwaysOnTop,
  setWidgetMode: mocks.setWidgetMode,
  startDragging: mocks.startDragging,
  updatePreferences: mocks.updatePreferences,
}));

vi.mock("./lib/useTokenStats", () => ({
  useTokenStats: mocks.useTokenStats,
}));

import App from "./App";

const quotaPreferences: WidgetPreferences = {
  locked: false,
  alwaysOnTop: true,
  pinnedProvider: null,
  autoRotateSeconds: 12,
  language: "zh-CN",
  expandedView: "quota",
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
  weeklyWindow: {
    remainingPercent: 42,
    resetsAt: "2026-07-27T00:00:00Z",
    windowSeconds: 604_800,
  },
  resetCredits: 1,
  resetCreditExpiresAt: [],
  updatedAt: "2026-07-24T06:00:00Z",
  status: "ok" as const,
  message: null,
};

function statsSnapshot(granularity: StatsGranularity): TokenStatsSnapshot {
  const key = granularity === "day"
    ? "2026-07-24"
    : granularity === "week"
      ? "2026-W30"
      : "2026-07";
  const label = granularity === "day"
    ? "7/24"
    : granularity === "week"
      ? "W30"
      : "7月";
  return {
    status: "ok",
    granularity,
    buckets: [{
      key,
      label,
      rangeStart: "2026-07-21T00:00:00+08:00",
      rangeEnd: "2026-07-28T00:00:00+08:00",
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

function setWindowSide(side: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: side,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: side,
  });
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

let emitPreferences: (preferences: WidgetPreferences) => void = () => undefined;

describe("App page switching", () => {
  beforeEach(() => {
    setWindowSide(320);
    mocks.fetchSnapshots.mockReset().mockResolvedValue([quotaSnapshot]);
    mocks.getPreferences.mockReset().mockResolvedValue(quotaPreferences);
    mocks.listenDesktopEvents.mockReset().mockImplementation(async ({
      onPreferences,
    }) => {
      emitPreferences = onPreferences;
      return () => undefined;
    });
    mocks.setAlwaysOnTop.mockReset();
    mocks.setWidgetMode.mockReset().mockResolvedValue(undefined);
    mocks.startDragging.mockReset();
    mocks.updatePreferences.mockReset().mockResolvedValue(undefined);
    mocks.statsRefresh.mockReset().mockResolvedValue(undefined);
    mocks.useTokenStats.mockReset().mockImplementation((
      _active: boolean,
      granularity: StatsGranularity,
    ) => ({
      snapshot: statsSnapshot(granularity),
      loading: false,
      error: null,
      refresh: mocks.statsRefresh,
    }));
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("disables quota refresh and ignores duplicate forced refreshes while one is pending", async () => {
    const manualRefresh = deferred<(typeof quotaSnapshot)[]>();
    render(<App />);

    const refresh = await screen.findByRole("button", {
      name: "刷新额度数据",
    });
    expect(mocks.fetchSnapshots).toHaveBeenCalledTimes(1);
    mocks.fetchSnapshots.mockImplementationOnce(() => manualRefresh.promise);

    fireEvent.click(refresh);

    await waitFor(() => expect(refresh).toBeDisabled());
    fireEvent.click(refresh);
    fireEvent.focus(window);
    expect(mocks.fetchSnapshots).toHaveBeenCalledTimes(2);

    manualRefresh.resolve([quotaSnapshot]);
    await waitFor(() => expect(refresh).toBeEnabled());
  });

  it("routes the duration-aware quota page through all five shared actions", async () => {
    mocks.setAlwaysOnTop.mockResolvedValue({
      ...quotaPreferences,
      alwaysOnTop: false,
      language: "en",
    });
    render(<App />);

    expect(await screen.findByText("5 小时额度剩余")).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "悬浮窗控制" });
    expect(within(nav).getAllByRole("button").map((button) => (
      button.getAttribute("aria-label")
    ))).toEqual([
      "刷新额度数据",
      "切换到本机 Token 统计",
      "Switch to English",
      "取消置顶",
      "设置与说明",
    ]);

    fireEvent.click(screen.getByRole("button", { name: "刷新额度数据" }));
    await waitFor(() => expect(mocks.fetchSnapshots).toHaveBeenCalledTimes(2));
    expect(mocks.statsRefresh).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Switch to English" }));
    await waitFor(() => expect(mocks.updatePreferences).toHaveBeenCalledWith(
      expect.objectContaining({ language: "en" }),
    ));

    fireEvent.click(screen.getByRole("button", {
      name: "Disable always on top",
    }));
    await waitFor(() => expect(mocks.setAlwaysOnTop).toHaveBeenCalledWith(false));

    fireEvent.click(screen.getByRole("button", {
      name: "Settings and information",
    }));
    expect(screen.getByRole("dialog", {
      name: "Settings and information",
    })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", {
      name: "Close settings and information",
    }));

    fireEvent.click(screen.getByRole("button", {
      name: "Switch to local Token statistics",
    }));
    await waitFor(() => expect(mocks.updatePreferences).toHaveBeenCalledWith(
      expect.objectContaining({ expandedView: "tokenStats" }),
    ));
  });

  it("persists the stats page before resizing to 400 and rendering it", async () => {
    const calls: string[] = [];
    mocks.updatePreferences.mockImplementation(async (preferences) => {
      calls.push(`persist:${preferences.expandedView}`);
    });
    mocks.setWidgetMode.mockImplementation(async (mode) => {
      calls.push(`mode:${mode}`);
    });
    render(<App />);

    fireEvent.click(await screen.findByRole("button", {
      name: "切换到本机 Token 统计",
    }));

    expect(await screen.findByText("CODEX · 本机统计")).toBeInTheDocument();
    expect(calls).toEqual(["persist:tokenStats", "mode:stats"]);
    expect(mocks.useTokenStats).toHaveBeenLastCalledWith(true, "day");
  });

  it("shows an accessible loading state on first statistics entry instead of an empty result", async () => {
    mocks.getPreferences.mockResolvedValue({
      ...quotaPreferences,
      expandedView: "tokenStats",
    });
    mocks.useTokenStats.mockReturnValue({
      snapshot: null,
      loading: true,
      error: null,
      refresh: mocks.statsRefresh,
    });

    render(<App />);

    expect(await screen.findByRole("status", {
      name: "正在读取本机统计",
    })).toBeInTheDocument();
    expect(screen.queryByText("暂无本机 Token 统计")).not.toBeInTheDocument();
    expect(screen.getByText(/本机日志与统计缓存/)).toBeInTheDocument();
  });

  it("shows loading while a new granularity has only the retained previous snapshot", async () => {
    mocks.getPreferences.mockResolvedValue({
      ...quotaPreferences,
      expandedView: "tokenStats",
    });
    mocks.useTokenStats.mockImplementation((
      _active: boolean,
      granularity: StatsGranularity,
    ) => ({
      snapshot: statsSnapshot("day"),
      loading: granularity === "week",
      error: null,
      refresh: mocks.statsRefresh,
    }));

    render(<App />);
    expect(await screen.findByTestId("stats-total")).toHaveTextContent("525万");

    fireEvent.click(screen.getByRole("button", { name: "近 12 周" }));

    expect(await screen.findByRole("status", {
      name: "正在读取本机统计",
    })).toBeInTheDocument();
    expect(screen.queryByTestId("stats-total")).not.toBeInTheDocument();
    expect(screen.queryByText("暂无本机 Token 统计")).not.toBeInTheDocument();
  });

  it("preserves a matching snapshot and announces a non-destructive background refresh", async () => {
    mocks.getPreferences.mockResolvedValue({
      ...quotaPreferences,
      expandedView: "tokenStats",
    });
    mocks.useTokenStats.mockReturnValue({
      snapshot: statsSnapshot("day"),
      loading: true,
      error: null,
      refresh: mocks.statsRefresh,
    });

    render(<App />);

    expect(await screen.findByTestId("stats-total")).toHaveTextContent("525万");
    expect(document.querySelector(".token-stats-status"))
      .toHaveTextContent("正在更新本机统计");
    expect(screen.queryByText("暂无本机 Token 统计")).not.toBeInTheDocument();
  });

  it("persists quota before resizing to 320 when switching back", async () => {
    mocks.getPreferences.mockResolvedValue({
      ...quotaPreferences,
      expandedView: "tokenStats",
    });
    const calls: string[] = [];
    mocks.updatePreferences.mockImplementation(async (preferences) => {
      calls.push(`persist:${preferences.expandedView}`);
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
    expect(mocks.useTokenStats).toHaveBeenLastCalledWith(false, "day");
  });

  it("keeps quota visible and does not resize when persistence fails", async () => {
    mocks.updatePreferences.mockRejectedValue(new Error("disk full"));
    render(<App />);

    fireEvent.click(await screen.findByRole("button", {
      name: "切换到本机 Token 统计",
    }));

    expect(await screen.findByText(
      "页面切换失败，已恢复之前的视图。",
    )).toHaveAttribute("role", "status");
    expect(screen.getByText("5 小时额度剩余")).toBeInTheDocument();
    expect(mocks.setWidgetMode).not.toHaveBeenCalled();
  });

  it("rolls back the preference and size when the page resize fails", async () => {
    const calls: string[] = [];
    mocks.updatePreferences.mockImplementation(async (preferences) => {
      calls.push(`persist:${preferences.expandedView}`);
    });
    mocks.setWidgetMode.mockImplementation(async (mode) => {
      calls.push(`mode:${mode}`);
      if (mode === "stats") throw new Error("resize failed");
    });
    render(<App />);

    fireEvent.click(await screen.findByRole("button", {
      name: "切换到本机 Token 统计",
    }));

    expect(await screen.findByText(
      "页面切换失败，已恢复之前的视图。",
    )).toHaveAttribute("role", "status");
    expect(screen.getByText("5 小时额度剩余")).toBeInTheDocument();
    expect(calls).toEqual([
      "persist:tokenStats",
      "mode:stats",
      "persist:quota",
      "mode:quota",
    ]);
  });

  it("opens the remembered stats page at 400 and collapses to 100 on hover leave", async () => {
    setWindowSide(100);
    mocks.getPreferences.mockResolvedValue({
      ...quotaPreferences,
      expandedView: "tokenStats",
    });
    render(<App />);

    const orb = await screen.findByLabelText(/5 小时额度剩余 74%/);
    await waitFor(() => {
      expect(mocks.useTokenStats).toHaveBeenLastCalledWith(false, "day");
    });
    fireEvent.mouseEnter(orb);

    const statsCard = await screen.findByText("CODEX · 本机统计");
    await waitFor(() => {
      expect(mocks.setWidgetMode).toHaveBeenCalledWith("stats");
      expect(mocks.useTokenStats).toHaveBeenLastCalledWith(true, "day");
    });

    fireEvent.mouseLeave(statsCard.closest("main") as HTMLElement);
    await waitFor(() => {
      expect(mocks.setWidgetMode).toHaveBeenLastCalledWith("compact");
      expect(screen.getByLabelText(/5 小时额度剩余 74%/)).toBeInTheDocument();
    });
  });

  it("reloads a new granularity, selects its valid bucket, and forces stats refresh", async () => {
    mocks.getPreferences.mockResolvedValue({
      ...quotaPreferences,
      expandedView: "tokenStats",
    });
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "近 12 周" }));
    await waitFor(() => {
      expect(mocks.useTokenStats).toHaveBeenLastCalledWith(true, "week");
      expect(screen.getByRole("button", {
        name: /W30 · 525 万 Token/,
      })).toHaveAttribute("aria-pressed", "true");
    });

    fireEvent.click(screen.getByRole("button", { name: "刷新本机统计" }));
    expect(mocks.statsRefresh).toHaveBeenCalledWith(true);
  });

  it("waits for remembered preferences before expanding the hovered orb", async () => {
    setWindowSide(100);
    const preferences = deferred<WidgetPreferences>();
    mocks.getPreferences.mockReturnValue(preferences.promise);
    render(<App />);

    const orb = await screen.findByLabelText(/5 小时额度剩余 74%/);
    fireEvent.mouseEnter(orb);
    expect(mocks.setWidgetMode).not.toHaveBeenCalled();

    preferences.resolve({
      ...quotaPreferences,
      expandedView: "tokenStats",
    });

    expect(await screen.findByText("CODEX · 本机统计")).toBeInTheDocument();
    expect(mocks.setWidgetMode).toHaveBeenCalledTimes(1);
    expect(mocks.setWidgetMode).toHaveBeenCalledWith("stats");
  });

  it("does not re-expand when hover leave supersedes a pending page switch", async () => {
    const persistence = deferred<void>();
    mocks.updatePreferences.mockReturnValueOnce(persistence.promise);
    render(<App />);

    const switchButton = await screen.findByRole("button", {
      name: "切换到本机 Token 统计",
    });
    const quotaCard = switchButton.closest("main") as HTMLElement;
    fireEvent.click(switchButton);
    fireEvent.mouseLeave(quotaCard);

    await waitFor(() => {
      expect(mocks.setWidgetMode).toHaveBeenCalledWith("compact");
    });
    persistence.resolve();
    await waitFor(() => {
      expect(mocks.updatePreferences).toHaveBeenCalledTimes(1);
      expect(screen.getByLabelText(/5 小时额度剩余 74%/)).toBeInTheDocument();
    });

    expect(mocks.setWidgetMode).not.toHaveBeenCalledWith("stats");
    expect(mocks.setWidgetMode).toHaveBeenLastCalledWith("compact");
  });

  it("re-enters the confirmed quota view while stats persistence is pending and restores quota after rejection", async () => {
    const persistence = deferred<void>();
    mocks.updatePreferences.mockReturnValueOnce(persistence.promise);
    render(<App />);

    const switchButton = await screen.findByRole("button", {
      name: "切换到本机 Token 统计",
    });
    const quotaCard = switchButton.closest("main") as HTMLElement;
    fireEvent.click(switchButton);
    fireEvent.mouseLeave(quotaCard);

    const orb = await screen.findByLabelText(/5 小时额度剩余 74%/);
    fireEvent.mouseEnter(orb);
    await waitFor(() => {
      expect(screen.getByText("5 小时额度剩余")).toBeInTheDocument();
    });

    persistence.reject(new Error("disk full"));
    await screen.findByText("页面切换失败，已恢复之前的视图。");

    expect(screen.getByText("5 小时额度剩余")).toBeInTheDocument();
    expect(mocks.setWidgetMode).toHaveBeenLastCalledWith("quota");
  });

  it("reconciles the physical quota view when rollback completes after leave and re-entry", async () => {
    const rollback = deferred<void>();
    mocks.updatePreferences
      .mockResolvedValueOnce(undefined)
      .mockReturnValueOnce(rollback.promise);
    mocks.setWidgetMode
      .mockRejectedValueOnce(new Error("resize failed"))
      .mockResolvedValue(undefined);
    render(<App />);

    const switchButton = await screen.findByRole("button", {
      name: "切换到本机 Token 统计",
    });
    const quotaCard = switchButton.closest("main") as HTMLElement;
    fireEvent.click(switchButton);
    await waitFor(() => {
      expect(mocks.updatePreferences).toHaveBeenCalledTimes(2);
    });

    fireEvent.mouseLeave(quotaCard);
    const orb = await screen.findByLabelText(/5 小时额度剩余 74%/);
    fireEvent.mouseEnter(orb);
    await waitFor(() => {
      expect(mocks.setWidgetMode).toHaveBeenCalledWith("stats");
    });

    rollback.resolve();
    await screen.findByText("页面切换失败，已恢复之前的视图。");

    expect(screen.getByText("5 小时额度剩余")).toBeInTheDocument();
    expect(mocks.setWidgetMode).toHaveBeenLastCalledWith("quota");
  });

  it("blocks preference controls while a page switch transaction is pending", async () => {
    const persistence = deferred<void>();
    mocks.updatePreferences.mockReturnValueOnce(persistence.promise);
    mocks.setAlwaysOnTop.mockResolvedValue(quotaPreferences);
    render(<App />);

    const switchButton = await screen.findByRole("button", {
      name: "切换到本机 Token 统计",
    });
    const languageButton = screen.getByRole("button", {
      name: "Switch to English",
    });
    const pinButton = screen.getByRole("button", {
      name: "取消置顶",
    });
    fireEvent.click(switchButton);

    await waitFor(() => {
      expect(mocks.updatePreferences).toHaveBeenCalledTimes(1);
    });
    expect(switchButton).toBeDisabled();
    expect(languageButton).toBeDisabled();
    expect(pinButton).toBeDisabled();

    fireEvent.click(languageButton);
    fireEvent.click(pinButton);
    expect(mocks.updatePreferences).toHaveBeenCalledTimes(1);
    expect(mocks.setAlwaysOnTop).not.toHaveBeenCalled();

    persistence.resolve();
    expect(await screen.findByText("CODEX · 本机统计")).toBeInTheDocument();
  });

  it("blocks a page switch when a language preference write started first", async () => {
    const languageWrite = deferred<void>();
    mocks.updatePreferences.mockReturnValueOnce(languageWrite.promise);
    render(<App />);

    const switchButton = await screen.findByRole("button", {
      name: "切换到本机 Token 统计",
    });
    fireEvent.click(screen.getByRole("button", {
      name: "Switch to English",
    }));

    expect(switchButton).toBeDisabled();
    switchButton.removeAttribute("disabled");
    fireEvent.click(switchButton);
    expect(mocks.updatePreferences).toHaveBeenCalledTimes(1);
    expect(mocks.setWidgetMode).not.toHaveBeenCalledWith("stats");

    languageWrite.resolve();
    await waitFor(() => {
      expect(switchButton).not.toBeDisabled();
    });
  });

  it("blocks a page switch when an always-on-top write started first", async () => {
    const alwaysOnTopWrite = deferred<WidgetPreferences>();
    mocks.setAlwaysOnTop.mockReturnValueOnce(alwaysOnTopWrite.promise);
    render(<App />);

    const switchButton = await screen.findByRole("button", {
      name: "切换到本机 Token 统计",
    });
    fireEvent.click(screen.getByRole("button", {
      name: "取消置顶",
    }));

    expect(switchButton).toBeDisabled();
    switchButton.removeAttribute("disabled");
    fireEvent.click(switchButton);
    expect(mocks.updatePreferences).not.toHaveBeenCalled();
    expect(mocks.setAlwaysOnTop).toHaveBeenCalledTimes(1);
    expect(mocks.setWidgetMode).not.toHaveBeenCalledWith("stats");

    alwaysOnTopWrite.resolve({
      ...quotaPreferences,
      alwaysOnTop: false,
    });
    await waitFor(() => {
      expect(switchButton).not.toBeDisabled();
    });
  });

  it("ignores a delayed old event payload and adopts the authoritative stats readback", async () => {
    const pagePersistence = deferred<void>();
    mocks.getPreferences
      .mockResolvedValueOnce(quotaPreferences)
      .mockResolvedValueOnce({
        ...quotaPreferences,
        expandedView: "tokenStats",
      });
    mocks.updatePreferences.mockReturnValueOnce(pagePersistence.promise);
    render(<App />);

    fireEvent.click(await screen.findByRole("button", {
      name: "切换到本机 Token 统计",
    }));
    emitPreferences({
      ...quotaPreferences,
      alwaysOnTop: false,
      language: "en",
    });

    pagePersistence.resolve();
    expect(await screen.findByText("CODEX · 本机统计")).toBeInTheDocument();
    await waitFor(() => expect(mocks.getPreferences).toHaveBeenCalledTimes(2));
    expect(mocks.updatePreferences).toHaveBeenCalledTimes(1);
    expect(mocks.setWidgetMode).toHaveBeenLastCalledWith("stats");
  });

  it("adopts a genuinely newer tray change from the authoritative readback", async () => {
    const pagePersistence = deferred<void>();
    mocks.getPreferences
      .mockResolvedValueOnce(quotaPreferences)
      .mockResolvedValueOnce({
        ...quotaPreferences,
        alwaysOnTop: false,
        language: "en",
      });
    mocks.updatePreferences.mockReturnValueOnce(pagePersistence.promise);
    render(<App />);

    fireEvent.click(await screen.findByRole("button", {
      name: "切换到本机 Token 统计",
    }));
    emitPreferences({
      ...quotaPreferences,
      expandedView: "tokenStats",
    });

    pagePersistence.resolve();
    expect(await screen.findByText("5-hour usage remaining")).toBeInTheDocument();
    expect(screen.getByRole("button", {
      name: "Switch to Chinese",
    })).toBeInTheDocument();
    expect(mocks.getPreferences).toHaveBeenCalledTimes(2);
    expect(mocks.setWidgetMode).toHaveBeenLastCalledWith("quota");
  });

  it("keeps the last confirmed page when authoritative external readback fails", async () => {
    const pagePersistence = deferred<void>();
    mocks.getPreferences
      .mockResolvedValueOnce(quotaPreferences)
      .mockRejectedValueOnce(new Error("readback failed"));
    mocks.updatePreferences.mockReturnValueOnce(pagePersistence.promise);
    render(<App />);

    fireEvent.click(await screen.findByRole("button", {
      name: "切换到本机 Token 统计",
    }));
    emitPreferences({
      ...quotaPreferences,
      language: "en",
    });

    pagePersistence.resolve();
    expect(await screen.findByText(
      "外部设置已更改，但无法读取最新设置。",
    )).toHaveAttribute("role", "status");
    expect(screen.getByText("CODEX · 本机统计")).toBeInTheDocument();
    expect(mocks.setWidgetMode).toHaveBeenLastCalledWith("stats");
  });

  it("collapses safely when an authoritative external view resize fails", async () => {
    const pagePersistence = deferred<void>();
    mocks.getPreferences
      .mockResolvedValueOnce(quotaPreferences)
      .mockResolvedValueOnce({
        ...quotaPreferences,
        language: "en",
      });
    mocks.updatePreferences.mockReturnValueOnce(pagePersistence.promise);
    mocks.setWidgetMode
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("quota resize failed"))
      .mockResolvedValue(undefined);
    render(<App />);

    fireEvent.click(await screen.findByRole("button", {
      name: "切换到本机 Token 统计",
    }));
    emitPreferences(quotaPreferences);
    pagePersistence.resolve();

    const orb = await screen.findByLabelText(/5-hour usage remaining 74%/);
    expect(mocks.setWidgetMode).toHaveBeenNthCalledWith(1, "stats");
    expect(mocks.setWidgetMode).toHaveBeenNthCalledWith(2, "quota");
    expect(mocks.setWidgetMode).toHaveBeenNthCalledWith(3, "compact");

    fireEvent.mouseEnter(orb);
    expect(await screen.findByText(
      "External settings were applied, but widget size recovery required compact mode.",
    )).toHaveAttribute("role", "status");
    expect(screen.getByText("5-hour usage remaining")).toBeInTheDocument();
    expect(mocks.setWidgetMode).toHaveBeenLastCalledWith("quota");
  });

  it("reconciles an authoritative external view after leave and re-entry supersede its first resize", async () => {
    const quotaResize = deferred<void>();
    const modes: string[] = [];
    mocks.getPreferences
      .mockResolvedValueOnce({
        ...quotaPreferences,
        expandedView: "tokenStats",
      })
      .mockResolvedValueOnce(quotaPreferences);
    mocks.setWidgetMode.mockImplementation((mode) => {
      modes.push(mode);
      if (mode === "quota" && modes.filter((value) => value === "quota").length === 1) {
        return quotaResize.promise;
      }
      return Promise.resolve();
    });
    render(<App />);

    const statsTitle = await screen.findByText("CODEX · 本机统计");
    emitPreferences(quotaPreferences);
    await waitFor(() => expect(modes).toContain("quota"));

    fireEvent.mouseLeave(statsTitle.closest("main") as HTMLElement);
    const orb = await screen.findByLabelText(/5 小时额度剩余 74%/);
    fireEvent.mouseEnter(orb);
    await waitFor(() => expect(modes).toContain("stats"));

    quotaResize.resolve();
    expect(await screen.findByText("5 小时额度剩余")).toBeInTheDocument();
    await waitFor(() => {
      expect(modes).toEqual(["quota", "compact", "stats", "quota"]);
    });
  });

  it("ignores failed-switch rollback after a newer compact hover intent", async () => {
    const statisticsResize = deferred<void>();
    const modes: string[] = [];
    mocks.setWidgetMode.mockImplementation((mode) => {
      modes.push(mode);
      if (mode === "stats") return statisticsResize.promise;
      return Promise.resolve();
    });
    render(<App />);

    const switchButton = await screen.findByRole("button", {
      name: "切换到本机 Token 统计",
    });
    const quotaCard = switchButton.closest("main") as HTMLElement;
    fireEvent.click(switchButton);
    await waitFor(() => expect(modes).toContain("stats"));
    fireEvent.mouseLeave(quotaCard);
    await waitFor(() => expect(modes).toContain("compact"));

    statisticsResize.reject(new Error("resize failed"));
    await waitFor(() => {
      expect(screen.getByLabelText(/5 小时额度剩余 74%/)).toBeInTheDocument();
    });

    expect(modes).toEqual(["stats", "compact"]);
    expect(mocks.updatePreferences).toHaveBeenCalledTimes(1);
  });

  it("reconciles the saved page when a newer collapse intent itself fails", async () => {
    const persistence = deferred<void>();
    mocks.updatePreferences.mockReturnValueOnce(persistence.promise);
    mocks.setWidgetMode.mockImplementation((mode) => (
      mode === "compact"
        ? Promise.reject(new Error("collapse failed"))
        : Promise.resolve()
    ));
    render(<App />);

    const switchButton = await screen.findByRole("button", {
      name: "切换到本机 Token 统计",
    });
    fireEvent.click(switchButton);
    fireEvent.mouseLeave(switchButton.closest("main") as HTMLElement);
    await screen.findByText("悬浮窗收起失败。");

    persistence.resolve();

    expect(await screen.findByText("CODEX · 本机统计")).toBeInTheDocument();
    expect(mocks.setWidgetMode).toHaveBeenLastCalledWith("stats");
  });

  it("reapplies the confirmed stats mode when a pending collapse fails after page persistence settles", async () => {
    const pagePersistence = deferred<void>();
    const collapse = deferred<void>();
    const modes: string[] = [];
    mocks.updatePreferences.mockReturnValueOnce(pagePersistence.promise);
    mocks.setWidgetMode.mockImplementation((mode) => {
      modes.push(mode);
      return mode === "compact" ? collapse.promise : Promise.resolve();
    });
    render(<App />);

    const switchButton = await screen.findByRole("button", {
      name: "切换到本机 Token 统计",
    });
    fireEvent.click(switchButton);
    fireEvent.mouseLeave(switchButton.closest("main") as HTMLElement);
    await waitFor(() => expect(modes).toEqual(["compact"]));

    pagePersistence.resolve();
    await waitFor(() => {
      expect(mocks.updatePreferences).toHaveBeenCalledTimes(1);
    });
    collapse.reject(new Error("collapse failed"));

    expect(await screen.findByText("CODEX · 本机统计")).toBeInTheDocument();
    await waitFor(() => {
      expect(modes).toEqual(["compact", "stats"]);
    });
  });

  it("reports a recoverable notice when expanded-mode reapply also fails", async () => {
    mocks.setWidgetMode
      .mockRejectedValueOnce(new Error("collapse failed"))
      .mockRejectedValueOnce(new Error("quota reapply failed"))
      .mockResolvedValue(undefined);
    render(<App />);

    const switchButton = await screen.findByRole("button", {
      name: "切换到本机 Token 统计",
    });
    fireEvent.mouseLeave(switchButton.closest("main") as HTMLElement);

    const notice = await screen.findByText(
      "悬浮窗收起恢复失败，将在下次悬停时重试展开视图。",
    );
    expect(notice).toHaveAttribute("role", "status");
    const card = screen.getByText("5 小时额度剩余").closest("main") as HTMLElement;
    fireEvent.mouseEnter(card);

    await waitFor(() => {
      expect(mocks.setWidgetMode).toHaveBeenLastCalledWith("quota");
    });
  });

  it("reports incomplete recovery and follows the confirmed saved view", async () => {
    mocks.updatePreferences
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("rollback failed"));
    mocks.setWidgetMode
      .mockRejectedValueOnce(new Error("resize failed"))
      .mockResolvedValueOnce(undefined);
    render(<App />);

    fireEvent.click(await screen.findByRole("button", {
      name: "切换到本机 Token 统计",
    }));

    expect(await screen.findByText(
      "页面切换恢复不完整，已保留保存的视图。",
    )).toHaveAttribute("role", "status");
    expect(screen.getByText("CODEX · 本机统计")).toBeInTheDocument();
    expect(mocks.updatePreferences).toHaveBeenCalledTimes(2);
    expect(mocks.setWidgetMode).toHaveBeenNthCalledWith(1, "stats");
    expect(mocks.setWidgetMode).toHaveBeenNthCalledWith(2, "stats");
  });

  it("keeps statistics expanded when the pointer moves from the card to its notice", async () => {
    mocks.getPreferences.mockResolvedValue({
      ...quotaPreferences,
      expandedView: "tokenStats",
    });
    mocks.useTokenStats.mockImplementation((
      _active: boolean,
      granularity: StatsGranularity,
    ) => ({
      snapshot: statsSnapshot(granularity),
      loading: false,
      error: "Local statistics refresh failed.",
      refresh: mocks.statsRefresh,
    }));
    render(<App />);

    const notice = await screen.findByText("请稍后重试。");
    const card = screen.getByText("CODEX · 本机统计").closest("main") as HTMLElement;
    mocks.setWidgetMode.mockClear();
    fireEvent.mouseOut(card, { relatedTarget: notice });

    expect(mocks.setWidgetMode).not.toHaveBeenCalledWith("compact");
    expect(screen.getByText("CODEX · 本机统计")).toBeInTheDocument();
  });

  it("saves appearance through the shared mutation lock and adopts authoritative readback", async () => {
    const statsPreferences = {
      ...quotaPreferences,
      expandedView: "tokenStats" as const,
    };
    const authoritative = {
      ...statsPreferences,
      glassTransparency: 54,
    };
    mocks.getPreferences
      .mockResolvedValueOnce(statsPreferences)
      .mockResolvedValueOnce(authoritative);
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "设置与说明" }));
    const transparency = screen.getByRole("slider", { name: "玻璃透明度" });
    const card = screen.getByText("CODEX · 本机统计").closest("main") as HTMLElement;
    fireEvent.change(transparency, { target: { value: "55" } });

    expect(card).toHaveStyle({
      "--glass-transparency": "55",
      "--glass-alpha": "0.45",
    });
    expect(mocks.updatePreferences).not.toHaveBeenCalled();

    fireEvent.pointerUp(transparency);
    await waitFor(() => {
      expect(mocks.updatePreferences).toHaveBeenCalledTimes(1);
      expect(mocks.getPreferences).toHaveBeenCalledTimes(2);
    });
    expect(mocks.updatePreferences).toHaveBeenCalledWith(expect.objectContaining({
      expandedView: "tokenStats",
      glassTransparency: 55,
      glassBlurStrength: 40,
    }));
    await waitFor(() => {
      expect(transparency).toHaveValue("54");
      expect(card).toHaveStyle({
        "--glass-transparency": "54",
        "--glass-alpha": "0.46",
      });
    });
    expect(screen.getByRole(
      "button",
      { name: "切换到剩余额度", hidden: true },
    ))
      .not.toBeDisabled();
  });

  it("keeps a successful appearance write when verification is unavailable, then reconciles later", async () => {
    const statsPreferences = {
      ...quotaPreferences,
      expandedView: "tokenStats" as const,
    };
    mocks.getPreferences
      .mockResolvedValueOnce(statsPreferences)
      .mockRejectedValueOnce(new Error("readback unavailable"))
      .mockResolvedValueOnce({
        ...statsPreferences,
        glassTransparency: 52,
      });
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "设置与说明" }));
    const transparency = screen.getByRole("slider", { name: "玻璃透明度" });
    const switchButton = screen.getByRole(
      "button",
      { name: "切换到剩余额度", hidden: true },
    );
    fireEvent.change(transparency, { target: { value: "55" } });
    fireEvent.pointerUp(transparency);

    expect(await screen.findByText(
      "设置已保存，但暂时无法验证；将在下次设置变更或重启时重新读取。",
    )).toHaveAttribute("role", "status");
    expect(transparency).toHaveValue("55");
    expect(screen.queryByText("设置保存失败，已恢复上一次保存的外观。"))
      .not.toBeInTheDocument();
    expect(switchButton).not.toBeDisabled();
    expect(mocks.updatePreferences).toHaveBeenCalledTimes(1);
    expect(mocks.getPreferences).toHaveBeenCalledTimes(2);

    emitPreferences(statsPreferences);
    await waitFor(() => {
      expect(mocks.getPreferences).toHaveBeenCalledTimes(3);
      expect(transparency).toHaveValue("52");
    });
    expect(screen.queryByText(
      "设置已保存，但暂时无法验证；将在下次设置变更或重启时重新读取。",
    )).not.toBeInTheDocument();
    expect(switchButton).not.toBeDisabled();
  });

  it("explains the verification boundary precisely in English", async () => {
    const statsPreferences = {
      ...quotaPreferences,
      language: "en" as const,
      expandedView: "tokenStats" as const,
    };
    mocks.getPreferences
      .mockResolvedValueOnce(statsPreferences)
      .mockRejectedValueOnce(new Error("readback unavailable"));
    render(<App />);

    fireEvent.click(await screen.findByRole(
      "button",
      { name: "Settings and information" },
    ));
    const transparency = screen.getByRole(
      "slider",
      { name: "Glass transparency" },
    );
    fireEvent.change(transparency, { target: { value: "55" } });
    fireEvent.pointerUp(transparency);

    expect(await screen.findByText(
      "Settings were saved but could not be verified. They will be read again after the next settings change or restart.",
    )).toHaveAttribute("role", "status");
  });

  it("blocks preference navigation during appearance persistence and rolls back on failure", async () => {
    const statsPreferences = {
      ...quotaPreferences,
      expandedView: "tokenStats" as const,
    };
    const persistence = deferred<void>();
    mocks.getPreferences.mockResolvedValue(statsPreferences);
    mocks.updatePreferences.mockReturnValueOnce(persistence.promise);
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "设置与说明" }));
    const transparency = screen.getByRole("slider", { name: "玻璃透明度" });
    fireEvent.change(transparency, { target: { value: "55" } });
    fireEvent.pointerUp(transparency);

    await waitFor(() => {
      expect(mocks.updatePreferences).toHaveBeenCalledTimes(1);
      expect(screen.getByRole(
        "button",
        { name: "切换到剩余额度", hidden: true },
      ))
        .toBeDisabled();
      expect(screen.getByRole("button", { name: "关闭设置与说明" }))
        .toBeDisabled();
    });

    persistence.reject(new Error("disk full"));
    expect(await screen.findByText(
      "设置保存失败，已恢复上一次保存的外观。",
    )).toHaveAttribute("role", "status");
    expect(screen.getByRole("slider", { name: "玻璃透明度" })).toHaveValue("40");
    expect(screen.getByRole(
      "button",
      { name: "切换到剩余额度", hidden: true },
    ))
      .not.toBeDisabled();
  });

  it("does not collapse or unmount an open appearance sheet on mouse leave", async () => {
    mocks.getPreferences.mockResolvedValue({
      ...quotaPreferences,
      expandedView: "tokenStats",
    });
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "设置与说明" }));
    const dialog = screen.getByRole("dialog", { name: "设置与说明" });
    mocks.setWidgetMode.mockClear();
    fireEvent.mouseLeave(dialog.closest("div[style]") as HTMLElement);

    expect(screen.getByRole("dialog", { name: "设置与说明" }))
      .toBeInTheDocument();
    expect(mocks.setWidgetMode).not.toHaveBeenCalledWith("compact");
  });
});
