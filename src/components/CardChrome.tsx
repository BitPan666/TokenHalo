import {
  ArrowClockwise,
  ChartBar,
  Gauge,
  GearSix,
  PushPin,
  PushPinSlash,
  Translate,
} from "@phosphor-icons/react";
import { useEffect, useRef } from "react";
import { copy, normalizeLanguage } from "../lib/i18n";
import type { WidgetPreferences } from "../types";

export type CardStatusTone = "ok" | "active" | "stale" | "error";

export interface CardChromeProps {
  title: string;
  subtitle: string;
  statusTone: CardStatusTone;
  statusLabel: string;
  view: "quota" | "tokenStats";
  preferences: WidgetPreferences;
  refreshing?: boolean;
  disabled?: boolean;
  settingsOpen?: boolean;
  onRefresh: () => void | Promise<void>;
  onSwitchView: () => void;
  onLanguage: () => void;
  onAlwaysOnTop: () => void;
  onOpenSettings: () => void;
}

export function CardChrome({
  title,
  subtitle,
  statusTone,
  statusLabel,
  view,
  preferences,
  refreshing = false,
  disabled = false,
  settingsOpen = false,
  onRefresh,
  onSwitchView,
  onLanguage,
  onAlwaysOnTop,
  onOpenSettings,
}: CardChromeProps) {
  const t = copy[normalizeLanguage(preferences.language)];
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const previousSettingsOpenRef = useRef(settingsOpen);
  const refreshLabel = view === "quota" ? t.refreshQuota : t.statsRefresh;
  const switchLabel = view === "quota"
    ? t.switchToStats
    : t.statsSwitchToQuota;
  const pinLabel = preferences.alwaysOnTop ? t.pinOff : t.pinOn;

  useEffect(() => {
    if (previousSettingsOpenRef.current && !settingsOpen) {
      settingsButtonRef.current?.focus();
    }
    previousSettingsOpenRef.current = settingsOpen;
  }, [settingsOpen]);

  return (
    <header className="card-chrome">
      <div className="card-chrome-copy">
        <p className="card-chrome-title">{title}</p>
        <p className="card-chrome-subtitle">{subtitle}</p>
      </div>
      <nav
        className="card-chrome-actions"
        aria-label={t.controls}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <span
          className={`usage-indicator usage-indicator--${statusTone}`}
          role="status"
          aria-label={statusLabel}
          title={statusLabel}
        >
          <i aria-hidden="true" />
        </span>
        <button
          type="button"
          aria-label={refreshLabel}
          title={refreshLabel}
          disabled={refreshing}
          onClick={() => void onRefresh()}
        >
          <ArrowClockwise />
        </button>
        <button
          type="button"
          aria-label={switchLabel}
          title={switchLabel}
          disabled={disabled}
          onClick={onSwitchView}
        >
          {view === "quota" ? <ChartBar /> : <Gauge />}
        </button>
        <button
          type="button"
          aria-label={t.switchLanguage}
          title={t.switchLanguage}
          disabled={disabled}
          onClick={onLanguage}
        >
          <Translate />
        </button>
        <button
          type="button"
          aria-label={pinLabel}
          title={pinLabel}
          disabled={disabled}
          onClick={onAlwaysOnTop}
        >
          {preferences.alwaysOnTop ? <PushPin /> : <PushPinSlash />}
        </button>
        <button
          ref={settingsButtonRef}
          type="button"
          aria-label={t.openSettings}
          title={t.openSettings}
          disabled={disabled}
          onClick={onOpenSettings}
        >
          <GearSix />
        </button>
      </nav>
    </header>
  );
}
