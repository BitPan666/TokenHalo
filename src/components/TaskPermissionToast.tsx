import { copy, normalizeLanguage } from "../lib/i18n";
import type { ToastDirection } from "../lib/taskToastPlacement";
import type { Language } from "../types";

interface Props {
  direction: ToastDirection;
  language?: Language;
  onEnable: () => void;
  onDismiss: () => void;
}

export function TaskPermissionToast({
  direction,
  language = "zh-CN",
  onEnable,
  onDismiss,
}: Props) {
  const t = copy[normalizeLanguage(language)];

  return (
    <main
      className={`task-toast task-permission-toast task-toast--${direction}`}
      role="dialog"
      aria-labelledby="task-permission-title"
      onMouseDown={(event) => event.stopPropagation()}
    >
      <section className="task-toast-copy">
        <strong id="task-permission-title">{t.taskPermissionTitle}</strong>
        <p>{t.taskPermissionNote}</p>
      </section>
      <nav className="task-permission-actions" aria-label={t.taskPermissionActions}>
        <button type="button" className="task-toast-primary" onClick={onEnable}>
          {t.taskPermissionEnable}
        </button>
        <button type="button" className="task-toast-secondary" onClick={onDismiss}>
          {t.taskPermissionLater}
        </button>
      </nav>
    </main>
  );
}
