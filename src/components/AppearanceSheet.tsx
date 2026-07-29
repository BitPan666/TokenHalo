import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import packageInfo from "../../package.json";
import {
  checkForUpdates,
  openReleasePage,
  type UpdateCheckResult,
} from "../lib/bridge";
import { copy, normalizeLanguage } from "../lib/i18n";
import type { GlassStyle, WidgetPreferences } from "../types";

interface GlassValues {
  glassTransparency: number;
  glassBlurStrength: number;
  glassStyle: GlassStyle;
}

interface Props {
  preferences: WidgetPreferences;
  onPreview: (preferences: WidgetPreferences) => void;
  onSave: (preferences: WidgetPreferences) => Promise<void>;
  onClose: () => void;
  disabled?: boolean;
  onCheckForUpdates?: () => Promise<UpdateCheckResult>;
  onOpenReleasePage?: (releaseUrl: string) => Promise<void>;
}

interface ActiveGesture {
  pointerId: number | undefined;
  target: HTMLInputElement;
}

type UpdateStatus =
  | "idle"
  | "checking"
  | "current"
  | "available"
  | "error"
  | "openError";

const DEFAULT_GLASS: GlassValues = {
  glassTransparency: 40,
  glassBlurStrength: 40,
  glassStyle: "regular",
};

function glassValues(preferences: WidgetPreferences): GlassValues {
  return {
    glassTransparency: preferences.glassTransparency,
    glassBlurStrength: preferences.glassBlurStrength,
    glassStyle: preferences.glassStyle,
  };
}

function equalGlass(left: GlassValues, right: GlassValues) {
  return left.glassTransparency === right.glassTransparency
    && left.glassBlurStrength === right.glassBlurStrength
    && left.glassStyle === right.glassStyle;
}

function effectStrength(value: number): 20 | 40 | 60 {
  if (value < 30) return 20;
  if (value < 50) return 40;
  return 60;
}

