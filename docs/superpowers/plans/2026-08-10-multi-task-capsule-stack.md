# Multi-task Capsule Stack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将任务提醒升级为最多三层的宠物式胶囊堆叠，支持 Hover、点击和键盘展开，并在所有测试通过后发布 `v0.1.7-beta.1` 体验版。

**Architecture:** 主窗口继续持有任务 reducer 和到期计时，纯选择器输出有序可见任务与剩余数量；`task-toast` 独立窗口渲染堆叠并把展开状态回传主窗口。窗口控制器用纯几何函数计算动态尺寸、锚点和降级容量，保证悬浮球及锚点卡片不跳动。

**Tech Stack:** React 19、TypeScript 5.9、Vitest、Testing Library、Tauri 2、Rust。

## Global Constraints

- 默认收起时第一张胶囊完整显示，第二、第三张各露出约 10-12 逻辑像素。
- 展开时最多完整显示三张胶囊，其余显示 `+N`。
- 排序固定为：需要输入、任务失败、任务完成、正在工作；同状态按时间从新到旧。
- 展开由 Hover、点击或键盘焦点触发；离开整个区域约 160ms 后收起，点击不锁定。
- 仅当前 Hover 或聚焦的单张胶囊显示原有操作按钮。
- 胶囊靠近悬浮球的锚点卡片和悬浮球位置都不能因展开而移动。
- 动态窗口无法容纳三张时依次降级为两张、单张，并增加 `+N`。
- 保持透明窗口、无方形背景、无窗口外投影、无窗口级模糊层。
- 保持悬浮球四周向内且范围较窄的呼吸光。
- 保持 Codex 前台免打扰、首次通知设置和本机隐私边界不变。
- 体验版版本为 `v0.1.7-beta.1`，包含 macOS Universal unsigned 与 Windows unsigned 包。

---

## File Structure

- `src/lib/taskCompanion.ts`：任务状态 reducer、优先级排序和最多三条的队列选择器。
- `src/lib/taskCompanion.test.ts`：队列优先级、可见条目、`+N`、补位和注意事项计数。
- `src/lib/useTaskToastTimers.ts`：可见任务的独立剩余时间、展开暂停和恢复。
- `src/lib/useTaskToastTimers.test.tsx`：多任务计时与暂停恢复。
- `src/lib/useTaskCompanion.ts`：连接事件、队列、计时器、堆叠展开事件和窗口显示。
- `src/lib/useTaskCompanion.test.tsx`：主窗口多任务显示与操作路由。
- `src/lib/taskToastWindow.ts`：多任务载荷、动态尺寸、容量降级和窗口控制器。
- `src/lib/taskToastWindow.test.ts`：动态窗口尺寸、方向、锚点和降级。
- `src/lib/taskToastPlacement.ts`：带锚点卡片和上下增长方向的纯几何计算。
- `src/lib/taskToastPlacement.test.ts`：四向位置、侧边增长和工作区边界。
- `src/components/TaskToast.tsx`：可复用单卡文案和仅单卡 Hover/聚焦操作。
- `src/components/TaskToastStack.tsx`：堆叠容器、展开/收起热区、键盘和 `+N`。
- `src/components/TaskToast.test.tsx`：单卡操作保持测试。
- `src/components/TaskToastStack.test.tsx`：收起层、展开、移出延迟、按钮跟随和可访问性。
- `src/TaskToastApp.tsx`：按单次显示载荷渲染通知设置或任务堆叠。
- `src/TaskToastApp.test.tsx`：窗口事件和线程级操作转发。
- `src/styles.css`：堆叠、层级、动画、共享热区和减少动态效果样式。
- `src/components/TaskCompanionPlayground.tsx`：开发页多任务模拟入口。
- `src/components/TaskCompanionPlayground.test.tsx`：开发模拟与正式组件一致性。
- `src-tauri/tauri.conf.json`：放开 `task-toast` 动态最大高度。
- `src-tauri/src/config_contract.rs`：动态窗口尺寸配置契约。
- `package.json`、`package-lock.json`、`src-tauri/Cargo.toml`：体验版版本号。
- `.github/workflows/release.yml`：复用现有双平台发布流程，仅在确有需要时校正预发布附件规则。

