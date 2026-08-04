# Codex Task Companion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a four-state Codex task companion to TokenHalo, with an orb status ring, a focus-safe native sidecar capsule that chooses top/left/right/bottom from available space, an opt-in local Codex Hooks connection, and deterministic recovery behavior.

**Architecture:** Keep task priority and queue rules in a pure TypeScript reducer. The existing `widget` window owns the orb while a new `task-toast` window owns the capsule. Rust validates privacy-safe hook input, persists only allowlisted metadata, watches the local inbox, reconciles terminal state from session metadata, and emits normalized events to the frontend. The installed TokenHalo executable also supports a fast `--task-hook` mode so Codex hooks can write events without launching a second helper runtime.

**Tech Stack:** React 19, TypeScript 5.9, Vitest, Tauri 2, Rust, serde/serde_json, Tokio, CSS.

## Global Constraints

- Preserve the existing quota and Token-statistics behavior when no task event is active.
- Never stage, restore, or commit the user's existing `assets/icon.png` deletion.
- Do not add legacy product-name residue anywhere in the repository; run `npm run brand:check` before every feature commit.
- Do not persist prompt text, assistant text, tool input/output, diffs, credentials, raw errors, transcript contents, or absolute transcript paths.
- Never classify an interrupted or ambiguous terminal event as failed.
- Do not claim that a Codex hook is connected until a real health event has been consumed after the user trusts the hook.
- Do not push from this plan unless the user separately authorizes a push.

## File Map

### Create

- `src/lib/taskCompanion.ts` — domain types, reducer, priority, deduplication, queue, timers.
- `src/lib/taskCompanion.test.ts` — reducer and priority tests.
- `src/lib/taskToastPlacement.ts` — pure four-direction geometry.
- `src/lib/taskToastPlacement.test.ts` — placement and clamping tests.
- `src/lib/taskToastWindow.ts` — adapter-driven native toast placement/show/hide controller.
- `src/lib/taskToastWindow.test.ts` — controller tests with a fake window adapter.
- `src/lib/useTaskCompanion.ts` — desktop-event subscription, timers, actions, foreground policy.
- `src/lib/useTaskCompanion.test.tsx` — hook integration tests.
- `src/components/TaskStatusRing.tsx` — accessible orb-ring and attention badge.
- `src/components/TaskStatusRing.test.tsx` — visual-state contract tests.
- `src/components/TaskToast.tsx` — capsule UI and actions.
- `src/components/TaskToast.test.tsx` — state copy, action, and accessibility tests.
- `src/TaskToastApp.tsx` — root for the dedicated `task-toast` window.
- `src/TaskToastApp.test.tsx` — event rendering and hide behavior.
- `src/components/TaskCompanionPlayground.tsx` — deterministic developer simulator.
- `src-tauri/src/task_companion/mod.rs` — service, watcher startup, Tauri commands.
- `src-tauri/src/task_companion/models.rs` — allowlisted native event and connection models.
- `src-tauri/src/task_companion/hook.rs` — stdin parsing and atomic inbox writer.
- `src-tauri/src/task_companion/integration.rs` — owned `hooks.json` merge/install/remove logic.
- `src-tauri/src/task_companion/reconcile.rs` — metadata-only session reconciliation.
- `src-tauri/src/task_companion/foreground.rs` — platform-specific foreground detection.

### Modify

