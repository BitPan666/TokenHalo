import { useState } from "react";
import type { Language } from "../types";
import {
  formatTaskDuration,
  taskCompanionLabel,
  type TaskCompanionEntry,
} from "../lib/taskCompanion";
import type { ToastDirection } from "../lib/taskToastPlacement";
import { copy, normalizeLanguage } from "../lib/i18n";

export type TaskOpenAction = "task" | "app" | "none";

interface TaskToastProps {
  entry: TaskCompanionEntry;
  direction: ToastDirection;
  language?: Language;
  openAction: TaskOpenAction;
  onOpen: () => void;
  onAcknowledge: () => void;
  onPostpone: () => void;
}

export function TaskToast({
  entry,
  direction,
  language = "zh-CN",
  openAction,
  onOpen,
  onAcknowledge,
  onPostpone,
}: TaskToastProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [hasFocus, setHasFocus] = useState(false);
  const t = copy[normalizeLanguage(language)];
  const duration = formatTaskDuration(entry.event.durationMs);
  const secondaryAction = entry.event.status === "needsInput"
    ? { label: t.taskLater, action: onPostpone }
    : entry.event.status === "completed" || entry.event.status === "failed"
      ? { label: t.taskDismiss, action: onAcknowledge }
      : null;
  const openLabel = openAction === "task"
    ? t.taskOpenTask
    : openAction === "app"
      ? t.taskOpenCodex
      : null;
  const hasActions = Boolean(openLabel || secondaryAction);
  const actionsVisible = hasActions && (isHovered || hasFocus);

  return (
    <main
      className={`task-toast task-toast--${entry.event.status} task-toast--${direction}`}
      role="status"
      tabIndex={hasActions ? 0 : undefined}
      aria-live={entry.event.status === "needsInput" || entry.event.status === "failed" ? "assertive" : "polite"}
      onMouseDown={(event) => event.stopPropagation()}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onFocus={() => setHasFocus(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setHasFocus(false);
      }}
    >
      <span className="task-toast-dot" aria-hidden="true" />
      <section className="task-toast-copy">
        <strong>{t.taskStatus[entry.event.status]}</strong>
        <p>{taskCompanionLabel(entry.event)}</p>
        {duration ? <small>{duration}</small> : null}
      </section>
      {actionsVisible ? (
        <nav className="task-toast-actions" aria-label={t.taskActions}>
          {openLabel ? (
            <button
              type="button"
              className="task-toast-primary"
              onClick={(event) => {
                event.stopPropagation();
                onOpen();
              }}
            >
              {openLabel}
            </button>
          ) : null}
          {secondaryAction ? (
            <button
              type="button"
              className="task-toast-secondary"
              onClick={(event) => {
                event.stopPropagation();
                secondaryAction.action();
              }}
            >
              {secondaryAction.label}
            </button>
          ) : null}
        </nav>
      ) : null}
    </main>
  );
}
