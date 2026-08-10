import { useEffect, useRef, type CSSProperties } from "react";
import type { Language } from "../types";
import type { TaskCompanionEntry } from "../lib/taskCompanion";
import type { TaskToastStackGrowth, ToastDirection } from "../lib/taskToastPlacement";
import { TaskToast, type TaskOpenAction } from "./TaskToast";

interface TaskToastStackProps {
  entries: TaskCompanionEntry[];
  hiddenCount: number;
  expanded: boolean;
  growth: TaskToastStackGrowth;
  direction: ToastDirection;
  language?: Language;
  openAction: TaskOpenAction;
  onExpandedChange: (expanded: boolean) => void;
  onOpen: (threadId: string) => void;
  onAcknowledge: (threadId: string) => void;
  onPostpone: (threadId: string) => void;
}

export function TaskToastStack({
  entries,
  hiddenCount,
  expanded,
  growth,
  direction,
  language = "zh-CN",
  openAction,
  onExpandedChange,
  onOpen,
  onAcknowledge,
  onPostpone,
}: TaskToastStackProps) {
  const rootRef = useRef<HTMLElement>(null);
  const collapseTimerRef = useRef<number | null>(null);

  const cancelCollapse = () => {
    if (collapseTimerRef.current === null) return;
    window.clearTimeout(collapseTimerRef.current);
    collapseTimerRef.current = null;
  };
  const expand = () => {
    cancelCollapse();
    if (!expanded) onExpandedChange(true);
  };
  const scheduleCollapse = () => {
    cancelCollapse();
    collapseTimerRef.current = window.setTimeout(() => {
      collapseTimerRef.current = null;
      onExpandedChange(false);
    }, 160);
  };

  useEffect(() => () => cancelCollapse(), []);

  const totalCount = entries.length + hiddenCount;
  const ariaLabel = language === "zh-CN"
    ? `${totalCount} 条任务提醒`
    : `${totalCount} task notifications`;

  return (
    <section
      ref={rootRef}
      className={`task-toast-stack task-toast-stack--${growth}`}
      data-expanded={expanded}
      role="group"
      aria-label={ariaLabel}
      tabIndex={-1}
      onClick={expand}
      onMouseEnter={expand}
      onMouseLeave={scheduleCollapse}
      onFocusCapture={expand}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) scheduleCollapse();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        cancelCollapse();
        rootRef.current?.focus();
        onExpandedChange(false);
      }}
    >
      {entries.map((entry, index) => (
        <div
          key={entry.event.eventId}
          className="task-toast-stack-item"
          data-stack-index={index}
          style={{
            "--task-stack-index": index,
            zIndex: entries.length - index,
          } as CSSProperties}
        >
          <TaskToast
            entry={entry}
            direction={direction}
            language={language}
            openAction={openAction}
            onOpen={() => onOpen(entry.event.threadId)}
            onAcknowledge={() => onAcknowledge(entry.event.threadId)}
            onPostpone={() => onPostpone(entry.event.threadId)}
          />
        </div>
      ))}
      {hiddenCount > 0 ? (
        <span className="task-toast-more" aria-label={language === "zh-CN" ? `另有 ${hiddenCount} 条` : `${hiddenCount} more`}>
          +{hiddenCount}
        </span>
      ) : null}
    </section>
  );
}
