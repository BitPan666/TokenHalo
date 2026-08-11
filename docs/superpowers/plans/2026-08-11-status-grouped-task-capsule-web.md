# 状态分组任务胶囊网页版实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 `task-designer` 网页预览入口中实现“外层最多四种状态、内层同状态任务折叠”的可交互任务胶囊原型，不改变真实桌面通知行为。

**Architecture:** 新增纯函数状态分组模块，保持任务优先级和同组时间排序独立于 React。新增一套状态分组胶囊组件，由网页预览页消费模拟任务；原有桌面 `TaskToastStack` 和 Tauri 通知桥接暂不接入，待网页版确认后再迁移。

**Tech Stack:** React 19、TypeScript 5.9、Vitest、Testing Library、现有 CSS 设计系统、Phosphor Icons。

## Global Constraints

- 默认只完整显示最高优先级状态组，外层悬停最多展示四个现存状态组。
- 状态优先级固定为：需要处理、执行失败、任务完成、正在工作。
- 同状态任务按事件时间从新到旧排列；同一时间最多展开一个状态组。
- 同状态组内前四条直接展示，更多任务在固定高度区域内滚动。
- 右上角关闭按钮只关闭当前任务，不关闭整个状态组。
- 操作和关闭按钮仅在当前任务悬停或键盘聚焦时显示。
- 网页预览不连接真实 Codex 事件、不启动外部应用、不修改真实桌面通知窗口。
- 不修改或覆盖工作区中与本计划无关的现有未提交变更。

---

## 文件结构

- Create: `src/lib/taskStatusGroups.ts` — 状态分组、优先级和同组排序纯函数。
- Create: `src/lib/taskStatusGroups.test.ts` — 分组、排序、补位与标题数量测试。
- Create: `src/components/TaskStatusGroupStack.tsx` — 外层状态展开、内层任务展开、关闭和任务操作。
- Create: `src/components/TaskStatusGroupStack.test.tsx` — 指针、键盘、单组展开、关闭补位与按钮路由测试。
- Modify: `src/components/TaskCompanionPlayground.tsx` — 模拟场景、位置控制、完成倒计时和预览反馈。
- Modify: `src/components/TaskCompanionPlayground.test.tsx` — 网页预览端到端交互测试。
- Modify: `src/styles.css` — 添加独立的 `task-group-*` 样式，不重写真实桌面胶囊选择器。

---

### Task 1: 状态分组数据模型

**Files:**
- Create: `src/lib/taskStatusGroups.ts`
- Create: `src/lib/taskStatusGroups.test.ts`

**Interfaces:**
- Consumes: `TaskCompanionEntry`、`TaskCompanionStatus` from `src/lib/taskCompanion.ts`。
- Produces: `TaskStatusGroup`、`TASK_STATUS_PRIORITY`、`groupTaskEntries(entries)`、`taskStatusGroupLabel(status, count, language)`。

- [ ] **Step 1: 写入失败测试**

```ts
expect(groupTaskEntries(entries).map((group) => group.status)).toEqual([
  "needsInput", "failed", "completed", "working",
]);
expect(groupTaskEntries(entries)[0].entries.map((entry) => entry.event.threadId))
  .toEqual(["input-new", "input-old"]);
expect(taskStatusGroupLabel("needsInput", 3, "zh-CN")).toBe("需要处理 · 3");
expect(taskStatusGroupLabel("working", 1, "zh-CN")).toBe("正在工作");
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `npm test -- src/lib/taskStatusGroups.test.ts`

Expected: FAIL，因为 `taskStatusGroups.ts` 尚不存在。

- [ ] **Step 3: 实现最小分组逻辑**

```ts
export const TASK_STATUS_PRIORITY: TaskCompanionStatus[] = [
  "needsInput", "failed", "completed", "working",
];

export interface TaskStatusGroup {
  status: TaskCompanionStatus;
  entries: TaskCompanionEntry[];
}

export function groupTaskEntries(entries: TaskCompanionEntry[]): TaskStatusGroup[] {
  return TASK_STATUS_PRIORITY.flatMap((status) => {
    const matching = entries
      .filter((entry) => entry.event.status === status)
      .sort((left, right) => Date.parse(right.event.occurredAt) - Date.parse(left.event.occurredAt));
    return matching.length ? [{ status, entries: matching }] : [];
  });
}
```

- [ ] **Step 4: 运行分组测试**

Run: `npm test -- src/lib/taskStatusGroups.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交数据模型**

```bash
git add src/lib/taskStatusGroups.ts src/lib/taskStatusGroups.test.ts
git commit -m "feat: group task companion entries by status"
```

---

### Task 2: 两级状态胶囊组件

**Files:**
- Create: `src/components/TaskStatusGroupStack.tsx`
- Create: `src/components/TaskStatusGroupStack.test.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `TaskStatusGroup[]` from `groupTaskEntries`、`ToastDirection`、`Language`。
- Produces: `TaskStatusGroupStack`，任务级回调 `onOpen(threadId)`、`onDismiss(threadId)`、`onPostpone(threadId)`，交互占用回调 `onInteractionChange(active)`。

- [ ] **Step 1: 写入外层和组内失败测试**

```tsx
const stack = screen.getByRole("group", { name: "4 种任务状态，9 个任务" });
expect(stack).toHaveAttribute("data-outer-expanded", "false");
expect(screen.getByText("需要处理 · 3")).toBeVisible();

fireEvent.mouseEnter(stack);
expect(onOuterExpandedChange).toHaveBeenCalledWith(true);

