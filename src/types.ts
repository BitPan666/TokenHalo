export type ProviderId = "codex" | "claude";
export type SnapshotStatus = "ok" | "stale" | "loading" | "unavailable" | "signed_out";
export type Language = "zh-CN" | "en";
export type ExpandedView = "quota" | "tokenStats";
export type GlassStyle = "clear" | "regular";
export type StatsGranularity = "day" | "week" | "month";
export type TokenStatsStatus = "ok" | "empty" | "stale" | "unavailable";

export interface UsageWindow {
  remainingPercent: number;
  resetsAt: string | null;
  windowSeconds: number;
}

export interface ProviderSnapshot {
  provider: ProviderId;
  displayName: string;
  plan: string | null;
  shortWindow: UsageWindow | null;
  weeklyWindow: UsageWindow | null;
  resetCredits: number | null;
  resetCreditExpiresAt?: string[];
  updatedAt: string;
  status: SnapshotStatus;
  message: string | null;
}

export interface WidgetPreferences {
  locked: boolean;
  alwaysOnTop: boolean;
  pinnedProvider: ProviderId | null;
  autoRotateSeconds: number;
  language: Language;
  expandedView: ExpandedView;
  glassTransparency: number;
  glassBlurStrength: number;
  glassStyle: GlassStyle;
}

export interface TokenTotals {
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
}

export interface TokenStatsBucket {
  key: string;
  label: string;
  rangeStart: string;
  rangeEnd: string;
  totals: TokenTotals;
  taskCount: number;
  peakTaskTokens: number;
  isFuture: boolean;
}

export interface TokenStatsSnapshot {
  status: TokenStatsStatus;
  granularity: StatsGranularity;
  buckets: TokenStatsBucket[];
  updatedAt: string;
  message: string | null;
  partial: boolean;
}