- `src/types.ts` — task preference and native bridge types.
- `src/lib/bridge.ts` — task commands/events and toast-window adapter.
- `src/components/QuotaCard.tsx` — compose the ring around the compact orb.
- `src/components/QuotaCard.test.tsx` — compact-orb task-state coverage.
- `src/components/AppearanceSheet.tsx` — connection health, enable/disable, and test notification.
- `src/components/AppearanceSheet.test.tsx` — settings interaction coverage.
- `src/App.tsx` — initialize task state and coordinate the two windows.
- `src/App.test.tsx` — compact/expanded suppression and restoration.
- `src/main.tsx` — route `?surface=task-toast` and `?surface=task-designer` roots.
- `src/lib/i18n.ts` — Chinese and English task-companion copy.
- `src/styles.css` — ring, capsule, connector, directional and reduced-motion styles.
- `src-tauri/src/main.rs` — early `--task-hook` execution path.
- `src-tauri/src/lib.rs` — service state, commands, setup, and event emission.
- `src-tauri/src/models.rs` — persisted enablement preference.
- `src-tauri/src/macos_overlay.rs` — apply overlay policy to both native windows.
- `src-tauri/Cargo.toml` — enable Tokio time support and platform foreground APIs if needed.
- `src-tauri/tauri.conf.json` — declare hidden `task-toast` window.
- `src-tauri/capabilities/default.json` — authorize both window labels and required window operations.
- `README.md` — document opt-in connection, trust step, privacy, and behavior.

---

### Task 1: Build the deterministic task-state core

**Files:**
- Create: `src/lib/taskCompanion.ts`
- Create: `src/lib/taskCompanion.test.ts`

- [ ] **Step 1: Write failing reducer tests**

Cover these exact behaviors:

```ts
it("prioritizes needs input over failed, completed, and working", () => {});
it("keeps the newest event inside the same priority", () => {});
it("ignores a duplicate event id", () => {});
it("does not let an older event roll a turn backward", () => {});
it("clears terminal state when a newer turn starts", () => {});
it("treats interrupted as neutral and clears the ring", () => {});
it("postpones needs input for ten minutes until a newer event arrives", () => {});
it("caps ordinary queue entries at five without evicting needs input or unread failures", () => {});
it("counts only unresolved attention entries for the badge", () => {});
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `npm test -- src/lib/taskCompanion.test.ts`

- [ ] **Step 3: Implement the typed reducer**

Export:

```ts
export type TaskCompanionStatus = "working" | "needsInput" | "completed" | "failed";
export type TaskCompanionEventStatus = TaskCompanionStatus | "interrupted";
export type TaskCompanionSource = "codexHook" | "sessionReconciliation" | "simulator";