fireEvent.click(screen.getByRole("button", { name: "展开需要处理的 3 个任务" }));
expect(screen.getByRole("region", { name: "需要处理任务" })).toBeInTheDocument();
```

- [ ] **Step 2: 写入关闭和操作失败测试**

```tsx
fireEvent.mouseEnter(screen.getByRole("status", { name: /任务 A/ }));
fireEvent.click(screen.getByRole("button", { name: "忽略任务：任务 A" }));
expect(onDismiss).toHaveBeenCalledWith("task-a");
expect(onOpen).not.toHaveBeenCalled();
```

- [ ] **Step 3: 运行组件测试并确认失败**

Run: `npm test -- src/components/TaskStatusGroupStack.test.tsx`

Expected: FAIL，因为组件尚不存在。

- [ ] **Step 4: 实现组件状态机**

```ts
const [outerExpanded, setOuterExpanded] = useState(false);
const [expandedStatus, setExpandedStatus] = useState<TaskCompanionStatus | null>(null);

function closeAllLayers() {
  setExpandedStatus(null);
  setOuterExpanded(false);
}
```

组件必须实现：共享悬停热区、160ms 离开延迟、一次只展开一个状态组、单任务组不可展开、`Escape` 逐层返回、按钮事件停止冒泡、右上角关闭当前任务。

- [ ] **Step 5: 添加独立视觉样式**

新增 `task-group-stack`、`task-group-card`、`task-group-backs`、`task-group-close`、`task-group-actions` 和 `task-group-list` 选择器。卡片宽 260px、高 96px；外层状态间距 8px；同状态背板露出 8px；组内最大高度为四张卡片加间距；不添加窗口级矩形阴影或外发光。

- [ ] **Step 6: 运行组件测试**

Run: `npm test -- src/components/TaskStatusGroupStack.test.tsx`

Expected: PASS。

- [ ] **Step 7: 提交两级组件**

```bash
git add src/components/TaskStatusGroupStack.tsx src/components/TaskStatusGroupStack.test.tsx src/styles.css
git commit -m "feat: add status-grouped task capsule interactions"
```

---

### Task 3: 网页预览场景

**Files:**
- Modify: `src/components/TaskCompanionPlayground.tsx`
- Modify: `src/components/TaskCompanionPlayground.test.tsx`

**Interfaces:**
- Consumes: `TaskStatusGroupStack` 和 `groupTaskEntries`。
- Produces: 现有 `?surface=task-designer` 入口中的交互预览与开发控制区。

- [ ] **Step 1: 将旧预览测试改为新场景失败测试**

```tsx
fireEvent.click(screen.getByRole("button", { name: "四种状态" }));
expect(screen.getByText("需要处理 · 3")).toBeInTheDocument();
expect(screen.queryByText("+2")).not.toBeInTheDocument();

fireEvent.mouseEnter(screen.getByRole("group", { name: /4 种任务状态/ }));
expect(screen.getAllByTestId("task-status-group")).toHaveLength(4);
```

- [ ] **Step 2: 运行预览测试并确认失败**

Run: `npm test -- src/components/TaskCompanionPlayground.test.tsx`

Expected: FAIL，因为旧预览仍渲染逐任务堆叠。

- [ ] **Step 3: 实现固定模拟场景**

提供“单一任务”“四种状态”“同状态 5 条”“重置”按钮；方向提供“上、下、左、右”；提供“减少动态效果”开关、“加入新任务”按钮和最近一次操作反馈。模拟任务名称必须为简短中文任务名，不包含对话正文或本机路径。

- [ ] **Step 4: 接入完成任务计时**

仅将 `completed` 条目传给 `useTaskToastTimers`。当外层悬停、键盘聚焦或状态组展开时传入 `paused: true`；计时结束后从预览状态移除对应任务。其他状态不使用自动移除计时。

- [ ] **Step 5: 运行预览测试**

Run: `npm test -- src/components/TaskCompanionPlayground.test.tsx src/components/TaskStatusGroupStack.test.tsx`

Expected: PASS。

- [ ] **Step 6: 提交网页预览**

```bash
git add src/components/TaskCompanionPlayground.tsx src/components/TaskCompanionPlayground.test.tsx
git commit -m "feat: add grouped task capsule web preview"
```

---

### Task 4: 完整验证与浏览器验收

**Files:**
- Modify only if verification exposes a scoped defect in files from Tasks 1-3.

**Interfaces:**
- Consumes: 完整网页版预览。
- Produces: 可在本地浏览器检查的 `task-designer` 页面和验证记录。

- [ ] **Step 1: 运行品牌字段检查**

Run: `npm run brand:check`

Expected: PASS，项目受限词检查无新增问题。

- [ ] **Step 2: 运行完整前端测试**

Run: `npm test`

Expected: 所有测试 PASS。

- [ ] **Step 3: 运行生产构建**

Run: `npm run build`

Expected: TypeScript 和 Vite 构建成功。

- [ ] **Step 4: 启动网页预览**

Run: `npm run dev -- --host 127.0.0.1`

Expected: Vite 输出本地端口；打开 `/?surface=task-designer`。

- [ ] **Step 5: 浏览器检查核心交互**

检查默认最高优先级单卡、外层四状态展开、同状态任务点击展开、右上角关闭补位、按钮仅当前卡显示、四个位置和减少动态效果。确认页面无裁切、无 `+N`、无矩形窗口背景。

- [ ] **Step 6: 提交仅由验证发现的修正**

```bash
git add src/lib/taskStatusGroups.ts src/lib/taskStatusGroups.test.ts src/components/TaskStatusGroupStack.tsx src/components/TaskStatusGroupStack.test.tsx src/components/TaskCompanionPlayground.tsx src/components/TaskCompanionPlayground.test.tsx src/styles.css
git commit -m "fix: polish grouped task capsule preview"
```

若验证未产生修正，不创建空提交。