### Task 1: Multi-task queue selector

**Files:**
- Modify: `src/lib/taskCompanion.ts`
- Test: `src/lib/taskCompanion.test.ts`

**Interfaces:**
- Consumes: `TaskCompanionState`、`TaskCompanionEntry`、`nowMs`。
- Produces: `TaskCompanionDisplay.visible: TaskCompanionEntry[]`、`hiddenCount: number`、`ring`、`unresolvedCount`。

- [ ] **Step 1: Write failing selector tests**

```ts
const display = selectTaskCompanionDisplay(state, BASE_TIME + 10_000);
expect(display.visible.map((entry) => entry.event.threadId))
  .toEqual(["input", "failed", "complete"]);
expect(display.hiddenCount).toBe(1);
```

增加状态替换、忽略后补位、延后输入不进入可见队列、普通队列清理不移除等待输入和失败的断言。

- [ ] **Step 2: Run the focused test and verify failure**

Run: `npm test -- src/lib/taskCompanion.test.ts`

Expected: FAIL because `visible` and `hiddenCount` do not exist.

- [ ] **Step 3: Implement the selector**

```ts
export interface TaskCompanionDisplay {
  visible: TaskCompanionEntry[];
  hiddenCount: number;
  ring: TaskCompanionEntry | null;
  unresolvedCount: number;
}

const eligible = entries
  .filter((entry) => isToastEligible(entry, nowMs))
  .sort(newestFirst);
const visible = eligible.slice(0, 3);
return {
  visible,
  hiddenCount: Math.max(0, eligible.length - visible.length),
  ring,
  unresolvedCount,
};
```

- [ ] **Step 4: Run the selector tests**

Run: `npm test -- src/lib/taskCompanion.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the queue selector**

```bash
git add src/lib/taskCompanion.ts src/lib/taskCompanion.test.ts
git commit -m "feat: select multi-task capsule queue"
```

### Task 2: Independent visible-task timers

**Files:**
- Create: `src/lib/useTaskToastTimers.ts`
- Create: `src/lib/useTaskToastTimers.test.tsx`
- Modify: `src/lib/useTaskCompanion.ts`
- Test: `src/lib/useTaskCompanion.test.tsx`

**Interfaces:**
- Consumes: `entries: TaskCompanionEntry[]`、`paused: boolean`、`onExpire(threadId)`。
- Produces: `useTaskToastTimers({ entries, paused, onExpire })`，每个 `eventId` 只启动一次对应状态时长。

- [ ] **Step 1: Write failing timer tests**

```tsx
renderHook(({ paused }) => useTaskToastTimers({
  entries: [workingEntry, completedEntry],
  paused,
  onExpire,
}), { initialProps: { paused: false } });

act(() => vi.advanceTimersByTime(2_000));
expect(onExpire).toHaveBeenCalledWith("working-thread");
expect(onExpire).not.toHaveBeenCalledWith("completed-thread");
```

再覆盖暂停 1 秒、等待 5 秒不触发、恢复剩余 1 秒后触发，以及隐藏任务进入前三名时才开始计时。

- [ ] **Step 2: Run timer tests and verify failure**

Run: `npm test -- src/lib/useTaskToastTimers.test.tsx src/lib/useTaskCompanion.test.tsx`

Expected: FAIL because the hook is missing and the existing hook only times one task.

- [ ] **Step 3: Implement remaining-time tracking**

```ts
interface TimerRecord {
  remainingMs: number;
  startedAt: number | null;
  timeoutId: number | null;
}

