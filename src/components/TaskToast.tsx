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

  return (
    <main
      className={`task-toast task-toast--${entry.event.status} task-toast--${direction}`}
      role="status"
      aria-live={entry.event.status === "needsInput" || entry.event.status === "failed" ? "assertive" : "polite"}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <span className="task-toast-dot" aria-hidden="true" />
      <section className="task-toast-copy">
        <strong>{t.taskStatus[entry.event.status]}</strong>
        <p>{taskCompanionLabel(entry.event)}</p>
        {duration ? <small>{duration}</small> : null}
      </section>
      <nav className="task-toast-actions" aria-label={t.taskActions}>
        {openLabel ? (
          <button type="button" className="task-toast-primary" onClick={onOpen}>
            {openLabel}
          </button>
        ) : null}
        {secondaryAction ? (
          <button type="button" className="task-toast-secondary" onClick={secondaryAction.action}>
            {secondaryAction.label}
          </button>
        ) : null}
      </nav>
    </main>
  );
}