export interface TaskCompanionEvent {
  schemaVersion: 1;
  eventId: string;
  threadId: string;
  turnId: string | null;
  status: TaskCompanionEventStatus;
  occurredAt: string;
  projectName: string | null;
  taskTitle: string | null;
  durationMs: number | null;
  source: TaskCompanionSource;
}
```

Implement `taskCompanionReducer`, `selectTaskCompanionDisplay`, `taskToastDurationMs`, and safe label fallbacks. Put `nowMs` into reducer actions so tests never depend on wall-clock time.

- [ ] **Step 4: Run focused tests and brand check**

Run: `npm test -- src/lib/taskCompanion.test.ts`

Run: `npm run brand:check`

- [ ] **Step 5: Commit**

```bash
git add src/lib/taskCompanion.ts src/lib/taskCompanion.test.ts
git commit -m "feat: add task companion state core"
```

### Task 2: Implement four-direction placement

**Files:**
- Create: `src/lib/taskToastPlacement.ts`
- Create: `src/lib/taskToastPlacement.test.ts`

- [ ] **Step 1: Write failing geometry tests**

Test top-first placement, left/right/bottom fallback, left-right-bottom tie order, greatest-visible-area fallback, work-area clamping, scale-independent logical geometry, and the invariant that the orb frame is never modified.

- [ ] **Step 2: Run focused test and confirm failure**

Run: `npm test -- src/lib/taskToastPlacement.test.ts`

- [ ] **Step 3: Implement candidate scoring**

Use `ToastDirection = "top" | "left" | "right" | "bottom"`, a 260 × 96 logical toast, and a 12 logical pixel gap. Return the chosen direction, clamped top-left position, and candidate frame. Fully fitting top always wins; otherwise choose greatest clearance with the approved deterministic tie order; if none fits, choose greatest visible area.

- [ ] **Step 4: Run tests and commit**

Run: `npm test -- src/lib/taskToastPlacement.test.ts`

Run: `npm run brand:check`

```bash
git add src/lib/taskToastPlacement.ts src/lib/taskToastPlacement.test.ts
git commit -m "feat: add adaptive task toast placement"
```

### Task 3: Build the ring, capsule, and simulator

**Files:**
- Create: `src/components/TaskStatusRing.tsx`
- Create: `src/components/TaskStatusRing.test.tsx`
- Create: `src/components/TaskToast.tsx`
- Create: `src/components/TaskToast.test.tsx`
- Create: `src/components/TaskCompanionPlayground.tsx`
- Modify: `src/components/QuotaCard.tsx`
- Modify: `src/components/QuotaCard.test.tsx`
- Modify: `src/lib/i18n.ts`
- Modify: `src/styles.css`

- [ ] **Step 1: Write failing component tests**

Assert explicit status text, project/title fallback, formatted duration, state-specific primary/secondary actions, `9+` badge cap, accessible orb label, failed-state persistence affordance, and no breathing animation under `prefers-reduced-motion`.

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `npm test -- src/components/TaskStatusRing.test.tsx src/components/TaskToast.test.tsx src/components/QuotaCard.test.tsx`

- [ ] **Step 3: Implement the shared presentation**

Render blue breathing working, amber steady needs-input, green completed, coral failed, and neutral interrupted styles. Add a connector whose edge follows `direction`. Do not make color the only state signal. The playground must exercise all five event outcomes, all four directions, queue counts, long labels, reduced motion, and both languages using the production components.

- [ ] **Step 4: Run focused tests, build, and commit**

Run: `npm test -- src/components/TaskStatusRing.test.tsx src/components/TaskToast.test.tsx src/components/QuotaCard.test.tsx`

Run: `npm run build`

Run: `npm run brand:check`

```bash
git add src/components/TaskStatusRing.tsx src/components/TaskStatusRing.test.tsx src/components/TaskToast.tsx src/components/TaskToast.test.tsx src/components/TaskCompanionPlayground.tsx src/components/QuotaCard.tsx src/components/QuotaCard.test.tsx src/lib/i18n.ts src/styles.css
git commit -m "feat: add task companion visuals"
```

### Task 4: Add the dedicated native toast window

**Files:**
- Create: `src/TaskToastApp.tsx`
- Create: `src/TaskToastApp.test.tsx`
- Create: `src/lib/taskToastWindow.ts`
- Create: `src/lib/taskToastWindow.test.ts`
- Modify: `src/main.tsx`
- Modify: `src/lib/bridge.ts`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src-tauri/capabilities/default.json`
- Modify: `src-tauri/src/macos_overlay.rs`

- [ ] **Step 1: Write failing window-controller tests**

Verify that show reads the orb physical frame and monitor work area, converts through scale factor, calls the pure placement planner, positions before showing, publishes the display payload, and hides without resizing or moving the orb. Verify recalculation after an orb-moved event.

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `npm test -- src/lib/taskToastWindow.test.ts src/TaskToastApp.test.tsx`

- [ ] **Step 3: Declare and route `task-toast`**

Add a hidden, transparent, decoration-free, non-resizable, 260 × 96 logical window at `index.html?surface=task-toast`, with `alwaysOnTop`, `skipTaskbar`, and all-workspaces behavior. Extend macOS panel configuration to both `widget` and `task-toast`. Grant permissions only to those two labels.

- [ ] **Step 4: Implement the adapter and toast root**

`TaskToastApp` listens for the normalized display payload and invokes callbacks for open, acknowledge, and postpone. `taskToastWindow.ts` owns physical/logical conversion and delegates geometry to `planTaskToastPlacement`.

- [ ] **Step 5: Run frontend tests, Rust tests, build, and commit**

Run: `npm test -- src/lib/taskToastWindow.test.ts src/TaskToastApp.test.tsx`

Run: `cargo test --manifest-path src-tauri/Cargo.toml`

Run: `npm run build`

Run: `npm run brand:check`

