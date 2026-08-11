import { useMemo, useRef, useState } from "react";
import type { ProviderSnapshot } from "../types";
import type {
  TaskCompanionEntry,
  TaskCompanionStatus,
} from "../lib/taskCompanion";
import { groupTaskEntries } from "../lib/taskStatusGroups";
import type { ToastDirection } from "../lib/taskToastPlacement";
import { useTaskToastTimers } from "../lib/useTaskToastTimers";
import { QuotaOrb } from "./QuotaCard";
import { TaskPermissionToast } from "./TaskPermissionToast";
import { TaskStatusGroupStack } from "./TaskStatusGroupStack";

type PreviewScene = "single" | "all" | "sameStatus" | "permission";

const previewSnapshot: ProviderSnapshot = {
  provider: "codex",
  displayName: "CODEX",
  plan: "PRO",
  shortWindow: { remainingPercent: 74, resetsAt: null, windowSeconds: 18_000 },
  weeklyWindow: { remainingPercent: 42, resetsAt: null, windowSeconds: 604_800 },
  resetCredits: 1,
  resetCreditExpiresAt: [],
  updatedAt: "2026-08-11T10:00:00.000Z",
  status: "ok",
  message: null,
};

const directions: Array<{ value: ToastDirection; label: string }> = [
  { value: "top", label: "上方" },
  { value: "bottom", label: "下方" },
  { value: "left", label: "左侧" },
  { value: "right", label: "右侧" },
];

function previewEntry(
  threadId: string,
  status: TaskCompanionStatus,
  taskTitle: string,
  minute: number,
): TaskCompanionEntry {
  return {
    event: {
      schemaVersion: 1,
      eventId: `${threadId}-${status}`,
      threadId,
      turnId: `${threadId}-turn`,
      status,
      occurredAt: `2026-08-11T10:${String(minute).padStart(2, "0")}:00.000Z`,
      projectName: "TokenHalo",
      taskTitle,
      durationMs: Math.max(1, minute) * 14_000,
      source: "simulator",
    },
    acknowledged: false,
    postponedUntil: null,
    toastExpired: false,
  };
}

function fourStatusEntries() {
  return [
    previewEntry("input-permission", "needsInput", "确认开发版通知权限", 19),
    previewEntry("input-settings", "needsInput", "审核任务提醒设置", 18),
    previewEntry("input-release", "needsInput", "选择测试版发布范围", 17),
    previewEntry("failed-package", "failed", "修复桌面打包失败", 16),
    previewEntry("failed-window", "failed", "恢复通知窗口连接", 15),
    previewEntry("completed-layout", "completed", "完成状态分组布局", 14),
    previewEntry("completed-tests", "completed", "补充胶囊交互测试", 13),
    previewEntry("working-preview", "working", "生成网页版交互", 12),
    previewEntry("working-polish", "working", "优化卡片视觉细节", 11),
  ];
}

function sameStatusEntries() {
  return [
    previewEntry("working-five", "working", "完善溢出滚动体验", 25),
    previewEntry("working-four", "working", "检查四张任务卡布局", 24),
    previewEntry("working-three", "working", "调整状态卡间距", 23),
    previewEntry("working-two", "working", "优化关闭按钮反馈", 22),
    previewEntry("working-one", "working", "整理任务名称文案", 21),
  ];
}

function entriesForScene(scene: PreviewScene) {
  if (scene === "single") {
    return [previewEntry("working-single", "working", "生成网页版交互", 12)];
  }
  if (scene === "sameStatus") return sameStatusEntries();
  if (scene === "permission") return [];
  return fourStatusEntries();
}