export function useTaskToastTimers({ entries, paused, onExpire }: Options) {
  const records = useRef(new Map<string, TimerRecord>());
  // Create records only for visible eventIds, subtract elapsed time on cleanup,
  // and schedule the remaining duration only while paused is false.
}
```

`useTaskCompanion` 增加 `stackExpanded` 状态，收到 `{ type: "setStackExpanded", expanded }` 后暂停或恢复所有可见任务计时。

- [ ] **Step 4: Run hook tests**

Run: `npm test -- src/lib/useTaskToastTimers.test.tsx src/lib/useTaskCompanion.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit timer behavior**

```bash
git add src/lib/useTaskToastTimers.ts src/lib/useTaskToastTimers.test.tsx src/lib/useTaskCompanion.ts src/lib/useTaskCompanion.test.tsx
git commit -m "feat: pause multi-task toast timers"
```

### Task 3: Stack payload and dynamic placement

**Files:**
- Modify: `src/lib/taskToastWindow.ts`
- Modify: `src/lib/taskToastWindow.test.ts`
- Modify: `src/lib/taskToastPlacement.ts`
- Modify: `src/lib/taskToastPlacement.test.ts`
- Modify: `src/lib/bridge.ts`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src-tauri/src/config_contract.rs`

**Interfaces:**
- Consumes: ordered `entries`、`hiddenCount`、`expanded`、orb frame and work area.
- Produces: payload fields `entries`、`hiddenCount`、`expanded`、`growth: "up" | "down"` and `visibleCapacity`.

- [ ] **Step 1: Write failing geometry and controller tests**

```ts
await controller.show({
  entries: [inputEntry, failedEntry, completedEntry],
  hiddenCount: 1,
  expanded: true,
  language: "zh-CN",
  openAction: "app",
});

expect(fake.apply).toHaveBeenCalledWith(expect.objectContaining({
  logicalSize: { width: 260, height: 304 },
  payload: expect.objectContaining({ growth: "up", visibleCapacity: 3 }),
}));
```

分别断言 top 向上、bottom 向下、left/right 选择垂直剩余空间较大的一侧，以及不足时容量 3→2→1。

- [ ] **Step 2: Run geometry tests and verify failure**

Run: `npm test -- src/lib/taskToastPlacement.test.ts src/lib/taskToastWindow.test.ts`

Expected: FAIL because requests still contain one `entry` and use a fixed 260×96 window.

- [ ] **Step 3: Implement stack size helpers**

```ts
export const TASK_TOAST_CARD_SIZE = { width: 260, height: 96 };
export const TASK_TOAST_STACK_OFFSET = 11;
export const TASK_TOAST_EXPANDED_GAP = 8;

export function taskToastStackSize(count: number, expanded: boolean): Size {
  return {
    width: TASK_TOAST_CARD_SIZE.width,
    height: expanded
      ? count * TASK_TOAST_CARD_SIZE.height + Math.max(0, count - 1) * TASK_TOAST_EXPANDED_GAP
      : TASK_TOAST_CARD_SIZE.height + Math.max(0, count - 1) * TASK_TOAST_STACK_OFFSET,
  };
}
```

扩展纯几何计算，使锚点卡片在 `growth: "up"` 时位于窗口底端、在 `growth: "down"` 时位于窗口顶端；容量不足时把被裁掉的任务并入 `hiddenCount`。

- [ ] **Step 4: Update the native window bounds**

将 `task-toast` 的 `minHeight` 保持 `96`、`maxHeight` 调整为 `400`，宽度保持 `260`，并更新 Rust 配置契约断言。

- [ ] **Step 5: Run geometry and Rust contract tests**

Run: `npm test -- src/lib/taskToastPlacement.test.ts src/lib/taskToastWindow.test.ts`

Run: `cargo test --manifest-path src-tauri/Cargo.toml config_contract`

Expected: PASS.

- [ ] **Step 6: Commit the window contract**

```bash
git add src/lib/taskToastWindow.ts src/lib/taskToastWindow.test.ts src/lib/taskToastPlacement.ts src/lib/taskToastPlacement.test.ts src/lib/bridge.ts src-tauri/tauri.conf.json src-tauri/src/config_contract.rs
git commit -m "feat: resize task capsule stack window"
```

### Task 4: Pet-style stack component

**Files:**
- Create: `src/components/TaskToastStack.tsx`
- Create: `src/components/TaskToastStack.test.tsx`
- Modify: `src/components/TaskToast.tsx`
- Modify: `src/components/TaskToast.test.tsx`
- Modify: `src/TaskToastApp.tsx`
- Modify: `src/TaskToastApp.test.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: display payload from Task 3 and per-thread callbacks.
- Produces: `TaskToastStack` and `{ type: "setStackExpanded", expanded: boolean }` actions.

