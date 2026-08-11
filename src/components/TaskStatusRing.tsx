import type { Language } from "../types";
import type { TaskCompanionStatus } from "../lib/taskCompanion";
import { copy, normalizeLanguage } from "../lib/i18n";

interface TaskStatusRingProps {
  status: TaskCompanionStatus;
  attentionCount: number;
  language?: Language;
  showAttentionBadge?: boolean;
}

export function TaskStatusRing({
  status,
  attentionCount,
  language = "zh-CN",
  showAttentionBadge = true,
}: TaskStatusRingProps) {
  const t = copy[normalizeLanguage(language)];
  const cappedCount = attentionCount > 9 ? "9+" : String(attentionCount);

  return (
    <div
      className={`task-status-ring task-status-ring--${status}`}
      role="status"
      aria-label={t.taskStatusLabel[status]}
    >
      <span className="task-status-inset-glow" aria-hidden="true" />
      {showAttentionBadge && attentionCount > 1 ? (
        <span
          className="task-status-badge"
          aria-label={t.taskAttentionCount(attentionCount)}
        >
          {cappedCount}
        </span>
      ) : null}
    </div>
  );
}
