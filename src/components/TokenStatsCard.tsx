import {
  memo,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { copy, normalizeLanguage } from "../lib/i18n";
import { AppearanceSheet } from "./AppearanceSheet";
import { CardChrome } from "./CardChrome";
import type {
  StatsGranularity,
  TokenStatsBucket,
  TokenStatsSnapshot,
  WidgetPreferences,
} from "../types";

interface Props {
  snapshot: TokenStatsSnapshot;
  granularity: StatsGranularity;
  selectedBucketKey: string | null;
  plan: string | null;
  preferences: WidgetPreferences;
  loading?: boolean;
  hasMatchingSnapshot?: boolean;
  onGranularityChange: (granularity: StatsGranularity) => void;
  onSelectedBucketChange: (key: string) => void;
  onSwitchToQuota: () => void;
  onRefresh: () => void | Promise<void>;
  onLanguage: () => void;
  onAlwaysOnTop: () => void;
  onOpenSettings: () => void;
  settingsOpen?: boolean;
  onCloseSettings?: () => void;
  onSavePreferences?: (preferences: WidgetPreferences) => Promise<void>;
  onDrag?: () => void;
  onHover?: (hovered: boolean) => void;
  preferenceActionsDisabled?: boolean;
}

const compactNumber = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 2,
});

const chineseNumber = new Intl.NumberFormat("zh-CN", {
  maximumFractionDigits: 2,
});

function formatCompact(value: number, language: WidgetPreferences["language"]): string {
  const safeValue = Math.max(0, value);
  if (language === "zh-CN") {
    if (safeValue >= 100_000_000) {
      return `${chineseNumber.format(safeValue / 100_000_000)} 亿`;
    }
    if (safeValue >= 10_000) {
      return `${chineseNumber.format(safeValue / 10_000)} 万`;
    }
    return chineseNumber.format(safeValue);
  }
  return compactNumber.format(safeValue);
}

function splitCompact(
  value: number,
  language: WidgetPreferences["language"],
): { number: string; suffix: string } {
  const formatted = formatCompact(value, language);
  const suffix = ["亿", "万", "K", "M", "B", "T"].find((candidate) => (
    formatted.endsWith(candidate)
  ));
  return {
    number: suffix ? formatted.slice(0, -suffix.length).trim() : formatted,
    suffix: suffix ?? "",
  };
}

function latestValidBucket(buckets: TokenStatsBucket[]): TokenStatsBucket | null {
  for (let index = buckets.length - 1; index >= 0; index -= 1) {
    if (!buckets[index].isFuture) return buckets[index];
  }
  return null;
}

interface AxisLabel {
  key: string;
  label: string;
  position: number;
  edge: "start" | "middle" | "end";
}

function visibleAxisLabels(
  buckets: TokenStatsBucket[],
  selectedKey: string | null,
): AxisLabel[] {
  if (buckets.length === 0) return [];
  const lastIndex = buckets.length - 1;
  const selectedIndex = buckets.findIndex((bucket) => bucket.key === selectedKey);
  const middleIndex = selectedIndex > 0 && selectedIndex < lastIndex
    ? selectedIndex
    : Math.round(lastIndex / 2);
  const indexes = [...new Set([0, middleIndex, lastIndex])].sort((a, b) => a - b);

  return indexes.map((index) => ({
    key: buckets[index].key,
    label: buckets[index].label,
    position: lastIndex === 0 ? 0 : index / lastIndex * 100,
    edge: index === 0 ? "start" : index === lastIndex ? "end" : "middle",
  }));
}

function formatUpdatedAt(value: string, language: WidgetPreferences["language"]): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(language === "en" ? "en-US" : "zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function activateWithKeyboard(
  event: KeyboardEvent<HTMLButtonElement>,
  action: () => void,
) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  action();
}