- [ ] **Step 1: Write failing interaction tests**

```tsx
render(<TaskToastStack {...props} entries={[inputEntry, failedEntry, completedEntry]} />);
expect(screen.getAllByRole("status")).toHaveLength(3);
expect(container.querySelector(".task-toast-stack")).toHaveAttribute("data-expanded", "false");

fireEvent.mouseEnter(container.querySelector(".task-toast-stack")!);
expect(onExpandedChange).toHaveBeenCalledWith(true);

fireEvent.mouseEnter(screen.getAllByRole("status")[1]);
expect(screen.getByRole("button", { name: "打开 Codex" })).toBeVisible();
```

增加 `+N`、点击展开、160ms 延迟收起、卡片间移动不收起、按钮点击不冒泡、Tab 展开、Escape 收起和减少动态效果样式断言。

- [ ] **Step 2: Run component tests and verify failure**

Run: `npm test -- src/components/TaskToast.test.tsx src/components/TaskToastStack.test.tsx src/TaskToastApp.test.tsx`

Expected: FAIL because `TaskToastStack` does not exist.

- [ ] **Step 3: Implement the stack container**

```tsx
export function TaskToastStack({ entries, expanded, growth, hiddenCount, onExpandedChange, ...actions }: Props) {
  const scheduleCollapse = () => {
    collapseTimer.current = window.setTimeout(() => onExpandedChange(false), 160);
  };
  return (
    <main
      className={`task-toast-stack task-toast-stack--${growth}`}
      data-expanded={expanded}
      onMouseEnter={() => onExpandedChange(true)}
      onMouseLeave={scheduleCollapse}
    >
      {entries.map((entry, index) => (
        <TaskToast key={entry.event.eventId} entry={entry} stackIndex={index} {...actionsFor(entry)} />
      ))}
      {hiddenCount > 0 ? <span className="task-toast-more">+{hiddenCount}</span> : null}
    </main>
  );
}
```

单卡继续自己管理 Hover/焦点并只在当前卡显示按钮。按钮的 `onMouseDown` 和 `onClick` 都阻止冒泡。

- [ ] **Step 4: Add stack layout styles**

收起态用绝对定位和 11px 层偏移，展开态用 8px 间隔；`growth` 控制 DOM 视觉方向，锚点卡片始终贴近悬浮球。所有卡片只保留内高光，堆叠根节点背景透明。

- [ ] **Step 5: Run interaction tests**

Run: `npm test -- src/components/TaskToast.test.tsx src/components/TaskToastStack.test.tsx src/TaskToastApp.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit the stack UI**

```bash
git add src/components/TaskToastStack.tsx src/components/TaskToastStack.test.tsx src/components/TaskToast.tsx src/components/TaskToast.test.tsx src/TaskToastApp.tsx src/TaskToastApp.test.tsx src/styles.css
git commit -m "feat: add pet-style task capsule stack"
```

### Task 5: Companion integration and playground

**Files:**
- Modify: `src/lib/useTaskCompanion.ts`
- Modify: `src/lib/useTaskCompanion.test.tsx`
- Modify: `src/components/TaskCompanionPlayground.tsx`
- Modify: `src/components/TaskCompanionPlayground.test.tsx`
- Modify: `src/App.tsx`
- Test: `src/App.test.tsx`

**Interfaces:**
- Consumes: queue display, timer hook, dynamic show request and stack-expanded action.
- Produces: production and development simulation paths using the same stack payload.

- [ ] **Step 1: Write failing integration tests**

```ts
act(() => {
  fake.emit(eventFor("working", "thread-working"));
  fake.emit(eventFor("completed", "thread-completed"));
  fake.emit(eventFor("failed", "thread-failed"));
  fake.emit(eventFor("needsInput", "thread-input"));
});