```bash
git add src/TaskToastApp.tsx src/TaskToastApp.test.tsx src/lib/taskToastWindow.ts src/lib/taskToastWindow.test.ts src/main.tsx src/lib/bridge.ts src-tauri/tauri.conf.json src-tauri/capabilities/default.json src-tauri/src/macos_overlay.rs
git commit -m "feat: add native task toast window"
```

### Task 5: Orchestrate timers, foreground policy, and compact/expanded behavior

**Files:**
- Create: `src/lib/useTaskCompanion.ts`
- Create: `src/lib/useTaskCompanion.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/lib/bridge.ts`
- Modify: `src/types.ts`

- [ ] **Step 1: Write failing orchestration tests**

Cover working for two seconds, completed for seven seconds, failed for twelve seconds while retaining its ring, needs-input until advance or ten-minute postpone, card expansion hiding and restoring unresolved attention, foreground suppression for working/completed only, and a new attention event preempting lower-priority display.

- [ ] **Step 2: Run tests and confirm failure**

Run: `npm test -- src/lib/useTaskCompanion.test.tsx src/App.test.tsx`

- [ ] **Step 3: Implement one source of frontend truth**

`useTaskCompanion` owns the reducer and timers, while `App` only supplies compact/expanded and foreground facts. It sends the selected payload to `task-toast`, hides it when appropriate, and passes ring/badge state to `QuotaOrb`. Every timer must clear on replacement and unmount.

- [ ] **Step 4: Run tests and commit**

Run: `npm test -- src/lib/useTaskCompanion.test.tsx src/App.test.tsx`

Run: `npm run build`

Run: `npm run brand:check`

```bash
git add src/lib/useTaskCompanion.ts src/lib/useTaskCompanion.test.tsx src/App.tsx src/App.test.tsx src/lib/bridge.ts src/types.ts
git commit -m "feat: orchestrate task companion notifications"
```

### Task 6: Add the privacy-safe hook ingestion path

**Files:**
- Create: `src-tauri/src/task_companion/mod.rs`
- Create: `src-tauri/src/task_companion/models.rs`
- Create: `src-tauri/src/task_companion/hook.rs`
- Modify: `src-tauri/src/main.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Write failing Rust tests**

Test valid `UserPromptSubmit`, `PermissionRequest`, `Stop`, and health inputs; missing ids; malformed JSON; event-id determinism; project-name extraction from `cwd`; atomic file creation; and an assertion that serialized inbox events do not contain `prompt`, `last_assistant_message`, `tool_input`, `transcript_path`, or the absolute `cwd`.

- [ ] **Step 2: Run focused Rust tests and confirm failure**

Run: `cargo test --manifest-path src-tauri/Cargo.toml task_companion::hook`

- [ ] **Step 3: Implement `--task-hook` fast mode**

Before starting Tauri, `main.rs` recognizes:

```text
TokenHalo --task-hook UserPromptSubmit --inbox <application-owned-directory>
TokenHalo --task-hook PermissionRequest --inbox <application-owned-directory>
TokenHalo --task-hook Stop --inbox <application-owned-directory>
TokenHalo --task-hook Health --inbox <application-owned-directory>
```

Read exactly one JSON object from stdin, deserialize through `serde_json::Value`, extract only ids/event/cwd-derived basename/time, atomically write one versioned JSON file, print the minimal valid `{}` required by `Stop`, and exit zero. Never launch the desktop app in this mode. `Stop` yields an unclassified terminal candidate until reconciliation proves completed, failed, or interrupted.

- [ ] **Step 4: Run Rust tests and commit**

Run: `cargo test --manifest-path src-tauri/Cargo.toml task_companion::hook`

Run: `npm run brand:check`

```bash
git add src-tauri/src/task_companion/mod.rs src-tauri/src/task_companion/models.rs src-tauri/src/task_companion/hook.rs src-tauri/src/main.rs src-tauri/src/lib.rs src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "feat: ingest Codex task hook events"
```

### Task 7: Install and remove owned Codex Hooks safely

**Files:**
- Create: `src-tauri/src/task_companion/integration.rs`
- Modify: `src-tauri/src/task_companion/mod.rs`
- Modify: `src-tauri/src/task_companion/models.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/lib/bridge.ts`
- Modify: `src/types.ts`

- [ ] **Step 1: Write failing config-merge tests**

Use temporary directories to verify: empty config creation, preservation of unrelated top-level fields and hooks, idempotent reconnect, ownership markers, atomic backup, removal of only owned handlers, refusal when ownership cannot be proven, paths containing spaces, separate Windows command override, and states `disconnected`, `needsTrust`, `connected`, `degraded`.

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `cargo test --manifest-path src-tauri/Cargo.toml task_companion::integration`

- [ ] **Step 3: Implement official `hooks.json` structure**

Merge into `~/.codex/hooks.json` using event → matcher group → command-handler arrays, following the current official shape. Install owned handlers for `UserPromptSubmit`, `PermissionRequest`, and `Stop`; set short explicit timeouts and do not set `async`, because asynchronous command hooks are parsed but not supported. Include `commandWindows`. Back up and atomically replace only after re-parsing the generated JSON.

Reference: `https://learn.chatgpt.com/docs/hooks`