export function TaskCompanionPlayground() {
  const [scene, setScene] = useState<PreviewScene>("all");
  const [entries, setEntries] = useState<TaskCompanionEntry[]>(fourStatusEntries);
  const [direction, setDirection] = useState<ToastDirection>("top");
  const [reducedMotion, setReducedMotion] = useState(false);
  const [interactionActive, setInteractionActive] = useState(false);
  const [feedback, setFeedback] = useState("可悬停状态组并点击同状态卡片展开任务");
  const newTaskSequence = useRef(0);
  const groups = useMemo(() => groupTaskEntries(entries), [entries]);
  const completedEntries = useMemo(
    () => entries.filter((entry) => entry.event.status === "completed"),
    [entries],
  );
  const attentionCount = entries.filter((entry) => (
    entry.event.status === "needsInput" || entry.event.status === "failed"
  )).length;
  const ringStatus = groups[0]?.status ?? null;

  useTaskToastTimers({
    entries: completedEntries,
    paused: interactionActive,
    durationForEntry: () => 6_000,
    onExpire: (threadId) => {
      setEntries((current) => current.filter((entry) => entry.event.threadId !== threadId));
    },
  });

  const selectScene = (nextScene: PreviewScene) => {
    setScene(nextScene);
    setEntries(entriesForScene(nextScene));
    setInteractionActive(false);
    setFeedback(nextScene === "permission"
      ? "首次授权提醒预览"
      : "场景已重置，可直接体验交互");
  };

  return (
    <main className="task-playground task-playground--grouped">
      <section className="task-playground-stage" data-direction={direction}>
        <div className="task-playground-orb">
          <QuotaOrb
            snapshot={previewSnapshot}
            language="zh-CN"
            onDrag={() => undefined}
            onHover={() => undefined}
            taskStatus={ringStatus ? {
              status: ringStatus,
              attentionCount,
            } : null}
          />
        </div>
        <div
          className="task-playground-group-preview"
          data-direction={direction}
        >
          {scene === "permission" ? (
            <TaskPermissionToast
              direction={direction}
              language="zh-CN"
              onEnable={() => setFeedback("已模拟开启任务提醒")}
              onDismiss={() => setFeedback("已模拟暂不开启")}
            />
          ) : (
            <TaskStatusGroupStack
              groups={groups}
              direction={direction}
              language="zh-CN"
              reducedMotion={reducedMotion}
              onInteractionChange={setInteractionActive}
              onOpen={(threadId) => setFeedback(`已触发前往 Codex：${threadId}`)}
              onDismiss={(threadId) => {
                setEntries((current) => current.filter((entry) => entry.event.threadId !== threadId));
                setFeedback("已忽略当前任务，组内下一条自动补位");
              }}
              onPostpone={(threadId) => {
                setEntries((current) => current.filter((entry) => entry.event.threadId !== threadId));
                setFeedback("已模拟稍后提醒，当前任务暂时隐藏");
              }}
            />
          )}
        </div>
      </section>
      <aside className="task-playground-controls">
        <p>任务胶囊交互预览</p>
        <h1>状态分组通知</h1>
        <p className="task-playground-description">
          默认只显示最高优先级状态。悬停展开状态，点击同状态卡片查看任务。
        </p>

        <fieldset>
          <legend>模拟场景</legend>
          <button type="button" className={scene === "single" ? "is-active" : ""} onClick={() => selectScene("single")}>单一任务</button>
          <button type="button" className={scene === "all" ? "is-active" : ""} onClick={() => selectScene("all")}>四种状态</button>
          <button type="button" className={scene === "sameStatus" ? "is-active" : ""} onClick={() => selectScene("sameStatus")}>同状态 5 条</button>
          <button type="button" className={scene === "permission" ? "is-active" : ""} onClick={() => selectScene("permission")}>首次询问</button>
        </fieldset>

        <fieldset>
          <legend>胶囊位置</legend>
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
          <legend>交互选项</legend>
          <label className="task-playground-toggle">
            <input
              type="checkbox"
              checked={reducedMotion}
              onChange={(event) => setReducedMotion(event.target.checked)}
            />
            <span>减少动态效果</span>
          </label>
          <button
            type="button"
            onClick={() => {
              newTaskSequence.current += 1;
              const suffix = newTaskSequence.current;
              setEntries((current) => [
                ...current,
                previewEntry(
                  `working-new-${suffix}`,
                  "working",
                  `新增运行任务 ${suffix}`,
                  30 + suffix,
                ),
              ]);
              setFeedback("已加入一条新的运行任务");
            }}
          >
            加入新任务
          </button>
          <button type="button" onClick={() => selectScene("all")}>重置</button>
        </fieldset>

        <output className="task-playground-feedback" aria-live="polite">
          {feedback}
        </output>
      </aside>
    </main>
  );
}