expect(fake.bridge.show).toHaveBeenLastCalledWith(expect.objectContaining({
  entries: expect.arrayContaining([
    expect.objectContaining({ event: expect.objectContaining({ threadId: "thread-input" }) }),
  ]),
  hiddenCount: 1,
}));
```

增加线程级打开、忽略、稍后提醒、前台免打扰、模拟任务绕过免打扰和收起状态回传断言。

- [ ] **Step 2: Run integration tests and verify failure**

Run: `npm test -- src/lib/useTaskCompanion.test.tsx src/components/TaskCompanionPlayground.test.tsx src/App.test.tsx`

Expected: FAIL until all paths use `entries`.

- [ ] **Step 3: Wire the production hook**

```ts
void bridge.show({
  entries: display.visible,
  hiddenCount: display.hiddenCount,
  expanded: stackExpanded,
  language,
  openAction: "app",
});
```

普通状态在 Codex 前台时逐项过滤；等待输入和失败仍显示。展开回传只影响计时和窗口形态，不改变任务排序。

- [ ] **Step 4: Update the playground**

开发页提供追加四种状态、清空队列和超过三条任务的模拟入口，渲染正式 `TaskToastStack`，不复制一套演示组件。

- [ ] **Step 5: Run integration tests**

Run: `npm test -- src/lib/useTaskCompanion.test.tsx src/components/TaskCompanionPlayground.test.tsx src/App.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit the complete integration**

```bash
git add src/lib/useTaskCompanion.ts src/lib/useTaskCompanion.test.tsx src/components/TaskCompanionPlayground.tsx src/components/TaskCompanionPlayground.test.tsx src/App.tsx src/App.test.tsx
git commit -m "feat: integrate multi-task companion stack"
```

### Task 6: Full verification and experience release

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock` only if Cargo updates the package metadata.
- Modify: `src-tauri/tauri.conf.json`
- Inspect: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: completed feature and existing release workflow.
- Produces: tested `v0.1.7-beta.1` source and GitHub Pre-release assets.

- [ ] **Step 1: Update version metadata**

Set npm, Tauri config and Cargo package versions to `0.1.7-beta.1` without altering dependency versions.

- [ ] **Step 2: Run focused and full frontend verification**

Run: `npm test -- src/lib/taskCompanion.test.ts src/lib/useTaskToastTimers.test.tsx src/lib/useTaskCompanion.test.tsx src/lib/taskToastPlacement.test.ts src/lib/taskToastWindow.test.ts src/components/TaskToast.test.tsx src/components/TaskToastStack.test.tsx src/TaskToastApp.test.tsx src/components/TaskCompanionPlayground.test.tsx`

Run: `npm test`

Run: `npm run build`

Run: `npm run brand:check`

Expected: all commands exit 0.

- [ ] **Step 3: Run Rust verification**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`

Expected: all tests pass.

- [ ] **Step 4: Build and inspect the local macOS package**

Run: `npm run tauri build -- --target universal-apple-darwin`

Expected: unsigned Universal macOS artifacts are generated and launchable on the development machine.

- [ ] **Step 5: Commit the release candidate**

```bash
git add package.json package-lock.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json
git commit -m "chore: prepare 0.1.7 beta experience build"
```

- [ ] **Step 6: Push and create the pre-release**

Push the tested commit, create tag `v0.1.7-beta.1`, and use the existing release workflow to build macOS Universal and Windows unsigned attachments. Mark the GitHub release as Pre-release only after both platform jobs and uploaded assets succeed.

- [ ] **Step 7: Verify downloadable assets**

Confirm the release page contains both platform packages, the notes explain first launch for unsigned packages, and the stable release remains unchanged.

