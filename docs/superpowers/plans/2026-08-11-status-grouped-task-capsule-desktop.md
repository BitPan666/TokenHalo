# Status-grouped Task Capsule Desktop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将已确认的四状态、同状态组内折叠胶囊从 `task-designer` 预览接入真实 `task-toast` 桌面窗口，并保持动态窗口不裁切、不抢焦点。

**Architecture:** 主窗口继续持有任务 reducer、计时器和窗口几何状态；通知窗口复用 `TaskStatusGroupStack` 渲染分组卡片，并把外层/组内展开状态回传主窗口。窗口控制器根据任务分组和当前布局计算 272px 宽的透明窗口尺寸，原子更新位置与大小后以不激活方式显示。

**Tech Stack:** React 19、TypeScript 5.9、Vitest、Testing Library、Tauri 2、Rust。

## Global Constraints

- 真实通知与 `task-designer` 必须复用 `TaskStatusGroupStack` 和 `groupTaskEntries`。
- 默认仅显示最高优先级状态；Hover 展开最多四种状态；点击同状态堆叠后显示该状态任务列表。
- 排序保持：需要输入、执行失败、任务完成、正在工作；同状态最新任务在最上方。
- 当前卡片 Hover/聚焦时显示操作；右上角叉执行忽略；需要处理状态保留稍后提醒。
- 透明窗口必须为关闭按钮预留上方和右侧 12px，不出现矩形背景或裁切。
- 窗口尺寸变化和显示不得激活应用或中断用户在其他应用中的输入。
- 不改变首次通知授权、隐私边界、任务状态定义和悬浮球位置。
- 不修改或提交工作区中与本计划无关的已有改动。

---

### Task 1: Group layout contract and desktop sizing

**Files:**
- Modify: `src/lib/taskCompanion.ts`
- Test: `src/lib/taskCompanion.test.ts`
- Modify: `src/lib/taskToastWindow.ts`
- Test: `src/lib/taskToastWindow.test.ts`
- Modify: `src-tauri/tauri.conf.json`
- Test: `src-tauri/src/config_contract.rs`

**Interfaces:**
- Produces: `TaskToastGroupLayout { outerExpanded: boolean; expandedStatus: TaskCompanionStatus | null }`。
- Produces: `taskStatusGroupStackSize(entries, layout)`，返回包含 12px 顶部操作安全区的 272px 宽逻辑尺寸。
- Produces: `TaskToastDisplayPayload.layout` 与 `TaskToastShowRequest.layout`。

- [ ] **Step 1: 写入失败测试**

在 `taskCompanion.test.ts` 断言选择器向真实通知返回全部可用队列，而不是只截取前三条；在 `taskToastWindow.test.ts` 分别断言默认、四状态展开和三条同状态组内展开的逻辑尺寸及锚点稳定；在 `config_contract.rs` 断言原生窗口允许 272px 宽、至少 560px 高。

- [ ] **Step 2: 运行失败测试**

Run: `npm test -- src/lib/taskCompanion.test.ts src/lib/taskToastWindow.test.ts`

Expected: FAIL，因为当前选择器只返回三条，窗口仍按旧的 260×96 单卡堆叠计算。

- [ ] **Step 3: 实现最小数据与几何逻辑**

使用 `groupTaskEntries(entries)` 计算四种状态；默认高度为首组卡片 84px、最多两层背板和 12px 顶部安全区；外层展开累加各状态摘要；组内展开最多显示四张 84px 卡片并让列表内部滚动。现有 `planTaskToastStackPlacement` 已支持任意尺寸，保持其实现不变，只将 `anchorSize` 替换为分组默认尺寸，并将原生窗口上限调整为 272×600。

- [ ] **Step 4: 运行聚焦测试**

Run: `npm test -- src/lib/taskCompanion.test.ts src/lib/taskToastWindow.test.ts && cargo test --manifest-path src-tauri/Cargo.toml config_contract`

Expected: PASS。

- [ ] **Step 5: 提交布局契约**

```bash
git add src/lib/taskCompanion.ts src/lib/taskCompanion.test.ts src/lib/taskToastWindow.ts src/lib/taskToastWindow.test.ts src-tauri/tauri.conf.json src-tauri/src/config_contract.rs
git commit -m "feat: size desktop grouped task capsules"
```

---

### Task 2: Reuse grouped interactions in the real toast surface

