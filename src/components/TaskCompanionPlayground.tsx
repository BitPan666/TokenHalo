import { useMemo, useState } from "react";
import type { ProviderSnapshot, Language } from "../types";
import type { TaskCompanionEntry, TaskCompanionStatus } from "../lib/taskCompanion";
import type { ToastDirection } from "../lib/taskToastPlacement";
import { TASK_TOAST_GAP, TASK_TOAST_SIZE } from "../lib/taskToastWindow";
import { QuotaOrb } from "./QuotaCard";
import { TaskToast } from "./TaskToast";

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

function previewToastTransform(direction: ToastDirection) {
  const horizontalOffset = (previewOrbSize + TASK_TOAST_SIZE.width) / 2 + TASK_TOAST_GAP;
  const verticalOffset = (previewOrbSize + TASK_TOAST_SIZE.height) / 2 + TASK_TOAST_GAP;
  if (direction === "top") return `translate(0px, -${verticalOffset}px)`;
  if (direction === "bottom") return `translate(0px, ${verticalOffset}px)`;
  if (direction === "left") return `translate(-${horizontalOffset}px, 0px)`;
  return `translate(${horizontalOffset}px, 0px)`;
}

export function TaskCompanionPlayground() {
  const [status, setStatus] = useState<TaskCompanionStatus>("working");
  const [direction, setDirection] = useState<ToastDirection>("top");
  const [language, setLanguage] = useState<Language>("zh-CN");
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

  return (
    <main className="task-playground">
      <section className="task-playground-stage">
        <div className="task-playground-orb">
          <QuotaOrb
            snapshot={previewSnapshot}
            language={language}
            onDrag={() => undefined}
            onHover={() => undefined}
            taskStatus={{ status, attentionCount: 3 }}
          />
        </div>
        <div
          className="task-playground-toast"
          style={{ transform: previewToastTransform(direction) }}
        >
          <TaskToast
            entry={entry}
            direction={direction}
            language={language}
            openAction="app"
            onOpen={() => undefined}
            onAcknowledge={() => undefined}
            onPostpone={() => undefined}
          />
        </div>
      </section>
      <aside className="task-playground-controls">
        <p>TASK COMPANION SIMULATOR</p>
        <h1>Orb + sidecar capsule</h1>
        <fieldset>
          <legend>State</legend>
          {statuses.map((item) => (
            <button
              type="button"
              className={status === item.value ? "is-active" : ""}
              key={item.value}
              onClick={() => setStatus(item.value)}
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
