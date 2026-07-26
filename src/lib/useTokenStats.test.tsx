// @vitest-environment jsdom

import { act, render, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StatsGranularity, TokenStatsSnapshot } from "../types";
import { fetchTokenStats } from "./tokenStats";
import { useTokenStats } from "./useTokenStats";

vi.mock("./tokenStats", () => ({
  fetchTokenStats: vi.fn(),
}));

const mockFetchTokenStats = vi.mocked(fetchTokenStats);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function snapshot(
  granularity: StatsGranularity,
  totalTokens = 100,
): TokenStatsSnapshot {
  return {
    status: "ok",
    granularity,
    buckets: [{
      key: `${granularity}-latest`,
      label: `${granularity} latest`,
      rangeStart: "2026-07-23T00:00:00+08:00",
      rangeEnd: "2026-07-24T00:00:00+08:00",
      totals: {
        totalTokens,
        inputTokens: totalTokens,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
      },
      taskCount: 1,
      peakTaskTokens: totalTokens,
      isFuture: false,
    }],
    updatedAt: "2026-07-23T06:00:00Z",
    message: null,
    partial: false,
  };
}

describe("useTokenStats", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockFetchTokenStats.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads immediately while active", async () => {
    const current = snapshot("day");
    mockFetchTokenStats.mockResolvedValue(current);

    const { result } = renderHook(() => useTokenStats(true, "day"));

    expect(result.current.loading).toBe(true);
    expect(mockFetchTokenStats).toHaveBeenCalledWith("day", false);
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.snapshot).toEqual(current);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("reports loading on the synchronous first active render before effects run", async () => {
    const request = deferred<TokenStatsSnapshot>();
    const renders: ReturnType<typeof useTokenStats>[] = [];
    mockFetchTokenStats.mockReturnValue(request.promise);

    function Probe() {
      const value = useTokenStats(true, "day");
      renders.push(value);
      return null;
    }

    render(<Probe />);

    expect(renders[0].loading).toBe(true);
    expect(renders[0].snapshot).toBeNull();
    expect(renders[0].error).toBeNull();

    await act(async () => {
      request.resolve(snapshot("day"));
      await request.promise;
    });
  });

  it("does not request statistics while inactive", async () => {
    const { result } = renderHook(() => useTokenStats(false, "day"));

    expect(result.current.loading).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(180_000);
    });
    expect(mockFetchTokenStats).not.toHaveBeenCalled();
  });

  it("refreshes every 60 seconds only while active", async () => {
    mockFetchTokenStats.mockResolvedValue(snapshot("day"));
    const { rerender } = renderHook(
      ({ active }) => useTokenStats(active, "day"),
      { initialProps: { active: true } },
    );
    await act(async () => {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(mockFetchTokenStats).toHaveBeenCalledTimes(2);
    expect(mockFetchTokenStats).toHaveBeenLastCalledWith("day", false);

    rerender({ active: false });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(mockFetchTokenStats).toHaveBeenCalledTimes(2);
  });

  it("retains the last good snapshot and exposes a refresh error", async () => {
    const current = snapshot("day", 125);
    mockFetchTokenStats
      .mockResolvedValueOnce(current)
      .mockRejectedValueOnce(new Error("refresh failed"));
    const { result } = renderHook(() => useTokenStats(true, "day"));
    await act(async () => {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(result.current.snapshot).toEqual(current);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe("refresh failed");
  });

  it("allows the active view to request a forced refresh", async () => {
    mockFetchTokenStats.mockResolvedValue(snapshot("day"));
    const { result } = renderHook(() => useTokenStats(true, "day"));
    await act(async () => {
      await Promise.resolve();
      await result.current.refresh();
    });

    expect(mockFetchTokenStats).toHaveBeenLastCalledWith("day", true);
  });

  it("reloads immediately for a new granularity", async () => {
    mockFetchTokenStats
      .mockResolvedValueOnce(snapshot("day"))
      .mockResolvedValueOnce(snapshot("week"));
    const { result, rerender } = renderHook(
      ({ granularity }) => useTokenStats(true, granularity),
      { initialProps: { granularity: "day" as StatsGranularity } },
    );
    await act(async () => {
      await Promise.resolve();
    });

    rerender({ granularity: "week" });
    expect(mockFetchTokenStats).toHaveBeenLastCalledWith("week", false);
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.snapshot?.granularity).toBe("week");
  });

  it("synchronously marks a new granularity pending while retaining the previous snapshot", async () => {
    const weekRequest = deferred<TokenStatsSnapshot>();
    const renders: ReturnType<typeof useTokenStats>[] = [];
    mockFetchTokenStats
      .mockResolvedValueOnce(snapshot("day"))
      .mockReturnValueOnce(weekRequest.promise);

    function Probe({ granularity }: { granularity: StatsGranularity }) {
      const value = useTokenStats(true, granularity);
      renders.push(value);
      return null;
    }

    const { rerender } = render(<Probe granularity="day" />);
    await act(async () => {
      await Promise.resolve();
    });
    renders.length = 0;

    rerender(<Probe granularity="week" />);

    expect(renders[0].snapshot?.granularity).toBe("day");
    expect(renders[0].loading).toBe(true);
    expect(renders[0].error).toBeNull();

    await act(async () => {
      weekRequest.resolve(snapshot("week"));
      await weekRequest.promise;
    });
  });

  it("does not expose a settled error from the previous granularity", async () => {
    const weekRequest = deferred<TokenStatsSnapshot>();
    const renders: ReturnType<typeof useTokenStats>[] = [];
    mockFetchTokenStats
      .mockRejectedValueOnce(new Error("day failed"))
      .mockReturnValueOnce(weekRequest.promise);

    function Probe({ granularity }: { granularity: StatsGranularity }) {
      const value = useTokenStats(true, granularity);
      renders.push(value);
      return null;
    }

    const { rerender } = render(<Probe granularity="day" />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(renders.at(-1)?.loading).toBe(false);
    expect(renders.at(-1)?.error).toBe("day failed");
    renders.length = 0;

    rerender(<Probe granularity="week" />);

    expect(renders[0].loading).toBe(true);
    expect(renders[0].error).toBeNull();

    await act(async () => {
      weekRequest.resolve(snapshot("week"));
      await weekRequest.promise;
    });
  });

  it("settles an initial failure instead of remaining busy", async () => {
    mockFetchTokenStats.mockRejectedValue(new Error("initial failed"));

    const { result } = renderHook(() => useTokenStats(true, "day"));
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe("initial failed");
    expect(result.current.snapshot).toBeNull();
  });

  it("does not let an older request replace a newer granularity", async () => {
    let resolveDay!: (value: TokenStatsSnapshot) => void;
    mockFetchTokenStats
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveDay = resolve;
      }))
      .mockResolvedValueOnce(snapshot("week", 200));
    const { result, rerender } = renderHook(
      ({ granularity }) => useTokenStats(true, granularity),
      { initialProps: { granularity: "day" as StatsGranularity } },
    );

    rerender({ granularity: "week" });
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.snapshot?.granularity).toBe("week");

    await act(async () => {
      resolveDay(snapshot("day", 999));
      await Promise.resolve();
    });
    expect(result.current.snapshot?.granularity).toBe("week");
  });
});