**Files:**
- Modify: `src/components/TaskStatusGroupStack.tsx`
- Test: `src/components/TaskStatusGroupStack.test.tsx`
- Modify: `src/TaskToastApp.tsx`
- Test: `src/TaskToastApp.test.tsx`
- Modify: `src/lib/useTaskCompanion.ts`
- Test: `src/lib/useTaskCompanion.test.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Produces: `TaskStatusGroupStack.onLayoutChange(layout)`。
- Consumes: `TaskToastDisplayPayload.entries`、`layout`、`growth`、`direction`。
- Emits: `{ type: "setGroupLayout", layout }`、现有任务级 `open`、`acknowledge`、`postpone`。

- [ ] **Step 1: 写入失败组件测试**

在 `TaskToastApp.test.tsx` 发送含四状态和同状态多任务的 payload，断言真实 surface 出现状态分组、Hover 后四组展开、组内点击可展开，并断言布局事件携带 `outerExpanded` 与 `expandedStatus`。在 `useTaskCompanion.test.tsx` 断言布局事件暂停计时并重新调用窗口显示。

- [ ] **Step 2: 运行失败测试**

Run: `npm test -- src/TaskToastApp.test.tsx src/components/TaskStatusGroupStack.test.tsx src/lib/useTaskCompanion.test.tsx`

Expected: FAIL，因为真实 surface 仍渲染 `TaskToastStack`，事件仍只有布尔 `setStackExpanded`。

- [ ] **Step 3: 实现真实 surface 接入**

让 `TaskStatusGroupStack` 在外层或组内状态改变时回传完整布局；`TaskToastApp` 使用 `groupTaskEntries(display.entries)` 渲染分组组件；`useTaskCompanion` 保存布局、以任意展开态暂停计时并带布局重新显示窗口。新增 `.task-toast-group-surface`，为原生窗口提供顶部 12px 安全区和 272px 总宽度，保持透明背景。

- [ ] **Step 4: 运行组件与集成测试**

Run: `npm test -- src/TaskToastApp.test.tsx src/components/TaskStatusGroupStack.test.tsx src/lib/useTaskCompanion.test.tsx`

Expected: PASS。

- [ ] **Step 5: 提交真实 surface**

```bash
git add src/components/TaskStatusGroupStack.tsx src/components/TaskStatusGroupStack.test.tsx src/TaskToastApp.tsx src/TaskToastApp.test.tsx src/lib/useTaskCompanion.ts src/lib/useTaskCompanion.test.tsx src/styles.css
git commit -m "feat: render grouped capsules in desktop notifications"
```

---

### Task 3: Atomic no-focus native window updates

**Files:**
- Modify: `src/lib/bridge.ts`
- Test: `src/lib/bridge.taskToastFrame.test.ts`
- Modify: `src-tauri/src/lib.rs`
- Create: `src-tauri/src/task_toast_frame.rs`

**Interfaces:**
- Consumes: `set_task_toast_frame { x, y, width, height }`。
- Produces: `show_task_toast_without_focus`，macOS 使用 panel `show()`，Windows 使用 `SWP_NOACTIVATE | SWP_SHOWWINDOW`。

- [ ] **Step 1: 审核并运行现有失败测试**

Run: `npm test -- src/lib/bridge.taskToastFrame.test.ts && cargo test --manifest-path src-tauri/Cargo.toml task_toast_frame`

Expected: 若现有工作区实现完整则 PASS；否则根据失败点补齐，不重写已存在的用户改动。

- [ ] **Step 2: 验证原子更新与不激活显示**

断言前端不再顺序调用 `setSize`、`setPosition`、`show`；Rust 在修改已显示窗口时一次更新 frame，首次显示不抢焦点；非法尺寸在触碰原生窗口前被拒绝。

- [ ] **Step 3: 提交窗口行为**

```bash
git add src/lib/bridge.ts src/lib/bridge.taskToastFrame.test.ts src-tauri/src/lib.rs src-tauri/src/task_toast_frame.rs
git commit -m "fix: update task toast without stealing focus"
```

---

### Task 4: Desktop verification and development build

**Files:**
- Modify only if verification exposes a defect scoped to Tasks 1-3.

- [ ] **Step 1: 运行前端与品牌检查**

Run: `npm run brand:check && npm test && npm run build`

Expected: 全部 PASS。

- [ ] **Step 2: 运行 Rust 测试**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`

Expected: 全部 PASS。

- [ ] **Step 3: 启动桌面开发版**

Run: `npm run tauri dev`

Expected: 桌面开发版启动；真实测试通知使用四状态分组样式，Hover/组内展开不裁切，显示和变更尺寸不抢走其他应用输入焦点。

- [ ] **Step 4: 记录验证结果**

若自动化或桌面验收发现问题，先增加失败测试再修复；不得通过扩大常驻透明窗口或恢复窗口级背景规避裁切。