- [ ] **Step 4: Implement trust-aware health**

Write a health sentinel request but return `needsTrust` until the actual installed hook executes and the watcher consumes its health event. Surface `/hooks` instructions; never bypass hook trust.

- [ ] **Step 5: Run tests and commit**

Run: `cargo test --manifest-path src-tauri/Cargo.toml task_companion::integration`

Run: `npm run brand:check`

```bash
git add src-tauri/src/task_companion/integration.rs src-tauri/src/task_companion/mod.rs src-tauri/src/task_companion/models.rs src-tauri/src/lib.rs src/lib/bridge.ts src/types.ts
git commit -m "feat: manage Codex task hooks safely"
```

### Task 8: Watch the inbox and reconcile explicit outcomes

**Files:**
- Create: `src-tauri/src/task_companion/reconcile.rs`
- Modify: `src-tauri/src/task_companion/mod.rs`
- Modify: `src-tauri/src/task_companion/models.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Write failing service tests**

Test polling consumption, schema rejection, event emission, consumed-file cleanup, startup replay, stale working expiry, health acknowledgment, and terminal mapping for explicit completed/failed/interrupted records. Test that ambiguous or corrupt metadata emits idle/clear rather than completed or failed.

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `cargo test --manifest-path src-tauri/Cargo.toml task_companion`

- [ ] **Step 3: Implement a lightweight polling watcher**

Enable Tokio `time`, poll the application-owned inbox without a new watcher dependency, validate each file, emit `task-companion-event`, then remove the consumed file. Bound startup replay and file size. Never follow a transcript path supplied by the hook.

- [ ] **Step 4: Implement metadata-only reconciliation**

Locate Codex session metadata through the existing local Codex data-root discovery, read only bounded tail records, extract explicit turn status, and discard all content fields. Map `completed`, `failed`, and `interrupted` only from explicit typed status. Persist the normalized allowlist only.

- [ ] **Step 5: Run tests and commit**

Run: `cargo test --manifest-path src-tauri/Cargo.toml task_companion`

Run: `npm run brand:check`

```bash
git add src-tauri/src/task_companion/reconcile.rs src-tauri/src/task_companion/mod.rs src-tauri/src/task_companion/models.rs src-tauri/src/lib.rs src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "feat: reconcile Codex task outcomes"
```

### Task 9: Add connection settings, foreground detection, and open capability

**Files:**
- Create: `src-tauri/src/task_companion/foreground.rs`
- Modify: `src-tauri/src/task_companion/mod.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/models.rs`
- Modify: `src/components/AppearanceSheet.tsx`
- Modify: `src/components/AppearanceSheet.test.tsx`
- Modify: `src/lib/bridge.ts`
- Modify: `src/lib/i18n.ts`
- Modify: `src/types.ts`

- [ ] **Step 1: Write failing native and UI tests**

Test connection-state rendering, connect/disconnect confirmation, `/hooks` trust guidance, degraded state, test notification, enablement persistence, foreground result fallback, and exact action result values `openedTask`, `openedApp`, `unavailable`.

- [ ] **Step 2: Run tests and confirm failure**

Run: `npm test -- src/components/AppearanceSheet.test.tsx`

Run: `cargo test --manifest-path src-tauri/Cargo.toml task_companion`

- [ ] **Step 3: Implement settings and platform capability bridges**

Add `Connect to Codex`, `Disconnect`, status, trust instructions, and one production `Send test notification` action. Detect the frontmost process on macOS and Windows; return detection unavailable on error so attention notifications remain visible. Capability-test task deep links; if no verified route exists, bring Codex forward and report `openedApp`; otherwise report `openedTask`; never mislabel the fallback.

- [ ] **Step 4: Run tests and commit**

Run: `npm test -- src/components/AppearanceSheet.test.tsx`

Run: `cargo test --manifest-path src-tauri/Cargo.toml`

Run: `npm run build`

Run: `npm run brand:check`

```bash
git add src-tauri/src/task_companion/foreground.rs src-tauri/src/task_companion/mod.rs src-tauri/src/lib.rs src-tauri/src/models.rs src/components/AppearanceSheet.tsx src/components/AppearanceSheet.test.tsx src/lib/bridge.ts src/lib/i18n.ts src/types.ts src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "feat: connect task companion to Codex"
```

### Task 10: Complete end-to-end verification and documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-08-04-codex-task-companion-design.md`

