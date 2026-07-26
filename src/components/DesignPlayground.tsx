import { useMemo, useState, type CSSProperties } from "react";
import type {
  GlassStyle,
  ProviderSnapshot,
  StatsGranularity,
  TokenStatsBucket,
  TokenStatsSnapshot,
  WidgetPreferences,
} from "../types";
import { QuotaCard, QuotaOrb } from "./QuotaCard";
import { TokenStatsCard } from "./TokenStatsCard";

const preview: ProviderSnapshot = {
  provider: "codex",
  displayName: "CODEX",
  plan: "PRO",
  shortWindow: { remainingPercent: 74, resetsAt: new Date(Date.now() + 78 * 60_000).toISOString(), windowSeconds: 18_000 },
  weeklyWindow: { remainingPercent: 42, resetsAt: new Date(Date.now() + 3.2 * 86_400_000).toISOString(), windowSeconds: 604_800 },
  resetCredits: 1,
  resetCreditExpiresAt: [new Date(Date.now() + 9 * 86_400_000).toISOString()],
  updatedAt: new Date().toISOString(),
  status: "ok",
  message: null,
};
const preferences: WidgetPreferences = { locked: false, alwaysOnTop: true, pinnedProvider: "codex", autoRotateSeconds: 12, language: "en", expandedView: "quota", glassTransparency: 40, glassBlurStrength: 40, glassStyle: "regular" };

interface Values {
  radius: number;
  numberSize: number;
  progressHeight: number;
  brightness: number;
  motion: number;
  cool: string;
  glow: string;
  warm: string;
  glassTransparency: number;
  glassBlurStrength: number;
  glassStyle: GlassStyle;
}

type StatsPreviewMode =
  | "stats-day"
  | "stats-week"
  | "stats-month"
  | "stats-empty"
  | "stats-stale"
  | "stats-unavailable"
  | "stats-settings";

type PreviewMode =
  | 74
  | 35
  | 8
  | "unavailable"
  | "stale"
  | "signed_out"
  | "weekly-only"
  | "orb"
  | StatsPreviewMode;

const previewModes: Array<{ value: PreviewMode; label: string }> = [
  { value: 74, label: "74% Healthy" },
  { value: 35, label: "35% Caution" },
  { value: 8, label: "8% Critical" },
  { value: "unavailable", label: "Unavailable" },
  { value: "stale", label: "Stale" },
  { value: "signed_out", label: "Signed out" },
  { value: "weekly-only", label: "Weekly only" },
  { value: "orb", label: "Orb" },
  { value: "stats-day", label: "Last 7 days · 7" },
  { value: "stats-week", label: "Last 12 weeks · 12" },
  { value: "stats-month", label: "This year · 12" },
  { value: "stats-empty", label: "Stats empty" },
  { value: "stats-stale", label: "Stats stale" },
  { value: "stats-unavailable", label: "Stats unavailable" },
  { value: "stats-settings", label: "Settings" },
];

const defaults: Values = {
  radius: 38,
  numberSize: 64,
  progressHeight: 6,
  brightness: 100,
  motion: 18,
  cool: "#7188bd",
  glow: "#fff4c3",
  warm: "#ff7653",
  glassTransparency: 40,
  glassBlurStrength: 40,
  glassStyle: "regular",
};

function isStatsPreview(mode: PreviewMode): mode is StatsPreviewMode {
  return typeof mode === "string" && mode.startsWith("stats-");
}