export function AppearanceSheet({
  preferences,
  onPreview,
  onSave,
  onClose,
  disabled = false,
  onCheckForUpdates = checkForUpdates,
  onOpenReleasePage = openReleasePage,
}: Props) {
  const language = normalizeLanguage(preferences.language);
  const t = copy[language];
  const [draft, setDraft] = useState(() => glassValues(preferences));
  const [activeSection, setActiveSection] = useState<"appearance" | "about">(
    "appearance",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>("idle");
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(
    null,
  );
  const preferencesRef = useRef(preferences);
  const savedRef = useRef(glassValues(preferences));
  const draftRef = useRef(draft);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const baselineVersionRef = useRef(0);
  const sheetRef = useRef<HTMLElement>(null);
  const activeGestureRef = useRef<ActiveGesture | null>(null);
  const deferredTerminalRef = useRef(false);
  const disabledRef = useRef(disabled);
  const persistRef = useRef<(force?: boolean) => Promise<void>>(async () => {});
  const finishGestureRef = useRef<(pointerId?: number) => boolean>(() => false);
  preferencesRef.current = preferences;
  disabledRef.current = disabled;

  useEffect(() => {
    const next = glassValues(preferences);
    if (equalGlass(next, savedRef.current)) return;
    baselineVersionRef.current += 1;
    savedRef.current = next;
    const wasDirty = dirtyRef.current;
    const baselineMatchesDraft = equalGlass(next, draftRef.current);
    dirtyRef.current = wasDirty && !baselineMatchesDraft;
    if ((!wasDirty || baselineMatchesDraft) && !savingRef.current) {
      draftRef.current = next;
      setDraft(next);
      onPreview({ ...preferences, ...next });
    }
  }, [
    onPreview,
    preferences,
    preferences.glassBlurStrength,
    preferences.glassStyle,
    preferences.glassTransparency,
  ]);

  const preview = (next: GlassValues) => {
    draftRef.current = next;
    dirtyRef.current = !equalGlass(next, savedRef.current);
    setDraft(next);
    setError(false);
    onPreview({ ...preferencesRef.current, ...next });
  };

  const persist = async (force = false) => {
    if (disabled || savingRef.current) return;
    const nextGlass = draftRef.current;
    if (!force && equalGlass(nextGlass, savedRef.current)) return;

    const baselineVersion = baselineVersionRef.current;
    savingRef.current = true;
    setSaving(true);
    sheetRef.current?.focus();
    setError(false);
    try {
      await onSave({ ...preferencesRef.current, ...nextGlass });
      if (baselineVersionRef.current === baselineVersion) {
        savedRef.current = nextGlass;
      } else {
        const authoritative = savedRef.current;
        draftRef.current = authoritative;
        setDraft(authoritative);
        onPreview({ ...preferencesRef.current, ...authoritative });
      }
      dirtyRef.current = !equalGlass(draftRef.current, savedRef.current);
    } catch {
      const rollback = savedRef.current;
      draftRef.current = rollback;
      dirtyRef.current = false;
      setDraft(rollback);
      onPreview({ ...preferencesRef.current, ...rollback });
      setError(true);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  persistRef.current = persist;

  useEffect(() => {
    if (disabled || saving || !deferredTerminalRef.current) return;
    deferredTerminalRef.current = false;
    void persistRef.current();
  }, [disabled, saving]);

  const finishPointerGesture = (pointerId?: number) => {
    const active = activeGestureRef.current;
    if (!active) return false;
    if (
      pointerId !== undefined
      && active.pointerId !== undefined
      && pointerId !== active.pointerId
    ) return false;

    activeGestureRef.current = null;
    try {
      if (
        active.pointerId !== undefined
        && active.target.hasPointerCapture?.(active.pointerId)
      ) {
        active.target.releasePointerCapture(active.pointerId);
      }
    } catch {
      // Window-level terminal events still guarantee the save attempt.
    }
    if (disabledRef.current || savingRef.current) {
      deferredTerminalRef.current = true;
      return true;
    }
    void persist();
    return true;
  };
  finishGestureRef.current = finishPointerGesture;

  useEffect(() => {
    const finishPointer = (event: globalThis.PointerEvent) => {
      finishGestureRef.current(event.pointerId);
    };
    const finishBlur = () => {
      finishGestureRef.current();
    };
    window.addEventListener("pointerup", finishPointer);
    window.addEventListener("pointercancel", finishPointer);
    window.addEventListener("blur", finishBlur);
    return () => {
      window.removeEventListener("pointerup", finishPointer);
      window.removeEventListener("pointercancel", finishPointer);
      window.removeEventListener("blur", finishBlur);
      activeGestureRef.current = null;
      deferredTerminalRef.current = false;
    };
  }, []);

  const updateValue = (
    key: "glassTransparency" | "glassBlurStrength",
    value: number,
  ) => {
    preview({ ...draftRef.current, [key]: value });
  };

  const chooseValue = (
    next: Partial<Pick<GlassValues, "glassBlurStrength" | "glassStyle">>,
  ) => {
    preview({ ...draftRef.current, ...next });
    void persist(true);
  };

  const stopPointer = (event: PointerEvent<HTMLElement>) => {
    event.stopPropagation();
  };

  const stopKey = (event: KeyboardEvent<HTMLElement>) => {
    event.stopPropagation();
  };

  const controlsDisabled = disabled || saving;
  const updateStatusCopy = updateStatus === "checking"
    ? t.appearanceUpdateChecking
    : updateStatus === "current"
      ? t.appearanceUpToDate
      : updateStatus === "available" && updateResult
        ? t.appearanceUpdateAvailable(updateResult.latestVersion)
        : updateStatus === "error"
          ? t.appearanceUpdateFailed
          : updateStatus === "openError"
            ? t.appearanceUpdateOpenFailed
            : t.appearanceUpdateIdle;
  const updateNote = updateStatus === "current"
    ? t.appearanceUpdateCurrentNote
    : updateStatus === "available"
      ? t.appearanceUpdateNewNote
      : updateStatus === "error"
        ? t.appearanceUpdateFailedNote
        : updateStatus === "openError"
          ? t.appearanceUpdateOpenFailedNote
          : t.appearanceUpdateIdleNote;
  const updateIcon = updateStatus === "current"
    ? "✓"
    : updateStatus === "available"
      ? "↑"
      : updateStatus === "error" || updateStatus === "openError"
        ? "!"
        : updateStatus === "checking"
          ? "↻"
          : "–";
  const updateButtonCopy = updateStatus === "available"
    ? t.appearanceUpdateOpen
    : updateStatus === "error" || updateStatus === "openError"
      ? t.appearanceUpdateCheckAgain
      : updateStatus === "checking"
        ? t.appearanceCheckingUpdates
        : t.appearanceCheckUpdates;

  const performUpdateCheck = async () => {
    if (updateStatus === "checking") return;
    setUpdateStatus("checking");
    try {
      const result = await onCheckForUpdates();
      setUpdateResult(result);
      setUpdateStatus(result.updateAvailable ? "available" : "current");
    } catch {
      setUpdateResult(null);
      setUpdateStatus("error");
    }
  };

  const openUpdate = async () => {
    if (!updateResult) return;
    try {
      await onOpenReleasePage(updateResult.releaseUrl);
    } catch {
      setUpdateStatus("openError");
    }
  };

  return (
    <section
      ref={sheetRef}
      className="appearance-sheet"
      role="dialog"
      aria-modal="true"
      aria-labelledby="appearance-sheet-title"
      aria-busy={controlsDisabled}
      tabIndex={-1}
      onPointerDown={stopPointer}
      onMouseDown={(event) => event.stopPropagation()}
      onKeyDownCapture={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          if (controlsDisabled) {
            sheetRef.current?.focus();
          } else {
            onClose();
          }
          return;
        }
        if (event.key === "Tab") {
          if (controlsDisabled) {
            event.preventDefault();
            event.stopPropagation();
            sheetRef.current?.focus();
            return;
          }
          const focusable = Array.from(
            sheetRef.current?.querySelectorAll<HTMLElement>(
              "button:not(:disabled), input:not(:disabled)",
            ) ?? [],
          );
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (!first || !last) return;
          if (document.activeElement === sheetRef.current) {
            event.preventDefault();
            event.stopPropagation();
            (event.shiftKey ? last : first).focus();
            return;
          }
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }
      }}
    >
      <header className="appearance-sheet-header">
        <div>
          <h2 id="appearance-sheet-title">{t.appearanceTitle}</h2>
          <p>{t.appearanceSubtitle}</p>
        </div>
        <button
          type="button"
          className="appearance-sheet-close"
          aria-label={t.appearanceClose}
          onClick={onClose}
          disabled={controlsDisabled}
          autoFocus
        >
          ×
        </button>
      </header>

      <div
        className="appearance-tabs"
        role="tablist"
        aria-label={t.appearanceSections}
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeSection === "appearance"}
          aria-controls="appearance-controls-panel"
          id="appearance-controls-tab"
          disabled={controlsDisabled}
          onClick={() => setActiveSection("appearance")}
        >
          {t.appearanceAppearanceTab}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeSection === "about"}
          aria-controls="appearance-about-panel"
          id="appearance-about-tab"
          disabled={controlsDisabled}
          onClick={() => setActiveSection("about")}
        >
          {t.appearanceAboutTab}
        </button>
      </div>

      {activeSection === "appearance" ? (
        <div
          className="appearance-page appearance-page--controls"
          id="appearance-controls-panel"
          role="tabpanel"
          aria-labelledby="appearance-controls-tab"
        >
          <div className="appearance-control">
            <label htmlFor="glass-transparency">
              <span>{t.appearanceTransparency}</span>
              <output htmlFor="glass-transparency">{draft.glassTransparency}%</output>
            </label>
            <input
              id="glass-transparency"
              type="range"
              min="10"
              max="90"
              value={draft.glassTransparency}
              aria-label={t.appearanceTransparency}
              disabled={controlsDisabled}
              onChange={(event) => updateValue(
                "glassTransparency",
                Number(event.currentTarget.value),
              )}
              onPointerDown={(event) => {
                stopPointer(event);
                activeGestureRef.current = {
                  pointerId: event.pointerId,
                  target: event.currentTarget,
                };
                try {
                  event.currentTarget.setPointerCapture?.(event.pointerId);
                } catch {
                  // Window-level listeners are the fallback when capture is unavailable.
                }
              }}
              onPointerUp={(event) => {
                stopPointer(event);
                if (!finishPointerGesture(event.pointerId)) void persist();
              }}
              onPointerCancel={(event) => {
                stopPointer(event);
                finishPointerGesture(event.pointerId);
              }}
              onKeyDown={stopKey}
              onKeyUp={() => void persist()}
            />
          </div>

          <div className="appearance-control">
            <span className="appearance-control-label">{t.appearanceStyle}</span>
            <div className="appearance-segments" role="group" aria-label={t.appearanceStyle}>
              {([
                ["clear", t.appearanceStyleClear],
                ["regular", t.appearanceStyleRegular],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={draft.glassStyle === value}
                  disabled={controlsDisabled}
                  onClick={() => chooseValue({ glassStyle: value })}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="appearance-control">
            <span className="appearance-control-label">{t.appearanceEffect}</span>
            <div className="appearance-segments" role="group" aria-label={t.appearanceEffect}>
              {([
                [20, t.appearanceEffectWeak],
                [40, t.appearanceEffectMedium],
                [60, t.appearanceEffectStrong],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={effectStrength(draft.glassBlurStrength) === value}
                  disabled={controlsDisabled}
                  onClick={() => chooseValue({ glassBlurStrength: value })}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            className="appearance-reset"
            onClick={() => {
              preview(DEFAULT_GLASS);
              void persist(true);
            }}
            disabled={controlsDisabled}
          >
            {t.appearanceReset}
          </button>
        </div>
      ) : (
        <div
          className="appearance-page appearance-page--about"
          id="appearance-about-panel"
          role="tabpanel"
          aria-labelledby="appearance-about-tab"
        >
          <div className="appearance-data-note">
            <strong>{t.appearanceDataTitle}</strong>
            <p>{t.appearanceDataLocal}</p>
            <p>{t.appearanceDataAccuracy}</p>
          </div>

          <div className="appearance-version-card">
            <strong>{t.appearanceVersionTitle}</strong>
            <div className="appearance-version-row">
              <span>{t.appearanceCurrentVersion(packageInfo.version)}</span>
              <span
                className="appearance-version-status"
                data-status={updateStatus}
                role="status"
                aria-live="polite"
              >
                <span aria-hidden="true">{updateIcon}</span>
                {updateStatusCopy}
              </span>
              <p>{updateNote}</p>
            </div>
            <button
              type="button"
              data-action={updateStatus === "available" ? "download" : "check"}
              disabled={controlsDisabled || updateStatus === "checking"}
              onClick={() => {
                if (updateStatus === "available") {
                  void openUpdate();
                } else {
                  void performUpdateCheck();
                }
              }}
            >
              {updateButtonCopy}
            </button>
          </div>
        </div>
      )}

      {error ? (
        <p className="appearance-save-error" role="status" aria-live="polite">
          {t.appearanceSaveFailed}
        </p>
      ) : null}
    </section>
  );
}