export const TokenStatsCard = memo(function TokenStatsCard({
  snapshot,
  granularity,
  selectedBucketKey,
  plan,
  preferences,
  loading = false,
  hasMatchingSnapshot = snapshot.granularity === granularity,
  onGranularityChange,
  onSelectedBucketChange,
  onSwitchToQuota,
  onRefresh,
  onLanguage,
  onAlwaysOnTop,
  onOpenSettings,
  settingsOpen = false,
  onCloseSettings = () => undefined,
  onSavePreferences = async () => undefined,
  onDrag,
  onHover,
  preferenceActionsDisabled = false,
}: Props) {
  const [appearancePreview, setAppearancePreview] = useState<WidgetPreferences | null>(null);
  const language = normalizeLanguage(preferences.language);
  const t = copy[language];
  const showLoadingState = loading && !hasMatchingSnapshot;
  const hasData = snapshot.status === "ok" || snapshot.status === "stale";
  const buckets = hasData && snapshot.granularity === granularity
    ? snapshot.buckets
    : [];
  const fallbackBucket = useMemo(() => latestValidBucket(buckets), [buckets]);
  const selectedBucket = useMemo(() => {
    const controlled = buckets.find((bucket) => (
      bucket.key === selectedBucketKey && !bucket.isFuture
    ));
    return controlled ?? fallbackBucket;
  }, [buckets, fallbackBucket, selectedBucketKey]);
  const selectedKey = selectedBucket?.key ?? null;

  useEffect(() => {
    if (selectedKey !== null && selectedKey !== selectedBucketKey) {
      onSelectedBucketChange(selectedKey);
    }
  }, [onSelectedBucketChange, selectedBucketKey, selectedKey]);

  const granularityLabels: Record<StatsGranularity, string> = {
    day: t.statsDaily,
    week: t.statsWeekly,
    month: t.statsMonthly,
  };
  const max = Math.max(
    1,
    ...buckets.map((bucket) => bucket.totals.totalTokens),
  );
  const headline = splitCompact(selectedBucket?.totals.totalTokens ?? 0, language);
  const showStatistics = hasData && selectedBucket !== null;
  const axisLabels = useMemo(
    () => visibleAxisLabels(buckets, selectedKey),
    [buckets, selectedKey],
  );
  const statusMessages: string[] = [];
  if (loading && hasMatchingSnapshot) statusMessages.push(t.statsRefreshing);
  if (snapshot.status === "stale") statusMessages.push(t.statsStale);
  if (snapshot.partial && snapshot.status !== "unavailable") {
    statusMessages.push(t.statsPartial);
  }
  const chromeStatus = loading
    ? "active"
    : snapshot.status === "ok"
      ? "ok"
      : snapshot.status === "stale"
        ? "stale"
        : "error";
  const chromeStatusLabel = loading
    ? t.statsRefreshing
    : snapshot.status === "ok"
      ? t.statsUpdatedAt(formatUpdatedAt(snapshot.updatedAt, language))
      : snapshot.status === "stale"
        ? t.statsStale
        : t.statsUnavailable;
  const visiblePreferences = appearancePreview ?? preferences;
  const cardStyle = {
    "--glass-transparency": visiblePreferences.glassTransparency,
    "--glass-blur-strength": visiblePreferences.glassBlurStrength,
    "--glass-alpha": (100 - visiblePreferences.glassTransparency) / 100,
    "--bucket-count": buckets.length,
  } as CSSProperties;

  useEffect(() => {
    if (!settingsOpen) setAppearancePreview(null);
  }, [settingsOpen]);

  const handleCardMouseDown = (event: MouseEvent<HTMLElement>) => {
    if (event.button === 0 && !(event.target as Element).closest("button")) {
      onDrag?.();
    }
  };

  return (
    <main
      className={`expanded-card-surface token-stats-card token-stats-card--${snapshot.status} token-stats-card--${granularity}${showLoadingState ? " token-stats-card--loading" : ""}`}
      style={cardStyle}
      aria-busy={loading || undefined}
      onMouseEnter={() => onHover?.(true)}
      onMouseLeave={() => { if (!settingsOpen) onHover?.(false); }}
      onMouseDown={handleCardMouseDown}
    >
      <div
        className="token-stats-content"
        inert={settingsOpen ? true : undefined}
        aria-hidden={settingsOpen || undefined}
      >
      <CardChrome
        title={t.statsTitle}
        subtitle={t.cardUpdatedAt(
          plan,
          formatUpdatedAt(snapshot.updatedAt, language),
        )}
        statusTone={chromeStatus}
        statusLabel={chromeStatusLabel}
        view="tokenStats"
        preferences={preferences}
        refreshing={loading}
        disabled={preferenceActionsDisabled}
        settingsOpen={settingsOpen}
        onRefresh={onRefresh}
        onSwitchView={onSwitchToQuota}
        onLanguage={onLanguage}
        onAlwaysOnTop={onAlwaysOnTop}
        onOpenSettings={onOpenSettings}
      />

      <div
        className="token-stats-tabs"
        role="group"
        aria-label={t.statsTitle}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {(["day", "week", "month"] as const).map((value) => (
          <button
            type="button"
            key={value}
            className={`token-stats-tab${granularity === value ? " token-stats-tab--active" : ""}`}
            aria-pressed={granularity === value}
            onClick={() => onGranularityChange(value)}
          >
            {granularityLabels[value]}
          </button>
        ))}
      </div>

      {statusMessages.length > 0 ? (
        <div className="token-stats-status" role="status" aria-live="polite">
          {statusMessages.map((message) => <span key={message}>{message}</span>)}
        </div>
      ) : null}

      {showLoadingState ? (
        <section
          className="token-stats-state token-stats-loading"
          role="status"
          aria-live="polite"
          aria-label={t.statsLoading}
        >
          <div className="token-stats-loading-skeleton" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <strong>{t.statsLoading}</strong>
        </section>
      ) : null}

      {!showLoadingState && snapshot.status === "empty" ? (
        <section className="token-stats-state" aria-live="polite">
          <strong>{t.statsEmpty}</strong>
        </section>
      ) : null}

      {!showLoadingState && snapshot.status === "unavailable" ? (
        <section className="token-stats-state" aria-live="polite">
          <strong>{t.statsUnavailable}</strong>
          <p>{t.statsUnavailableFallback}</p>
        </section>
      ) : null}

      {!showLoadingState && showStatistics ? (
        <>
          <section className="token-stats-summary">
            <div>
              <p>{t.statsTotal(selectedBucket.label)}</p>
              <strong data-testid="stats-total">
                {headline.number}
                {headline.suffix ? (
                  <small className="token-stats-suffix">{headline.suffix}</small>
                ) : null}
              </strong>
            </div>
            <div className="token-stats-task-count">
              <strong data-testid="stats-tasks">{selectedBucket.taskCount}</strong>
              <span>{t.statsTasks}</span>
            </div>
          </section>

          <div
            className="token-stats-chart"
            role="group"
            aria-label={t.statsChartLabel(granularityLabels[granularity])}
            onMouseDown={(event) => event.stopPropagation()}
          >
            {buckets.map((bucket) => {
              const total = bucket.totals.totalTokens;
              const height = `${Math.max(
                total > 0 ? 8 : 2,
                total / max * 100,
              )}%`;
              const select = () => {
                if (!bucket.isFuture) onSelectedBucketChange(bucket.key);
              };
              return (
                <button
                  type="button"
                  key={bucket.key}
                  className={`token-stats-bar${bucket.key === selectedKey ? " token-stats-bar--selected" : ""}${bucket.isFuture ? " token-stats-bar--future" : ""}`}
                  style={{ height }}
                  aria-label={t.statsBarLabel(
                    bucket.label,
                    formatCompact(total, language),
                    bucket.taskCount,
                  )}
                  aria-pressed={bucket.key === selectedKey}
                  disabled={bucket.isFuture}
                  title={`${bucket.label} · ${formatCompact(total, language)} Token`}
                  onClick={select}
                  onKeyDown={(event) => activateWithKeyboard(event, select)}
                />
              );
            })}
            <div
              className="token-stats-axis"
              data-testid="stats-axis"
              aria-hidden="true"
            >
              {axisLabels.map((axisLabel) => (
                <span
                  key={axisLabel.key}
                  className={`token-stats-axis-label token-stats-axis-label--${axisLabel.edge}`}
                  style={{ "--axis-position": `${axisLabel.position}%` } as CSSProperties}
                >
                  {axisLabel.label}
                </span>
              ))}
            </div>
          </div>

          <dl className="token-stats-details">
            <div>
              <dt>{t.statsInput}</dt>
              <dd data-testid="stats-input">{formatCompact(selectedBucket.totals.inputTokens, language)}</dd>
            </div>
            <div>
              <dt>{t.statsOutput}</dt>
              <dd data-testid="stats-output">{formatCompact(selectedBucket.totals.outputTokens, language)}</dd>
            </div>
            <div>
              <dt>{t.statsCache}</dt>
              <dd data-testid="stats-cache">{formatCompact(selectedBucket.totals.cachedInputTokens, language)}</dd>
            </div>
            <div>
              <dt>{t.statsPeak}</dt>
              <dd data-testid="stats-peak">{formatCompact(selectedBucket.peakTaskTokens, language)}</dd>
            </div>
          </dl>
        </>
      ) : null}

      <p className="token-stats-disclaimer">{t.statsDisclaimer}</p>
      </div>

      {settingsOpen ? (
        <AppearanceSheet
          preferences={preferences}
          onPreview={setAppearancePreview}
          onSave={onSavePreferences}
          onClose={() => {
            setAppearancePreview(null);
            onCloseSettings();
          }}
          disabled={preferenceActionsDisabled}
        />
      ) : null}
    </main>
  );
});
