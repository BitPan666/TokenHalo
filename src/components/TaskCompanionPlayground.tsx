import { useMemo, useState } from "react";
import type { ProviderSnapshot, Language } from "../types";
import type { TaskCompanionEntry, TaskCompanionStatus } from "../lib/taskCompanion";
import type { ToastDirection } from "../lib/taskToastPlacement";
import {
  TASK_TOAST_GAP,
  TASK_TOAST_SIZE,
  taskToastStackSize,
} from "../lib/taskToastWindow";
import { QuotaOrb } from "./QuotaCard";
import { TaskPermissionToast } from "./TaskPermissionToast";
import { TaskToastStack } from "./TaskToastStack";

const previewSnapshot: ProviderSnapshot = {
  provider: "codex",
  displayName: "CODEX",
  plan: "PRO",
  shortWindow: { remainingPercent: 74, resetsAt: null, windowSeconds: 18_000 },
  weeklyWindow: { remainingPercent: 42, resetsAt: null, windowSeconds: 604_800 },
  resetCredits: 1,
  resetCreditExpiresAt: [],
  updatedAt: "2026-08-04T10:00:00.000Z",
  status: "ok",
  message: null,
};

const statuses: Array<{ value: TaskCompanionStatus; label: string }> = [
  { value: "working", label: "Working" },
  { value: "needsInput", label: "Needs input" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
];

const directions: Array<{ value: ToastDirection; label: string }> = [
  { value: "top", label: "Top" },
  { value: "left", label: "Left" },
  { value: "right", label: "Right" },
  { value: "bottom", label: "Bottom" },
];

const previewOrbSize = 100;

function previewToastTransform(direction: ToastDirection, toastSize = TASK_TOAST_SIZE) {
  const horizontalOffset = (previewOrbSize + toastSize.width) / 2 + TASK_TOAST_GAP;
  const verticalOffset = (previewOrbSize + toastSize.height) / 2 + TASK_TOAST_GAP;
  if (direction === "top") return `translate(0px, -${verticalOffset}px)`;
  if (direction === "bottom") return `translate(0px, ${verticalOffset}px)`;
  if (direction === "left") return `translate(-${horizontalOffset}px, 0px)`;
  return `translate(${horizontalOffset}px, 0px)`;
}

export function TaskCompanionPlayground() {
  const [status, setStatus] = useState<TaskCompanionStatus>("working");
  const [direction, setDirection] = useState<ToastDirection>("top");
  const [language, setLanguage] = useState<Language>("zh-CN");
  const [permissionPreview, setPermissionPreview] = useState(false);
  const [stackPreview, setStackPreview] = useState(false);
  const [stackExpanded, setStackExpanded] = useState(false);
  const entry = useMemo<TaskCompanionEntry>(() => ({
    event: {
      schemaVersion: 1,
      eventId: `preview-${status}`,
      threadId: "preview-thread",
      turnId: "preview-turn",
      status,
      occurredAt: "2026-08-04T10:00:00.000Z",
      projectName: "TokenHalo · Desktop companion",
      taskTitle: "Implement the adaptive task capsule",
      durationMs: 185_000,
      source: "simulator",
    },
    acknowledged: false,
    postponedUntil: null,
    toastExpired: false,
  }), [status]);
  const stackEntries = useMemo<TaskCompanionEntry[]>(() => (
    [
      ["input", "needsInput", "Review the requested permission"],
      ["failed", "failed", "Fix the desktop packaging failure"],
      ["completed", "completed", "Implement the capsule stack"],
    ] as const
  ).map(([threadId, itemStatus, taskTitle], index) => ({
    event: {
      ...entry.event,
      eventId: `preview-${threadId}`,
      threadId: `preview-${threadId}`,
      turnId: `preview-${threadId}-turn`,
      status: itemStatus,
      occurredAt: `2026-08-04T10:00:0${index}.000Z`,
      taskTitle,
    },
    acknowledged: false,
    postponedUntil: null,
    toastExpired: false,
  })), [entry.event]);
  const visibleEntries = stackPreview ? stackEntries : [entry];
  const toastSize = permissionPreview
    ? TASK_TOAST_SIZE
    : taskToastStackSize(visibleEntries.length, stackPreview && stackExpanded);
  const growth = direction === "bottom" ? "down" : "up";
  const ringStatus = stackPreview ? "needsInput" : status;

  return (
    <main className="task-playground">
      <section className="task-playground-stage">
        <div className="task-playground-orb">
          <QuotaOrb
            snapshot={previewSnapshot}
            language={language}
            onDrag={() => undefined}
            onHover={() => undefined}
            taskStatus={permissionPreview ? null : { status: ringStatus, attentionCount: 3 }}
          />
        </div>
        <div
          className="task-playground-toast"
          style={{
            width: `${toastSize.width}px`,
            height: `${toastSize.height}px`,
            transform: previewToastTransform(direction, toastSize),
          }}
        >
          {permissionPreview ? (
            <TaskPermissionToast
              direction={direction}
              language={language}
              onEnable={() => undefined}
              onDismiss={() => undefined}
            />
          ) : (
            <TaskToastStack
              entries={visibleEntries}
              hiddenCount={stackPreview ? 2 : 0}
              expanded={stackPreview && stackExpanded}
              growth={growth}
              direction={direction}
              language={language}
              openAction="app"
              onExpandedChange={setStackExpanded}
              onOpen={() => undefined}
              onAcknowledge={() => undefined}
              onPostpone={() => undefined}
            />
          )}
        </div>
      </section>
      <aside className="task-playground-controls">
        <p>TASK COMPANION SIMULATOR</p>
        <h1>Orb + sidecar capsule</h1>
        <fieldset>
          <legend>State</legend>
          <button
            type="button"
            className={permissionPreview ? "is-active" : ""}
            onClick={() => {
              setPermissionPreview(true);
              setStackPreview(false);
              setStackExpanded(false);
            }}
          >
            首次询问
          </button>
          <button
            type="button"
            className={stackPreview ? "is-active" : ""}
            onClick={() => {
              setPermissionPreview(false);
              setStackPreview(true);
              setStackExpanded(false);
            }}
          >
            多任务堆叠
          </button>
          {statuses.map((item) => (
            <button
              type="button"
              className={!permissionPreview && !stackPreview && status === item.value ? "is-active" : ""}
              key={item.value}
              onClick={() => {
                setPermissionPreview(false);
                setStackPreview(false);
                setStackExpanded(false);
                setStatus(item.value);
              }}
            >
              {item.label}
            </button>
          ))}
        </fieldset>
        <fieldset>
          <legend>Direction</legend>
          {directions.map((item) => (
            <button
              type="button"
              className={direction === item.value ? "is-active" : ""}
              key={item.value}
              onClick={() => setDirection(item.value)}
            >
              {item.label}
            </button>
          ))}
        </fieldset>
        <fieldset>
          <legend>Language</legend>
          <button type="button" className={language === "zh-CN" ? "is-active" : ""} onClick={() => setLanguage("zh-CN")}>中文</button>
          <button type="button" className={language === "en" ? "is-active" : ""} onClick={() => setLanguage("en")}>English</button>
        </fieldset>
      </aside>
    </main>
  );
}
