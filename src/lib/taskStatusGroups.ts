import type { Language } from "../types";
import type {
  TaskCompanionEntry,
  TaskCompanionStatus,
} from "./taskCompanion";

export const TASK_STATUS_PRIORITY: TaskCompanionStatus[] = [
  "needsInput",
  "failed",
  "completed",
  "working",
];

export interface TaskStatusGroup {
  status: TaskCompanionStatus;
  entries: TaskCompanionEntry[];
}

const labels: Record<Language, Record<TaskCompanionStatus, string>> = {
  "zh-CN": {
    working: "正在工作",
    needsInput: "需要处理",
    completed: "任务已完成",
    failed: "执行失败",
  },
  en: {
    working: "Working",
    needsInput: "Needs input",
    completed: "Completed",
    failed: "Failed",
  },
};

function eventTime(entry: TaskCompanionEntry) {
  const value = Date.parse(entry.event.occurredAt);
  return Number.isFinite(value) ? value : 0;
}

export function groupTaskEntries(entries: TaskCompanionEntry[]): TaskStatusGroup[] {
  return TASK_STATUS_PRIORITY.flatMap((status) => {
    const matching = entries
      .filter((entry) => entry.event.status === status)
      .sort((left, right) => eventTime(right) - eventTime(left));
    return matching.length ? [{ status, entries: matching }] : [];
  });
}

export function taskStatusGroupLabel(
  status: TaskCompanionStatus,
  count: number,
  language: Language,
) {
  const label = labels[language][status];
  return count > 1 ? `${label} · ${count}` : label;
}
