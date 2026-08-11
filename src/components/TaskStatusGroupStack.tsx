import { X } from "@phosphor-icons/react";
import {
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type MouseEvent,
} from "react";
import type { Language } from "../types";
import {
  formatTaskDuration,
  taskCompanionLabel,
  type TaskCompanionEntry,
  type TaskCompanionStatus,
} from "../lib/taskCompanion";
import {
  taskStatusGroupLabel,
  type TaskStatusGroup,
} from "../lib/taskStatusGroups";
import type { ToastDirection } from "../lib/taskToastPlacement";

interface TaskStatusGroupStackProps {
  groups: TaskStatusGroup[];
  direction: ToastDirection;
  language: Language;
  reducedMotion?: boolean;
  onOpen: (threadId: string) => void;
  onDismiss: (threadId: string) => void;
  onPostpone: (threadId: string) => void;
  onInteractionChange?: (active: boolean) => void;
}

interface GroupedTaskCardProps {
  entry: TaskCompanionEntry;
  status: TaskCompanionStatus;
  count: number;
  language: Language;
  expandable: boolean;
  compact: boolean;
  onExpand: () => void;
  onOpen: () => void;
  onDismiss: () => void;
  onPostpone: () => void;
}

const actionCopy = {
  "zh-CN": {
    open: "前往 Codex",
    later: "稍后提醒",
    dismiss: (title: string) => `忽略任务：${title}`,
    expand: (label: string, count: number) => `展开${label}的 ${count} 个任务`,
  },
  en: {
    open: "Go to Codex",
    later: "Remind me later",
    dismiss: (title: string) => `Dismiss task: ${title}`,
    expand: (label: string, count: number) => `Expand ${count} ${label} tasks`,
  },
};

function stopAction(event: MouseEvent<HTMLElement>) {
  event.stopPropagation();
}

function GroupedTaskCard({
  entry,
  status,
  count,
  language,
  expandable,
  compact,
  onExpand,
  onOpen,
  onDismiss,
  onPostpone,
}: GroupedTaskCardProps) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const title = taskCompanionLabel(entry.event);
  const statusLabel = taskStatusGroupLabel(status, count, language);
  const singleStatusLabel = taskStatusGroupLabel(status, 1, language);
  const duration = formatTaskDuration(entry.event.durationMs);
  const actionsVisible = !compact && (hovered || focused);
  const copy = actionCopy[language];

  return (
    <article
      className={`task-group-card task-group-card--${status}`}
      role="status"
      aria-label={`${singleStatusLabel}：${title}`}
      data-compact={compact}
      data-glass="extra-strong-blur"
      tabIndex={0}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event: FocusEvent<HTMLElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      {expandable ? (
        <button
          type="button"
          className="task-group-toggle"
          aria-label={copy.expand(singleStatusLabel, count)}
          onClick={(event) => {
            event.stopPropagation();
            onExpand();
          }}
        />
      ) : null}
      <span className="task-group-dot" aria-hidden="true" />
      <section className="task-group-copy">
        <strong>{statusLabel}</strong>
        <p>{title}</p>
        {duration ? <small>{duration}</small> : null}
      </section>
      {actionsVisible ? (
        <>
          <button
            type="button"
            className="task-group-close"
            data-placement="top-right"
            aria-label={copy.dismiss(title)}
            onMouseDown={stopAction}
            onClick={(event) => {
              event.stopPropagation();
              onDismiss();
            }}
          >
            <X size={13} weight="bold" aria-hidden="true" />
          </button>
          <nav className="task-group-actions" aria-label={language === "zh-CN" ? "任务操作" : "Task actions"}>
            <button
              type="button"
              className="task-group-primary"
              data-visual="solid-top-highlight"
              onMouseDown={stopAction}
              onClick={(event) => {
                event.stopPropagation();
                onOpen();
              }}
            >
              {copy.open}
            </button>
            {status === "needsInput" ? (
              <button
                type="button"
                className="task-group-secondary"
                onMouseDown={stopAction}
                onClick={(event) => {
                  event.stopPropagation();
                  onPostpone();
                }}
              >
                {copy.later}
              </button>
            ) : null}
          </nav>
        </>
      ) : null}
    </article>
  );
}