- [ ] **Step 1: Add integration coverage**

Add an app integration test that injects `working → needsInput → working → completed`, verifies toast priority/timers and the retained orb state, then repeats with failed and interrupted outcomes. Add a placement integration case for each screen edge.

- [ ] **Step 2: Document the shipped behavior**

Document enablement, `/hooks` trust, disconnect semantics, local metadata allowlist, simulator URL, four states, top-first adaptive sidecar placement, foreground suppression, and limitations of task-specific navigation.

- [ ] **Step 3: Run the complete verification matrix**

Run: `npm test`

Run: `cargo test --manifest-path src-tauri/Cargo.toml`

Run: `npm run build`

Run: `npm run brand:check`

Run: `git diff --check`

- [ ] **Step 4: Perform a manual desktop smoke test**

On macOS and Windows, verify:

1. The orb does not move when the capsule appears.
2. Top is chosen when it fits.
3. Left, right, and bottom are chosen at the corresponding screen edges.
4. The toast never steals keyboard focus.
5. Needs-input and failed remain visible when Codex is foreground.
6. Working and completed are suppressed when Codex is foreground.
7. Hover-expanded cards hide and then restore unresolved attention.
8. Disconnect preserves unrelated Codex Hooks configuration.

- [ ] **Step 5: Review scope and repository hygiene**

Confirm `git status --short` still shows the user's `assets/icon.png` deletion unstaged. Inspect every staged path before any commit. Confirm no raw task content appears in fixtures, snapshots, logs, or persisted examples.

- [ ] **Step 6: Commit documentation and final integration tests**

```bash
git add README.md docs/superpowers/specs/2026-08-04-codex-task-companion-design.md src/App.test.tsx
git commit -m "docs: document Codex task companion"
```

## Completion Criteria

- The compact orb communicates working, needs input, completed, and failed without replacing its existing quota role.
- The dedicated capsule attaches to the orb on top/left/right/bottom, defaults to top when it fits, stays inside the work area, and never moves the orb.
- Multi-task priority is deterministic and follows needs input → failed → completed → working.
- Interrupted and ambiguous terminal events never become failures.
- Hook installation is opt-in, trust-aware, idempotent, reversible, and preserves unrelated Codex configuration.
- Persisted events contain only the approved metadata allowlist.
- Frontend tests, Rust tests, production build, brand check, and diff check all pass.
- `assets/icon.png` remains an unstaged user-owned deletion.