function mockStatsBucket(
  granularity: StatsGranularity,
  index: number,
  count: number,
): TokenStatsBucket {
  const patternedTotal = [82_000, 147_000, 96_000, 218_000, 172_000, 284_000][index % 6]
    + index * 7_300;
  const totalTokens = granularity === "month" && index === 6
    ? 1_210_000
    : index === count - 1
      ? 1_840_000
      : patternedTotal;
  const isFuture = granularity === "month" && index > 6;
  const label = granularity === "day"
    ? `${index + 1}日`
    : granularity === "week"
      ? `W${17 + index}`
      : `${index + 1}月`;
  const key = granularity === "day"
    ? `sample-day-${index + 1}`
    : granularity === "week"
      ? `sample-week-${index + 1}`
      : `sample-month-${index + 1}`;

  return {
    key,
    label,
    rangeStart: `2026-01-${String(Math.min(index + 1, 28)).padStart(2, "0")}T00:00:00+08:00`,
    rangeEnd: `2026-01-${String(Math.min(index + 2, 28)).padStart(2, "0")}T00:00:00+08:00`,
    totals: {
      totalTokens: isFuture ? 0 : totalTokens,
      inputTokens: isFuture ? 0 : Math.round(totalTokens * .7),
      cachedInputTokens: isFuture ? 0 : Math.round(totalTokens * .32),
      outputTokens: isFuture ? 0 : Math.round(totalTokens * .19),
      reasoningTokens: isFuture ? 0 : Math.round(totalTokens * .11),
    },
    taskCount: isFuture ? 0 : index % 5 + 1,
    peakTaskTokens: isFuture ? 0 : Math.round(totalTokens * .43),
    isFuture,
  };
}

function mockStatsSnapshot(
  granularity: StatsGranularity,
  status: TokenStatsSnapshot["status"] = "ok",
): TokenStatsSnapshot {
  const count = granularity === "day" ? 7 : 12;
  return {
    status,
    granularity,
    buckets: status === "empty"
      ? []
      : Array.from({ length: count }, (_, index) => (
        mockStatsBucket(granularity, index, count)
      )),
    updatedAt: "2026-07-23T06:26:00Z",
    message: null,
    partial: status === "stale",
  };
}

function initialPreviewMode(): PreviewMode {
  const mode = new URLSearchParams(window.location.search).get("mode");
  if (mode === "healthy") return 74;
  if (mode === "caution") return 35;
  if (mode === "critical") return 8;
  if (mode === "unavailable" || mode === "stale" || mode === "signed_out" || mode === "weekly-only" || mode === "orb") return mode;
  if (mode === "daily") return "stats-day";
  if (mode === "weekly") return "stats-week";
  if (mode === "monthly") return "stats-month";
  if (mode === "empty") return "stats-empty";
  if (mode === "stats-stale") return "stats-stale";
  if (mode === "stats-unavailable") return "stats-unavailable";
  if (mode === "settings") return "stats-settings";
  return "stats-day";
}

