import { ClockCounterClockwise, CloudSlash, SignIn, WarningCircle } from "@phosphor-icons/react";
import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { clampPercent, formatDateTime, formatResetDate, formatResetTime, quotaTier } from "../lib/format";
import { copy, normalizeLanguage } from "../lib/i18n";
import { classifyUsagePeriod } from "../lib/usagePeriod";
import type { Language, ProviderSnapshot, WidgetPreferences } from "../types";
import { AppearanceSheet } from "./AppearanceSheet";
import { CardChrome } from "./CardChrome";
import { ProviderMark } from "./ProviderMark";

interface Props {
  snapshot: ProviderSnapshot;
  preferences: WidgetPreferences;
  onLock: () => void;
  onLanguage: () => void;
  onDrag: () => void;
  onHover: (hovered: boolean) => void;
  onSwitchToStats?: () => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  onOpenSettings: () => void;
  settingsOpen?: boolean;
  onCloseSettings?: () => void;
  onSavePreferences?: (preferences: WidgetPreferences) => Promise<void>;
  isConsuming?: boolean;
  notice?: string | null;
  initialShowCreditTip?: boolean;
  preferenceActionsDisabled?: boolean;
}

function StatusIcon({ status, expired = false }: { status: ProviderSnapshot["status"]; expired?: boolean }) {
  if (status === "signed_out") return <SignIn weight="duotone" />;
  if (status === "stale" || expired) return <ClockCounterClockwise weight="duotone" />;
  if (status === "unavailable") return <CloudSlash weight="duotone" />;
  return <WarningCircle weight="duotone" />;
}

function localizedBackendMessage(message: string | null, language: Language): string | null {
  if (!message) return null;
  const normalized = message.toLowerCase();
  if (normalized.includes("sign in") || normalized.includes("login")) {
    return copy[language].signedInRequired;
  }
  return copy[language].codexUsageUnavailable;
}

