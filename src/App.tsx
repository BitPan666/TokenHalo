import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QuotaCard, QuotaOrb } from "./components/QuotaCard";
import { TokenStatsCard } from "./components/TokenStatsCard";
import { fetchSnapshots, getPreferences, listenDesktopEvents, setAlwaysOnTop, setWidgetMode, startDragging, updatePreferences } from "./lib/bridge";
import { needsFastRefresh } from "./lib/format";
import { copy, nextLanguage, normalizeLanguage } from "./lib/i18n";
import { mergeSnapshots } from "./lib/snapshots";
import { useTokenStats } from "./lib/useTokenStats";
import type {
  ExpandedView,
  ProviderSnapshot,
  StatsGranularity,
  TokenStatsSnapshot,
  WidgetPreferences,
} from "./types";

const DEFAULT_PREFS: WidgetPreferences = { locked: false, alwaysOnTop: true, pinnedProvider: null, autoRotateSeconds: 12, language: "zh-CN", expandedView: "quota", glassTransparency: 40, glassBlurStrength: 40, glassStyle: "regular" };

interface DisplayIntent {
  generation: number;
  compact: boolean;
}

type OperationNoticeKey =
  | "alwaysOnTopFailed"
  | "appearanceVerificationPending"
  | "codexUsageUnavailable"
  | "desktopEventListenerFailed"
  | "externalSettingsCompact"
  | "externalSettingsReadFailed"
  | "externalSettingsResizeFailed"
  | "externalSettingsUnsafe"
  | "pageSwitchFailed"
  | "pageSwitchRecoveryPrevious"
  | "pageSwitchRecoverySaved"
  | "settingsReadFailed"
  | "settingsSaveFailed"
  | "widgetCollapseFailed"
  | "widgetCollapseRecoveryFailed"
  | "widgetExpandFailed";

function expandedMode(view: ExpandedView) {
  return view === "tokenStats" ? "stats" as const : "quota" as const;
}

function displayMode(intent: Pick<DisplayIntent, "compact">, view: ExpandedView) {
  if (intent.compact) return "compact" as const;
  return expandedMode(view);
}