export function DesignPlayground() {
  const [values, setValues] = useState(defaults);
  const [previewMode, setPreviewMode] = useState<PreviewMode>(() => initialPreviewMode());
  const [selectedBucketKey, setSelectedBucketKey] = useState<string | null>(null);
  const [quotaSettingsOpen, setQuotaSettingsOpen] = useState(false);
  const params = new URLSearchParams(window.location.search);
  const screenshotMode = params.has("shot");
  const shotKind = params.get("shot");
  const showCreditTip = params.has("creditTip");
  const style = useMemo(() => ({
    "--card-radius": `${values.radius}px`,
    "--number-size": `${values.numberSize}px`,
    "--progress-height": `${values.progressHeight}px`,
    "--card-brightness": `${values.brightness}%`,
    "--motion-duration": `${values.motion}s`,
    "--cool": values.cool,
    "--glow": values.glow,
    "--warm": values.warm,
    "--glass-transparency": values.glassTransparency,
    "--glass-blur-strength": values.glassBlurStrength,
    "--glass-alpha": (100 - values.glassTransparency) / 100,
  }) as CSSProperties, [values]);

  const makePreview = (mode: PreviewMode): ProviderSnapshot => {
    if (isStatsPreview(mode)) return preview;
    if (mode === "orb") return preview;
    if (mode === "weekly-only") {
      return {
        ...preview,
        shortWindow: {
          remainingPercent: 64,
          resetsAt: preview.weeklyWindow?.resetsAt ?? null,
          windowSeconds: 604_800,
        },
        weeklyWindow: null,
      };
    }
    if (typeof mode === "number") {
      return { ...preview, shortWindow: preview.shortWindow ? { ...preview.shortWindow, remainingPercent: mode } : null };
    }
    if (mode === "stale") {
      return { ...preview, status: "stale", updatedAt: new Date(Date.now() - 2 * 60 * 60_000).toISOString(), message: "Refresh failed. Please try again later." };
    }
    return {
      ...preview,
      status: mode,
      shortWindow: null,
      weeklyWindow: null,
      resetCredits: null,
      message: mode === "signed_out" ? "Codex sign-in expired. Please sign in again." : "Quota is temporarily unavailable. It will retry in 30 seconds.",
    };
  };

  const activePreview = useMemo<ProviderSnapshot>(() => makePreview(previewMode), [previewMode]);
  const statsMode = isStatsPreview(previewMode);
  const statsGranularity: StatsGranularity = previewMode === "stats-week"
    ? "week"
    : previewMode === "stats-month"
      ? "month"
      : "day";
  const statsStatus: TokenStatsSnapshot["status"] = previewMode === "stats-empty"
    ? "empty"
    : previewMode === "stats-stale"
      ? "stale"
      : previewMode === "stats-unavailable"
        ? "unavailable"
      : "ok";
  const statsSnapshot = useMemo(
    () => mockStatsSnapshot(statsGranularity, statsStatus),
    [statsGranularity, statsStatus],
  );
  const statsPreferences = useMemo<WidgetPreferences>(() => ({
    ...preferences,
    language: "zh-CN",
    expandedView: "tokenStats",
    glassTransparency: values.glassTransparency,
    glassBlurStrength: values.glassBlurStrength,
    glassStyle: values.glassStyle,
  }), [values.glassBlurStrength, values.glassStyle, values.glassTransparency]);
  const quotaPreferences = useMemo<WidgetPreferences>(() => ({
    ...preferences,
    glassTransparency: values.glassTransparency,
    glassBlurStrength: values.glassBlurStrength,
    glassStyle: values.glassStyle,
  }), [values.glassBlurStrength, values.glassStyle, values.glassTransparency]);

  const update = <K extends keyof Values>(key: K, value: Values[K]) => setValues((current) => ({ ...current, [key]: value }));
  const saveQuotaPreferences = async (next: WidgetPreferences) => {
    setValues((current) => ({
      ...current,
      glassTransparency: next.glassTransparency,
      glassBlurStrength: next.glassBlurStrength,
      glassStyle: next.glassStyle,
    }));
  };
  const setStatsGranularity = (granularity: StatsGranularity) => {
    setSelectedBucketKey(null);
    setPreviewMode(
      granularity === "day"
        ? "stats-day"
        : granularity === "week"
          ? "stats-week"
          : "stats-month",
    );
  };
  const statsPreview = (
    <TokenStatsCard
      snapshot={statsSnapshot}
      granularity={statsGranularity}
      selectedBucketKey={selectedBucketKey}
      plan={preview.plan}
      preferences={statsPreferences}
      onGranularityChange={setStatsGranularity}
      onSelectedBucketChange={setSelectedBucketKey}
      onSwitchToQuota={() => setPreviewMode(74)}
      onRefresh={() => {}}
      onLanguage={() => {}}
      onAlwaysOnTop={() => {}}
      onOpenSettings={() => setPreviewMode("stats-settings")}
      settingsOpen={previewMode === "stats-settings"}
      onCloseSettings={() => setPreviewMode("stats-day")}
      onSavePreferences={saveQuotaPreferences}
      onDrag={() => {}}
      onHover={() => {}}
    />
  );

  if (screenshotMode) {
    if (shotKind === "states") {
      return (
        <div className="screenshot-stage screenshot-stage--states" style={style}>
          {[74, 35, 8].map((mode) => (
            <div className="design-card-frame" key={mode}>
              <QuotaCard snapshot={makePreview(mode as PreviewMode)} preferences={quotaPreferences} onLock={() => {}} onLanguage={() => {}} onDrag={() => {}} onHover={() => {}} onOpenSettings={() => {}} settingsOpen={false} onCloseSettings={() => {}} onSavePreferences={saveQuotaPreferences} isConsuming={mode === 35} />
            </div>
          ))}
        </div>
      );
    }

    return (
      <div
        className={`screenshot-stage${statsMode ? " screenshot-stage--glass" : ""}`}
        data-preview-kind={statsMode ? "synthetic" : undefined}
        style={style}
      >
        <div className={statsMode ? "design-stats-frame" : previewMode === "orb" ? "design-orb-frame" : "design-card-frame"}>
          {statsMode
            ? statsPreview
            : previewMode === "orb"
            ? <QuotaOrb snapshot={activePreview} language="en" onDrag={() => {}} onHover={() => {}} />
            : <QuotaCard snapshot={activePreview} preferences={quotaPreferences} onLock={() => {}} onLanguage={() => {}} onDrag={() => {}} onHover={() => {}} onOpenSettings={() => setQuotaSettingsOpen(true)} settingsOpen={quotaSettingsOpen} onCloseSettings={() => setQuotaSettingsOpen(false)} onSavePreferences={saveQuotaPreferences} initialShowCreditTip={showCreditTip} />}
        </div>
      </div>
    );
  }

  return (
    <div className="design-workbench">
      <section className={`design-stage${statsMode ? " design-stage--glass" : ""}`} style={style}>
        <p className="design-stats-note">{statsMode ? "SAMPLE LOCAL DATA · 400 × 400" : "QUOTA PREVIEW · 320 × 320"}</p>
        <div className="design-preview-switch" aria-label="Widget state preview">
          {previewModes.map((mode) => (
            <button key={mode.value} className={previewMode === mode.value ? "is-active" : ""} onClick={() => setPreviewMode(mode.value)}>{mode.label}</button>
          ))}
        </div>
        <div className={statsMode ? "design-stats-frame" : previewMode === "orb" ? "design-orb-frame" : "design-card-frame"}>
          {statsMode
            ? statsPreview
            : previewMode === "orb"
            ? <QuotaOrb snapshot={activePreview} onDrag={() => {}} onHover={() => {}} />
            : <QuotaCard snapshot={activePreview} preferences={quotaPreferences} onLock={() => {}} onLanguage={() => {}} onDrag={() => {}} onHover={() => {}} onOpenSettings={() => setQuotaSettingsOpen(true)} settingsOpen={quotaSettingsOpen} onCloseSettings={() => setQuotaSettingsOpen(false)} onSavePreferences={saveQuotaPreferences} />}
        </div>
      </section>
      <aside className="design-controls">
        <div>
          <p className="design-kicker">TOKENHALO</p>
          <h1>{statsMode ? "Glass Preview" : "Visual Tuning"}</h1>
          <p className="design-description">
            {statsMode
              ? "Sample-only local statistics states on a high-contrast desktop. The masked border highlight stays fixed at 50%."
              : "Preview changes live, then apply the chosen values to the desktop widget."}
          </p>
        </div>
        {statsMode ? (
          <>
            <Range label="Glass transparency" value={values.glassTransparency} min={10} max={90} unit="%" onChange={(v) => update("glassTransparency", v)} />
            <Range label="Background blur" value={values.glassBlurStrength} min={0} max={60} unit="px" onChange={(v) => update("glassBlurStrength", v)} />
          </>
        ) : (
          <>
            <Range label="Radius" value={values.radius} min={24} max={64} unit="px" onChange={(v) => update("radius", v)} />
            <Range label="Main number" value={values.numberSize} min={56} max={110} unit="px" onChange={(v) => update("numberSize", v)} />
            <Range label="Progress" value={values.progressHeight} min={4} max={12} unit="px" onChange={(v) => update("progressHeight", v)} />
            <Range label="Brightness" value={values.brightness} min={70} max={125} unit="%" onChange={(v) => update("brightness", v)} />
            <Range label="Motion" value={values.motion} min={6} max={40} unit="s" onChange={(v) => update("motion", v)} />
            <div className="color-row">
              <Color label="Cool" value={values.cool} onChange={(v) => update("cool", v)} />
              <Color label="Glow" value={values.glow} onChange={(v) => update("glow", v)} />
              <Color label="Warm" value={values.warm} onChange={(v) => update("warm", v)} />
            </div>
          </>
        )}
        <button className="reset-design" onClick={() => setValues(defaults)}>Reset design</button>
      </aside>
    </div>
  );
}

function Range({ label, value, min, max, unit, onChange }: { label: string; value: number; min: number; max: number; unit: string; onChange: (value: number) => void }) {
  return <label className="range-control"><span>{label}<output>{value}{unit}</output></span><input type="range" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}

function Color({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="color-control"><input type="color" value={value} onChange={(event) => onChange(event.target.value)} /><span>{label}</span></label>;
}