function formatUpdatedAt(value: string, language: Language): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(language === "en" ? "en-US" : "zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export const QuotaCard = memo(function QuotaCard({
  snapshot,
  preferences,
  onLock,
  onLanguage,
  onDrag,
  onHover,
  onSwitchToStats = () => undefined,
  onRefresh = () => undefined,
  refreshing = false,
  onOpenSettings,
  settingsOpen = false,
  onCloseSettings = () => undefined,
  onSavePreferences = async () => undefined,
  isConsuming = false,
  notice = null,
  initialShowCreditTip = false,
  preferenceActionsDisabled = false,
}: Props) {
  const [showCreditTip, setShowCreditTip] = useState(initialShowCreditTip);
  const [appearancePreview, setAppearancePreview] = useState<WidgetPreferences | null>(null);
  const language = normalizeLanguage(preferences.language);
  const t = copy[language];
  const primary = snapshot.shortWindow ? clampPercent(snapshot.shortWindow.remainingPercent) : null;
  const weekly = snapshot.weeklyWindow ? clampPercent(snapshot.weeklyWindow.remainingPercent) : null;
  const primaryPeriod = classifyUsagePeriod(snapshot.shortWindow?.windowSeconds ?? 0);
  const secondaryPeriod = snapshot.weeklyWindow
    ? classifyUsagePeriod(snapshot.weeklyWindow.windowSeconds)
    : null;
  const primaryLabel = t.usagePeriodRemaining(primaryPeriod);
  const primaryAria = t.usageAvailableLabel(primaryPeriod, primary ?? 0);
  const secondaryLabel = secondaryPeriod?.kind === "current"
    ? t.longerPeriodRemaining
    : secondaryPeriod
      ? t.usagePeriodRemaining(secondaryPeriod)
      : null;
  const staleAge = Date.now() - new Date(snapshot.updatedAt).getTime();
  const staleExpired = snapshot.status === "stale" && staleAge > 30 * 60_000;
  const available = snapshot.status === "ok" || (snapshot.status === "stale" && !staleExpired);
  const tier = quotaTier(primary);
  const indicatorState = isConsuming ? "active" : snapshot.status === "ok" ? "ok" : snapshot.status === "stale" ? "stale" : "error";
  const indicatorLabel = isConsuming
    ? t.active
    : snapshot.status === "ok"
      ? t.dataSynced
      : snapshot.status === "stale"
        ? t.dataStale
        : snapshot.status === "signed_out"
          ? t.notSignedIn
          : t.unavailableStatus;
  const message = localizedBackendMessage(snapshot.message, language);
  const creditExpirations = useMemo(() => (snapshot.resetCreditExpiresAt ?? []).map((value, index) => {
    return t.creditItem(index, formatDateTime(value, language));
  }), [language, snapshot.resetCreditExpiresAt, t]);
  const visiblePreferences = appearancePreview ?? preferences;
  const cardStyle = {
    "--glass-transparency": visiblePreferences.glassTransparency,
    "--glass-blur-strength": visiblePreferences.glassBlurStrength,
    "--glass-alpha": (100 - visiblePreferences.glassTransparency) / 100,
  } as CSSProperties;

  useEffect(() => {
    if (!settingsOpen) setAppearancePreview(null);
  }, [settingsOpen]);

  const creditBlock = (
    <div className="quota-credit-block" onMouseDown={(event) => event.stopPropagation()}>
      <div className="reset-credit-row">
        <span>{snapshot.resetCredits === null ? t.resetCreditUnknown : t.resetCredits(snapshot.resetCredits)}</span>
        {snapshot.resetCredits !== null && snapshot.resetCredits > 0 ? (
          <button type="button" className="reset-credit-button" onClick={() => setShowCreditTip((value) => !value)} aria-expanded={showCreditTip} aria-label={t.view}>{t.view}</button>
        ) : null}
      </div>
      {showCreditTip ? (
        <div className="reset-credit-tip" role="status">
          {creditExpirations.length > 0 ? creditExpirations.map((item) => <p key={item}>{item}</p>) : <p>{t.noCreditExpiration}</p>}
        </div>
      ) : null}
    </div>
  );

  return (
    <main
      className={`expanded-card-surface quota-card quota-card--${snapshot.status} quota-card--${tier}`}
      style={cardStyle}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => { if (!settingsOpen) onHover(false); }}
      onMouseDown={(event) => { if (event.button === 0) void onDrag(); }}
    >
      <div
        className="quota-card-content"
        inert={settingsOpen ? true : undefined}
        aria-hidden={settingsOpen || undefined}
      >
        <span className="sr-only" aria-live="polite">{available && primary !== null ? primaryAria : message}</span>
        {notice ? <p className="operation-notice" role="status">{notice}</p> : null}
        <CardChrome
          title={t.quotaTitle}
          subtitle={t.cardUpdatedAt(snapshot.plan, formatUpdatedAt(snapshot.updatedAt, language))}
          statusTone={indicatorState}
          statusLabel={indicatorLabel}
          view="quota"
          preferences={preferences}
          refreshing={refreshing}
          disabled={preferenceActionsDisabled}
          settingsOpen={settingsOpen}
          onRefresh={onRefresh}
          onSwitchView={onSwitchToStats}
          onLanguage={onLanguage}
          onAlwaysOnTop={onLock}
          onOpenSettings={onOpenSettings}
        />

        {available && primary !== null ? (
          <>
            <p className="primary-label">{primaryLabel}</p>
            <section className="primary-metric" aria-label={primaryAria}>
              <span>{primary}</span><small>%</small>
            </section>
            <div className="progress" role="progressbar" aria-label={primaryAria} aria-valuemin={0} aria-valuemax={100} aria-valuenow={primary}>
              <span style={{ width: `${primary}%` }} />
            </div>
            <p className="reset-time">{formatResetTime(snapshot.shortWindow?.resetsAt ?? null, new Date(), language)}</p>
            <footer className={`card-footer${snapshot.weeklyWindow ? "" : " card-footer--compact"}`}>
              {snapshot.weeklyWindow && secondaryLabel && weekly !== null ? (
                <div className="weekly-metric">
                  <p>{secondaryLabel}</p>
                  <strong>{weekly}<small>%</small></strong>
                  <span>{formatResetDate(snapshot.weeklyWindow.resetsAt, language)}</span>
                  {creditBlock}
                </div>
              ) : creditBlock}
              <ProviderMark />
            </footer>
          </>
        ) : (
          <section className="error-state" aria-live="polite">
            <div className="status-icon" aria-hidden="true"><StatusIcon status={snapshot.status} expired={staleExpired} /></div>
            <strong>{snapshot.status === "signed_out" ? t.signedInRequired : staleExpired ? t.staleExpired : t.temporarilyUnavailable}</strong>
            <p>{message ?? t.codexUsageUnavailable}</p>
          </section>
        )}
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

export const QuotaOrb = memo(function QuotaOrb({ snapshot, onDrag, onHover, language = "zh-CN" }: Pick<Props, "snapshot" | "onDrag" | "onHover"> & { language?: Language }) {
  const activeLanguage = normalizeLanguage(language);
  const t = copy[activeLanguage];
  const primary = snapshot.shortWindow ? clampPercent(snapshot.shortWindow.remainingPercent) : null;
  const primaryPeriod = classifyUsagePeriod(snapshot.shortWindow?.windowSeconds ?? 0);
  const tier = quotaTier(primary);
  const available = snapshot.status === "ok" && primary !== null;

  const handleMouseEnter = () => {
    onHover(true);
  };

  return (
    <main
      className={`quota-orb quota-card--${snapshot.status} quota-card--${tier}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => onHover(false)}
      onMouseDown={(event) => { if (event.button === 0) void onDrag(); }}
      aria-label={available ? t.usageAvailableLabel(primaryPeriod, primary) : localizedBackendMessage(snapshot.message, activeLanguage) ?? t.unavailableStatus}
    >
      <div className="aurora" aria-hidden="true" />
      {available ? (
        <section className="orb-metric">
          <span>{primary}</span>
          <small>%</small>
        </section>
      ) : (
        <section className="orb-unavailable">
          <StatusIcon status={snapshot.status} />
        </section>
      )}
    </main>
  );
});