export function TaskStatusGroupStack({
  groups,
  direction,
  language,
  reducedMotion = false,
  onOpen,
  onDismiss,
  onPostpone,
  onInteractionChange,
}: TaskStatusGroupStackProps) {
  const rootRef = useRef<HTMLElement>(null);
  const collapseTimerRef = useRef<number | null>(null);
  const [outerExpanded, setOuterExpanded] = useState(false);
  const [expandedStatus, setExpandedStatus] = useState<TaskCompanionStatus | null>(null);
  const visibleGroups = outerExpanded ? groups.slice(0, 4) : groups.slice(0, 1);
  const taskCount = groups.reduce((total, group) => total + group.entries.length, 0);
  const groupCount = groups.length;

  const cancelCollapse = () => {
    if (collapseTimerRef.current === null) return;
    window.clearTimeout(collapseTimerRef.current);
    collapseTimerRef.current = null;
  };

  const expandOuter = () => {
    cancelCollapse();
    setOuterExpanded(true);
  };

  const closeAllLayers = () => {
    setExpandedStatus(null);
    setOuterExpanded(false);
  };

  const scheduleCollapse = () => {
    cancelCollapse();
    collapseTimerRef.current = window.setTimeout(() => {
      collapseTimerRef.current = null;
      closeAllLayers();
    }, 160);
  };

  useEffect(() => () => cancelCollapse(), []);

  useEffect(() => {
    if (expandedStatus && !groups.some((group) => group.status === expandedStatus)) {
      setExpandedStatus(null);
    }
  }, [expandedStatus, groups]);

  useEffect(() => {
    onInteractionChange?.(outerExpanded || expandedStatus !== null);
  }, [expandedStatus, onInteractionChange, outerExpanded]);

  if (!groups.length) return null;

  const ariaLabel = language === "zh-CN"
    ? `${groupCount} 种任务状态，${taskCount} 个任务`
    : `${groupCount} task statuses, ${taskCount} tasks`;

  return (
    <section
      ref={rootRef}
      className={`task-group-stack task-group-stack--${direction}`}
      data-outer-expanded={outerExpanded}
      data-inner-expanded={expandedStatus !== null}
      data-reduced-motion={reducedMotion}
      role="group"
      aria-label={ariaLabel}
      tabIndex={-1}
      onMouseEnter={expandOuter}
      onMouseLeave={scheduleCollapse}
      onFocusCapture={expandOuter}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) scheduleCollapse();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        cancelCollapse();
        if (expandedStatus !== null) {
          setExpandedStatus(null);
          return;
        }
        rootRef.current?.focus();
        setOuterExpanded(false);
      }}
    >
      {visibleGroups.map((group) => {
        const innerExpanded = expandedStatus === group.status;
        const topEntry = group.entries[0];
        const hiddenTaskCount = outerExpanded
          ? group.entries.length - 1
          : taskCount - 1;
        const backCount = Math.min(2, Math.max(0, hiddenTaskCount));
        return (
          <section
            className={`task-status-group task-status-group--${group.status}`}
            data-testid="task-status-group"
            data-inner-expanded={innerExpanded}
            key={group.status}
          >
            {innerExpanded ? (
              <section
                className="task-group-list"
                role="region"
                aria-label={`${taskStatusGroupLabel(group.status, 1, language)}任务`}
              >
                {group.entries.map((entry) => (
                  <GroupedTaskCard
                    key={entry.event.threadId}
                    entry={entry}
                    status={group.status}
                    count={1}
                    language={language}
                    expandable={false}
                    compact={false}
                    onExpand={() => undefined}
                    onOpen={() => onOpen(entry.event.threadId)}
                    onDismiss={() => onDismiss(entry.event.threadId)}
                    onPostpone={() => onPostpone(entry.event.threadId)}
                  />
                ))}
              </section>
            ) : (
              <div className="task-group-summary" data-back-count={backCount}>
                {Array.from({ length: backCount }, (_, index) => (
                  <span
                    className="task-group-back"
                    data-back-index={index + 1}
                    key={index}
                    aria-hidden="true"
                  />
                ))}
                <GroupedTaskCard
                  entry={topEntry}
                  status={group.status}
                  count={group.entries.length}
                  language={language}
                  expandable={group.entries.length > 1}
                  compact={expandedStatus !== null}
                  onExpand={() => {
                    expandOuter();
                    setExpandedStatus(group.status);
                  }}
                  onOpen={() => onOpen(topEntry.event.threadId)}
                  onDismiss={() => onDismiss(topEntry.event.threadId)}
                  onPostpone={() => onPostpone(topEntry.event.threadId)}
                />
              </div>
            )}
          </section>
        );
      })}
    </section>
  );
}