export default function App() {
  const initialCompact = window.innerWidth <= 120 || window.innerHeight <= 120;
  const [snapshots, setSnapshots] = useState<ProviderSnapshot[]>([]);
  const [preferences, setPreferences] = useState(DEFAULT_PREFS);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [compact, setCompact] = useState(initialCompact);
  const [statsGranularity, setStatsGranularity] = useState<StatsGranularity>("day");
  const [selectedBucketKey, setSelectedBucketKey] = useState<string | null>(null);
  const [consumingProviders, setConsumingProviders] = useState<Set<string>>(() => new Set());
  const [operationNotice, setOperationNotice] = useState<OperationNoticeKey | null>(null);
  const [preferenceMutationPending, setPreferenceMutationPending] = useState(false);
  const [quotaRefreshing, setQuotaRefreshing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const failures = useRef(0);
  const preferencesRef = useRef(preferences);
  const preferencesReadyRef = useRef(false);
  const confirmedViewRef = useRef<ExpandedView>(DEFAULT_PREFS.expandedView);
  const preferenceMutationPendingRef = useRef(false);
  const quotaRefreshPendingRef = useRef(false);
  const externalPreferencesChangedRef = useRef(false);
  const deferredHoverRef = useRef(false);
  const displayIntentRef = useRef<DisplayIntent>({
    generation: 0,
    compact: initialCompact,
  });
  const previousPrimary = useRef(new Map<string, number>());
  const consumptionTimers = useRef(new Map<string, number>());
  const language = normalizeLanguage(preferences.language);
  const t = copy[language];
  const statsActive = preferencesReady && !compact && preferences.expandedView === "tokenStats";
  const tokenStats = useTokenStats(statsActive, statsGranularity);
  preferencesRef.current = preferences;

  const applyConfirmedPreferences = useCallback((next: WidgetPreferences) => {
    const viewChanged = confirmedViewRef.current !== next.expandedView;
    preferencesRef.current = next;
    confirmedViewRef.current = next.expandedView;
    if (viewChanged) setSelectedBucketKey(null);
    setPreferences(next);
  }, []);

  const acquirePreferenceMutation = useCallback(() => {
    if (preferenceMutationPendingRef.current) return false;
    preferenceMutationPendingRef.current = true;
    setPreferenceMutationPending(true);
    return true;
  }, []);

  const finishPreferenceMutation = useCallback(async () => {
    let authoritativeReadSucceeded = true;
    const recoverExternalViewSafely = async (
      next: WidgetPreferences,
      previous: WidgetPreferences,
    ) => {
      const recoveryGeneration = displayIntentRef.current.generation + 1;
      displayIntentRef.current = {
        generation: recoveryGeneration,
        compact: true,
      };
      setCompact(true);
      try {
        await setWidgetMode("compact");
        applyConfirmedPreferences(next);
        setOperationNotice("externalSettingsCompact");
      } catch {
        const latest = displayIntentRef.current;
        if (latest.generation !== recoveryGeneration) {
          applyConfirmedPreferences(next);
          if (!latest.compact) {
            try {
              await setWidgetMode(expandedMode(next.expandedView));
            } catch {
              setOperationNotice("externalSettingsResizeFailed");
            }
          }
          return;
        }

        displayIntentRef.current = {
          generation: recoveryGeneration + 1,
          compact: false,
        };
        setCompact(false);
        try {
          await setWidgetMode(expandedMode(previous.expandedView));
        } catch {
          // Keep the previous UI while a later hover retries a confirmed mode.
        }
        setOperationNotice("externalSettingsUnsafe");
      }
    };

    while (externalPreferencesChangedRef.current) {
      externalPreferencesChangedRef.current = false;
      let next: WidgetPreferences;
      try {
        const value = await getPreferences();
        authoritativeReadSucceeded = true;
        next = { ...DEFAULT_PREFS, ...value, language: normalizeLanguage(value.language) };
        setOperationNotice(null);
      } catch {
        authoritativeReadSucceeded = false;
        setOperationNotice("externalSettingsReadFailed");
        continue;
      }

      const previous = preferencesRef.current;
      const viewChanged = confirmedViewRef.current !== next.expandedView;
      const intent = displayIntentRef.current;
      if (!viewChanged || intent.compact) {
        applyConfirmedPreferences(next);
        continue;
      }

      const generation = intent.generation;
      try {
        await setWidgetMode(expandedMode(next.expandedView));
        applyConfirmedPreferences(next);
        const latest = displayIntentRef.current;
        if (latest.generation !== generation && !latest.compact) {
          try {
            await setWidgetMode(expandedMode(next.expandedView));
          } catch {
            await recoverExternalViewSafely(next, previous);
          }
        }
      } catch {
        const latest = displayIntentRef.current;
        if (latest.generation === generation && !latest.compact) {
          await recoverExternalViewSafely(next, previous);
        } else {
          applyConfirmedPreferences(next);
          if (!latest.compact) {
            try {
              await setWidgetMode(expandedMode(next.expandedView));
            } catch {
              await recoverExternalViewSafely(next, previous);
            }
          }
        }
      }
    }
    preferenceMutationPendingRef.current = false;
    setPreferenceMutationPending(false);
    return authoritativeReadSucceeded;
  }, [applyConfirmedPreferences]);

  const refresh = useCallback(async (force = false) => {
    if (quotaRefreshPendingRef.current) return;
    quotaRefreshPendingRef.current = true;
    setQuotaRefreshing(true);
    try {
      const values = await fetchSnapshots(force);
      setOperationNotice((currentNotice) => (
        currentNotice === "codexUsageUnavailable" ? null : currentNotice
      ));
      const hasFailure = values.some((item) => item.status !== "ok");
      if (hasFailure) failures.current += 1;
      else failures.current = 0;
      for (const item of values) {
        const nextPrimary = item.shortWindow?.remainingPercent;
        const previous = previousPrimary.current.get(item.provider);
        if (nextPrimary !== undefined && previous !== undefined && nextPrimary < previous) {
          setConsumingProviders((current) => new Set(current).add(item.provider));
          const oldTimer = consumptionTimers.current.get(item.provider);
          if (oldTimer !== undefined) window.clearTimeout(oldTimer);
          const timer = window.setTimeout(() => {
            setConsumingProviders((current) => { const next = new Set(current); next.delete(item.provider); return next; });
            consumptionTimers.current.delete(item.provider);
          }, 5 * 60_000);
          consumptionTimers.current.set(item.provider, timer);
        }
        if (nextPrimary !== undefined) previousPrimary.current.set(item.provider, nextPrimary);
      }
      setSnapshots((current) => mergeSnapshots(current, values));
    } catch {
      failures.current += 1;
      setOperationNotice("codexUsageUnavailable");
      setSnapshots((current) => current.length > 0
        ? current.map((item) => ({ ...item, status: "stale", message: null }))
        : [{ provider: "codex", displayName: "CODEX", plan: null, shortWindow: null, weeklyWindow: null, resetCredits: null, resetCreditExpiresAt: [], updatedAt: new Date().toISOString(), status: "unavailable", message: null }]);
    } finally {
      quotaRefreshPendingRef.current = false;
      setQuotaRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh(true);
    void getPreferences().then((value) => {
      const next = { ...DEFAULT_PREFS, ...value, language: normalizeLanguage(value.language) };
      preferencesRef.current = next;
      confirmedViewRef.current = next.expandedView;
      setPreferences(next);
      preferencesReadyRef.current = true;
      setPreferencesReady(true);
    }).catch(() => {
      preferencesReadyRef.current = true;
      setPreferencesReady(true);
      setOperationNotice("settingsReadFailed");
    });
    return () => { for (const timer of consumptionTimers.current.values()) window.clearTimeout(timer); consumptionTimers.current.clear(); };
  }, [refresh]);

  useEffect(() => {
    const updateCompact = () => setCompact(window.innerWidth <= 120 || window.innerHeight <= 120);
    updateCompact();
    window.addEventListener("resize", updateCompact);
    return () => window.removeEventListener("resize", updateCompact);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let cleanup: () => void = () => {};
    void listenDesktopEvents({ onPreferences: () => {
      externalPreferencesChangedRef.current = true;
      if (acquirePreferenceMutation()) {
        void finishPreferenceMutation();
      }
    }, onRefresh: () => void refresh(true) }).then((value) => {
      if (cancelled) value(); else cleanup = value;
    }).catch(() => setOperationNotice("desktopEventListenerFailed"));
    return () => { cancelled = true; cleanup(); };
  }, [acquirePreferenceMutation, finishPreferenceMutation, refresh]);

  const refreshMs = useMemo(() => {
    const backoff = failures.current === 0 ? 5 * 60_000 : Math.min(30 * 60_000, 30_000 * 2 ** (failures.current - 1));
    if (failures.current === 0 && snapshots.some((item) => item.status === "ok" && needsFastRefresh(item))) return 60_000;
    return backoff;
  }, [snapshots]);

  useEffect(() => {
    const id = window.setInterval(() => void refresh(), refreshMs);
    return () => window.clearInterval(id);
  }, [refresh, refreshMs]);

  useEffect(() => {
    const refreshWhenActive = () => { if (document.visibilityState === "visible") void refresh(true); };
    window.addEventListener("focus", refreshWhenActive);
    document.addEventListener("visibilitychange", refreshWhenActive);
    return () => {
      window.removeEventListener("focus", refreshWhenActive);
      document.removeEventListener("visibilitychange", refreshWhenActive);
    };
  }, [refresh]);

  useEffect(() => {
    if (hovered || preferences.pinnedProvider || snapshots.length < 2) return;
    const id = window.setInterval(() => setActiveIndex((value) => (value + 1) % snapshots.length), preferences.autoRotateSeconds * 1000);
    return () => window.clearInterval(id);
  }, [hovered, preferences.autoRotateSeconds, preferences.pinnedProvider, snapshots.length]);

  const current = preferences.pinnedProvider
    ? snapshots.find((item) => item.provider === preferences.pinnedProvider) ?? snapshots[0]
    : snapshots[activeIndex % Math.max(1, snapshots.length)];

  const savePreferences = useCallback((next: WidgetPreferences) => {
    if (!acquirePreferenceMutation()) return;
    const previous = preferencesRef.current;
    applyConfirmedPreferences(next);
    setOperationNotice(null);
    void (async () => {
      try {
        await updatePreferences(next);
      } catch {
        applyConfirmedPreferences(previous);
        setOperationNotice("settingsSaveFailed");
      } finally {
        await finishPreferenceMutation();
      }
    })();
  }, [
    acquirePreferenceMutation,
    applyConfirmedPreferences,
    finishPreferenceMutation,
  ]);

  const changeLanguage = useCallback(() => {
    const currentPreferences = preferencesRef.current;
    savePreferences({
      ...currentPreferences,
      language: nextLanguage(normalizeLanguage(currentPreferences.language)),
    });
  }, [savePreferences]);

  const toggleAlwaysOnTop = useCallback(() => {
    if (!acquirePreferenceMutation()) return;
    setOperationNotice(null);
    void (async () => {
      try {
        const currentPreferences = preferencesRef.current;
        const value = await setAlwaysOnTop(!currentPreferences.alwaysOnTop);
        const next = {
          ...DEFAULT_PREFS,
          ...value,
          language: normalizeLanguage(value.language),
        };
        applyConfirmedPreferences(next);
      } catch {
        setOperationNotice("alwaysOnTopFailed");
      } finally {
        await finishPreferenceMutation();
      }
    })();
  }, [
    acquirePreferenceMutation,
    applyConfirmedPreferences,
    finishPreferenceMutation,
  ]);

  const openSettings = useCallback(() => {
    if (preferenceMutationPendingRef.current) return;
    setOperationNotice(null);
    setSettingsOpen(true);
  }, []);

  const switchExpandedView = useCallback(async (nextView: ExpandedView) => {
    if (
      !preferencesReadyRef.current
      || displayIntentRef.current.compact
      || nextView === confirmedViewRef.current
    ) return;
    if (!acquirePreferenceMutation()) return;
    setSettingsOpen(false);

    const previous = preferencesRef.current;
    const next = { ...previous, expandedView: nextView };
    setOperationNotice(null);

    const confirmPreferences = (value: WidgetPreferences) => {
      applyConfirmedPreferences(value);
    };

    const reconcileExpandedView = async (
      view: ExpandedView,
    ): Promise<"applied" | "superseded" | "failed"> => {
      const intent = displayIntentRef.current;
      if (intent.compact) return "superseded";
      const generation = intent.generation;
      try {
        await setWidgetMode(expandedMode(view));
      } catch {
        const latest = displayIntentRef.current;
        return latest.generation === generation && !latest.compact
          ? "failed"
          : "superseded";
      }
      const latest = displayIntentRef.current;
      return latest.generation === generation && !latest.compact
        ? "applied"
        : "superseded";
    };

    try {
      try {
        await updatePreferences(next);
      } catch {
        setOperationNotice("pageSwitchFailed");
        return;
      }

      confirmedViewRef.current = nextView;
      const transition = await reconcileExpandedView(nextView);
      if (transition !== "failed") {
        confirmPreferences(next);
        return;
      }

      let preferenceRestored = false;
      try {
        await updatePreferences(previous);
        preferenceRestored = true;
      } catch {
        preferenceRestored = false;
      }

      if (!preferenceRestored) {
        confirmPreferences(next);
        const recovery = await reconcileExpandedView(nextView);
        if (recovery === "failed") {
          displayIntentRef.current = {
            generation: displayIntentRef.current.generation + 1,
            compact: true,
          };
          setCompact(true);
          try {
            await setWidgetMode("compact");
          } catch {
            // A later hover transition will retry the confirmed compact intent.
          }
        }
        setOperationNotice("pageSwitchRecoverySaved");
        return;
      }

      confirmPreferences(previous);
      const recovery = await reconcileExpandedView(previous.expandedView);
      if (recovery === "failed") {
        displayIntentRef.current = {
          generation: displayIntentRef.current.generation + 1,
          compact: true,
        };
        setCompact(true);
        try {
          await setWidgetMode("compact");
        } catch {
          // A later hover transition will retry the confirmed compact intent.
        }
        setOperationNotice("pageSwitchRecoveryPrevious");
        return;
      }
      setOperationNotice("pageSwitchFailed");
    } finally {
      await finishPreferenceMutation();
    }
  }, [
    acquirePreferenceMutation,
    applyConfirmedPreferences,
    finishPreferenceMutation,
  ]);

  const handleHover = useCallback((value: boolean) => {
    setHovered(value);
    if (!value) setSettingsOpen(false);
    const generation = displayIntentRef.current.generation + 1;
    const intent: DisplayIntent = {
      generation,
      compact: !value,
    };
    displayIntentRef.current = intent;

    if (!preferencesReadyRef.current) {
      deferredHoverRef.current = value;
      return;
    }

    setCompact(intent.compact);
    if (value) void refresh(true);
    void (async () => {
      try {
        await setWidgetMode(displayMode(intent, confirmedViewRef.current));
      } catch {
        if (displayIntentRef.current.generation !== generation) return;
        displayIntentRef.current = {
          ...displayIntentRef.current,
          compact: !intent.compact,
        };
        setCompact(!intent.compact);
        if (value) {
          setOperationNotice("widgetExpandFailed");
          return;
        }

        try {
          await setWidgetMode(expandedMode(confirmedViewRef.current));
          if (
            displayIntentRef.current.generation === generation
            && !displayIntentRef.current.compact
          ) {
            setOperationNotice("widgetCollapseFailed");
          }
        } catch {
          if (
            displayIntentRef.current.generation === generation
            && !displayIntentRef.current.compact
          ) {
            setOperationNotice("widgetCollapseRecoveryFailed");
          }
        }
      }
    })();
  }, [refresh]);

  const saveAppearancePreferences = useCallback(async (
    next: WidgetPreferences,
  ) => {
    if (!preferencesReadyRef.current || !acquirePreferenceMutation()) {
      throw new Error("A settings update is already in progress.");
    }
    let finished = false;
    setOperationNotice(null);
    try {
      await updatePreferences(next);
      // A completed write is provisionally authoritative for the local UI. A
      // failed verification read must not be reported as a failed save.
      applyConfirmedPreferences(next);
      // Consume both the write event and any concurrent external preference event
      // through the same authoritative readback/reconciliation path.
      externalPreferencesChangedRef.current = true;
      const readbackSucceeded = await finishPreferenceMutation();
      finished = true;
      if (!readbackSucceeded) {
        applyConfirmedPreferences(next);
        setOperationNotice("appearanceVerificationPending");
      }
    } finally {
      if (!finished) await finishPreferenceMutation();
    }
  }, [
    acquirePreferenceMutation,
    applyConfirmedPreferences,
    finishPreferenceMutation,
  ]);

  useEffect(() => {
    if (!preferencesReady || !deferredHoverRef.current) return;
    deferredHoverRef.current = false;
    const intent = displayIntentRef.current;
    if (intent.compact) return;
    setCompact(false);
    void refresh(true);
    void setWidgetMode(displayMode(intent, confirmedViewRef.current)).catch(() => {
      if (displayIntentRef.current.generation !== intent.generation) return;
      displayIntentRef.current = {
        ...displayIntentRef.current,
        compact: true,
      };
      setCompact(true);
      setOperationNotice("widgetExpandFailed");
    });
  }, [preferencesReady, refresh]);

  if (!current) return <div className="loading-card" aria-label={t.loadingQuota}><span /><span /><span /></div>;

  if (!preferencesReady || compact) {
    return <QuotaOrb snapshot={current} language={language} onDrag={() => startDragging()} onHover={handleHover} />;
  }

  if (preferences.expandedView === "tokenStats") {
    const matchingSnapshot = tokenStats.snapshot?.granularity === statsGranularity
      ? tokenStats.snapshot
      : null;
    const fallbackSnapshot: TokenStatsSnapshot = {
      status: tokenStats.error ? "unavailable" : "empty",
      granularity: statsGranularity,
      buckets: [],
      updatedAt: new Date().toISOString(),
      message: null,
      partial: false,
    };
    const renderedNotice = operationNotice
      ? t[operationNotice]
      : tokenStats.error && tokenStats.snapshot
        ? t.statsUnavailableFallback
        : null;
    return (
      <div
        style={{ width: "100%", height: "100%", position: "relative" }}
        onMouseEnter={() => handleHover(true)}
        onMouseLeave={() => {
          if (!settingsOpen) handleHover(false);
        }}
      >
        {renderedNotice ? (
          <p className="operation-notice" role="status">
            {renderedNotice}
          </p>
        ) : null}
        <TokenStatsCard
          snapshot={matchingSnapshot ?? fallbackSnapshot}
          granularity={statsGranularity}
          selectedBucketKey={selectedBucketKey}
          plan={current.plan}
          preferences={preferences}
          loading={tokenStats.loading}
          hasMatchingSnapshot={matchingSnapshot !== null}
          onGranularityChange={(value) => {
            setSelectedBucketKey(null);
            setStatsGranularity(value);
          }}
          onSelectedBucketChange={setSelectedBucketKey}
          onSwitchToQuota={() => void switchExpandedView("quota")}
          onRefresh={() => tokenStats.refresh(true)}
          onLanguage={changeLanguage}
          onAlwaysOnTop={toggleAlwaysOnTop}
          onOpenSettings={openSettings}
          settingsOpen={settingsOpen}
          onCloseSettings={() => setSettingsOpen(false)}
          onSavePreferences={saveAppearancePreferences}
          onDrag={() => startDragging()}
          preferenceActionsDisabled={preferenceMutationPending}
        />
      </div>
    );
  }

  return (
    <QuotaCard
      snapshot={current}
      preferences={preferences}
      onLanguage={changeLanguage}
      onLock={toggleAlwaysOnTop}
      onDrag={() => startDragging()}
      onHover={handleHover}
      onSwitchToStats={() => void switchExpandedView("tokenStats")}
      onRefresh={() => refresh(true)}
      refreshing={quotaRefreshing}
      onOpenSettings={openSettings}
      settingsOpen={settingsOpen}
      onCloseSettings={() => setSettingsOpen(false)}
      onSavePreferences={saveAppearancePreferences}
      isConsuming={consumingProviders.has(current.provider)}
      notice={operationNotice ? t[operationNotice] : null}
      preferenceActionsDisabled={preferenceMutationPending}
    />
  );
}
