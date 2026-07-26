import type {
  StatsGranularity,
  TokenStatsBucket,
  TokenStatsSnapshot,
} from "../types";

const MOCK_UPDATED_AT = "2026-07-23T06:00:00Z";
const MOCK_DAY_START = Date.UTC(2026, 6, 17);

function mockPeriod(
  granularity: StatsGranularity,
  index: number,
): { key: string; label: string; rangeStart: string; rangeEnd: string } {
  if (granularity === "day") {
    const start = new Date(MOCK_DAY_START + index * 86_400_000);
    return {
      key: start.toISOString().slice(0, 10),
      label: `${start.getUTCMonth() + 1}/${start.getUTCDate()}`,
      rangeStart: start.toISOString(),
      rangeEnd: new Date(start.getTime() + 86_400_000).toISOString(),
    };
  }
  if (granularity === "week") {
    const start = new Date(Date.UTC(2026, 4, 4 + index * 7));
    return {
      key: `2026-W${19 + index}`,
      label: `W${19 + index}`,
      rangeStart: start.toISOString(),
      rangeEnd: new Date(start.getTime() + 7 * 86_400_000).toISOString(),
    };
  }
  return {
    key: `2026-${String(index + 1).padStart(2, "0")}`,
    label: `${index + 1}月`,
    rangeStart: new Date(Date.UTC(2026, index, 1)).toISOString(),
    rangeEnd: new Date(Date.UTC(2026, index + 1, 1)).toISOString(),
  };
}

function mockBucket(
  granularity: StatsGranularity,
  index: number,
  count: number,
): TokenStatsBucket {
  const totalTokens = index === count - 1 ? 5_250_000 : (index % 7 + 1) * 125_000;
  const inputTokens = Math.round(totalTokens * 0.72);
  const outputTokens = Math.round(totalTokens * 0.18);
  const cachedInputTokens = Math.round(totalTokens * 0.45);
  const period = mockPeriod(granularity, index);

  return {
    ...period,
    totals: {
      totalTokens,
      inputTokens,
      cachedInputTokens,
      outputTokens,
      reasoningTokens: totalTokens - inputTokens - outputTokens,
    },
    taskCount: index % 8 + 1,
    peakTaskTokens: Math.round(totalTokens * 0.4),
    isFuture: granularity === "month" && index > 6,
  };
}

function browserSnapshot(granularity: StatsGranularity): TokenStatsSnapshot {
  const count = granularity === "day" ? 7 : 12;
  return {
    status: "ok",
    granularity,
    buckets: Array.from(
      { length: count },
      (_, index) => mockBucket(granularity, index, count),
    ),
    updatedAt: MOCK_UPDATED_AT,
    message: null,
    partial: false,
  };
}

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function fetchTokenStats(
  granularity: StatsGranularity,
  force = false,
): Promise<TokenStatsSnapshot> {
  if (!isTauri()) return browserSnapshot(granularity);
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<TokenStatsSnapshot>("get_token_stats", { granularity, force });
}
