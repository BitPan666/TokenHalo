# Codex Task Companion Design

**Date:** 2026-08-04
**Status:** Implemented baseline

## Purpose

TokenHalo currently presents Codex remaining usage and local Token statistics in
a compact desktop widget. This feature extends it into a lightweight work-status
companion without turning the widget into a second task manager.

The companion communicates four user-facing task states:

- working;
- needs input;
- completed;
- failed.

The compact orb remains the product anchor. A small notification capsule appears
next to it when a state change deserves attention. Real Codex events and a
deterministic simulator share the same state model so the interface can be built,
tested, and reviewed before real event integration is enabled.

## Goals

- Show the current Codex task state without requiring the Codex window to remain
  visible.
- Notify the user when a task requires attention or reaches a terminal state.
- Preserve the orb's current position while the capsule chooses a safe direction
  around it.
- Support concurrent tasks with deterministic priority, deduplication, and queue
  behavior.
- Keep real integration local, opt-in, reversible, and unable to block Codex.
- Preserve the existing quota and Token-statistics behavior when no task state is
  active.
- Keep the interaction and rendering shared across Windows and macOS.

## Non-goals

- Recreating the Codex task list, transcript, composer, approval controls, or
  task-management UI inside TokenHalo.
- Displaying or persisting prompts, assistant responses, code, tool arguments, or
  credentials.
- Starting Codex tasks from TokenHalo in this iteration.
- Guaranteeing direct navigation to a specific task until a stable Codex deep-link
  route has been verified on both supported platforms.
- Supporting remote or cloud-only Codex tasks that do not emit local lifecycle
  evidence.

## Delivery Sequence

### Phase 1: state experience and simulator

Build the typed state model, reducer, notification queue, four task-state visuals,
four-direction placement logic, second native window, and developer simulator.
The production settings experience includes a single test-notification action,
but not a general-purpose fake-state control.

### Phase 2: real Codex integration

Add the opt-in companion hook, the local event inbox, a Tauri watcher, foreground
suppression, task-opening capability detection, and connection health in settings.

### Phase 3: reconciliation and resilience

Add metadata-only session-tail reconciliation, startup recovery, stale-state
expiry, multi-task stress handling, and cross-platform device validation.

All three phases are part of the feature. The sequence separates visual/state
correctness from the lifecycle integration rather than treating the simulator as
the final product.

## User Experience

### Compact orb

When no task requires representation, the orb continues to show the existing
remaining-usage state. Task state temporarily adds a thin outer light ring:

| State | Ring | Motion | Persistence |
| --- | --- | --- | --- |
| Working | blue | slow breathing | while the selected task is active |
| Needs input | amber | steady | until the task advances or the user postpones it |
| Completed | green | steady confirmation | until the capsule dismisses |
| Failed | coral red | steady, never flashing | until the task is opened or acknowledged |

Reduced-motion mode removes breathing animation but retains color and accessible
status text. Color is never the only signal: the orb exposes an accessible label,
and the capsule includes a status dot plus explicit copy.

### Sidecar capsule

The capsule is approximately 260 × 96 logical pixels and visually attaches to the
orb with a 12-pixel gap. The orb does not move. The capsule contains:

- task status;
- project name, falling back to the task title and then `Codex task`;
- elapsed duration when known;
- a primary open action;
- a secondary dismiss or postpone action when applicable.

State-specific behavior:

- **Working:** show a two-second start capsule, then retain only the blue orb ring.
- **Needs input:** keep the capsule visible until the task advances or the user
  selects `Later`. `Later` hides it for ten minutes unless a newer attention event
  arrives for the same task.
- **Completed:** show for seven seconds, then restore the quota orb.
- **Failed:** show for twelve seconds. After dismissal, retain the failed ring until
  the task is opened or a newer turn starts.
- **Interrupted:** do not classify a user-initiated stop as failure. Show an optional
  neutral two-second `Task stopped` capsule, clear the task ring, and return to the
  quota orb.

Hovering the orb still opens the existing quota or statistics card. Opening an
expanded card dismisses working and completed capsules. Needs-input and failed
capsules hide while the card is open and reappear after collapse if they remain
unresolved.

### Foreground suppression

When Codex is the foreground application, TokenHalo suppresses working and
completed capsules to avoid duplicate feedback. Needs-input and failed capsules
remain eligible because they represent unresolved attention. If foreground-app
detection is unavailable, TokenHalo shows the notification rather than risking a
missed attention event.

### Opening Codex

The installed macOS application registers the `codex` URL scheme, but the stable
cross-platform route for opening an individual thread must be capability-tested.
The UI follows the actual capability:

- show `Open task` only when a verified thread deep link exists;
- otherwise show `Open Codex` and bring the application forward;
- hide the action if neither operation is available.

The bridge returns `openedTask`, `openedApp`, or `unavailable`; it never reports an
app-only launch as task-specific navigation.

## Placement and Native Windows

### Dedicated notification window

The existing `widget` window continues to own the orb and expanded cards. A new
`task-toast` Tauri window owns only the capsule. It is transparent, hidden at
startup, absent from the taskbar, and shown without stealing keyboard focus.

Using a second window keeps the orb stationary, avoids changing the existing
compact/quota/statistics resize controller, and prevents a large transparent
bounding rectangle from intercepting desktop clicks. On macOS it receives the
same all-Spaces and full-screen auxiliary configuration as the widget. On both
platforms its always-on-top behavior mirrors the user's TokenHalo preference.

### Direction selection

Placement is recalculated whenever the capsule appears, the orb finishes moving,
the active monitor changes, display scale changes, or the work area changes.

1. Read the orb's physical frame, scale factor, and current monitor work area.
2. Build top, left, right, and bottom candidate frames using a 12-logical-pixel
   gap.
3. Select top whenever its entire candidate frame fits.
4. Otherwise select the fully fitting candidate with the greatest clearance from
   the nearest work-area edge.
5. Break equal-clearance ties in the deterministic order left, right, bottom.
6. If no candidate fully fits, select the candidate with the greatest visible area
   and clamp it into the work area while preserving the gap when possible.
7. Never move the orb as part of notification placement.

The selected direction controls the capsule's entrance transform and the position
of its visual connector. Reduced-motion mode replaces directional motion with a
short opacity transition.

## State Model

```ts
type TaskCompanionStatus =
  | "working"
  | "needsInput"
  | "completed"
  | "failed";

interface TaskCompanionEvent {
  schemaVersion: 1;
  eventId: string;
  threadId: string;
  turnId: string | null;
  status: TaskCompanionStatus | "interrupted";
  occurredAt: string;
  projectName: string | null;
  taskTitle: string | null;
  durationMs: number | null;
  source: "codexHook" | "sessionReconciliation" | "simulator";
}
```

The persisted event schema contains no prompt, response, tool input, code diff,
absolute session path, authentication value, or raw error body. User-visible error
copy is selected from a local safe-message catalog rather than raw backend text.

The frontend state core is a pure reducer. It owns active tasks, the attention
queue, acknowledgement state, postpone deadlines, capsule timers, and the selected
orb state. Native code supplies validated events and window capabilities but does
not duplicate task-priority policy.

## State Transitions

- A turn-start or equivalent lifecycle event enters `working`.
- A waiting-on-approval or waiting-on-user-input event enters `needsInput`.
- Resolution of an input request returns the same turn to `working` unless a
  terminal event has already arrived.
- An explicit successful terminal outcome enters `completed`.
- An explicit failed terminal outcome or thread system error enters `failed`.
- An explicit user interruption clears working state without entering `failed`.
- A newer turn for a failed or completed thread clears the prior terminal ring and
  enters `working`.
- An out-of-order event older than the accepted event for the same thread and turn
  cannot roll the task backward.

If the terminal outcome cannot be classified from explicit local metadata,
TokenHalo returns the task to idle without inventing a completed or failed result.

## Multiple Tasks and Notification Queue

The selected user-facing priority is:

1. needs input;
2. unread failed;
3. unread completed;
4. working;
5. idle quota display.

Within a priority, the newest event wins. Other events remain queued. A task can
hold only one current state, and the tuple `(eventId, threadId, turnId, status)` is
idempotent. The visible queue is capped at five entries; overflow removes the
oldest completed entry first, then the oldest working entry. Needs-input and unread
failed entries are not silently evicted.

The orb may show a small numeric badge when more than one unresolved attention
entry exists. The badge is capped at `9+` and does not count ordinary working
tasks.

## Real Codex Event Integration

### Opt-in connection

Settings presents `Connect to Codex`. Enabling it:

1. resolves the installed TokenHalo executable used by the hook command;
2. verifies that the Codex hooks configuration can be parsed safely;
3. backs up the affected Codex configuration;
4. writes a uniquely marked, idempotent hook configuration atomically;
5. reports connected only after a trusted lifecycle hook actually executes and
   TokenHalo consumes its local health record.

Disconnect removes only the uniquely marked TokenHalo entries and helper. It does
not rewrite unrelated Codex settings. If the config changed externally, removal
parses the current file and refuses a destructive overwrite when ownership cannot
be proven.

### Hook helper and event inbox

The hook fast path is synchronous with a short timeout and must fail open: it exits successfully even
when TokenHalo is absent or its inbox is unavailable, so it cannot block a Codex
turn. It parses allowlisted lifecycle fields locally and discards all other hook
payload fields without logging them.

Validated events are written atomically as owner-readable files beneath the
TokenHalo application-data directory. This inbox is used instead of localhost HTTP
or a long-lived socket so events survive application restarts and do not require
firewall access. The helper performs no network calls.

The Tauri companion service watches the inbox, validates schema and size, dedupes
events, publishes `task-companion-event` to the frontend, and removes each consumed
file. Malformed, oversized, or unsupported-version files are discarded without
raw-content logging.

### Session reconciliation

Codex Desktop currently runs task app servers as independent stdio processes, so
TokenHalo does not attempt to attach to or replace them. A metadata-only session
tail provides recovery for missed events and lifecycle evidence not exposed by the
hook being used. The parser reads only event type, thread/turn identifiers, status,
timestamps, working directory basename, and safe title metadata. It never persists
raw records.

Reconciliation runs when a terminal candidate is consumed, including inbox replay
after startup. It scans only bounded tails of matching session files and stops at a
new-turn boundary. Ambiguous evidence clears to idle. The frontend's ordering rules
prevent older evidence from downgrading a newer accepted event.

## Simulator and Test Notification

The simulator uses the same `TaskCompanionEvent` interface and reducer as real
events. In development it supports all states, multiple threads, out-of-order
events, connection loss, and each placement direction. It is isolated under the
`simulator` source and cannot write Codex configuration or real event files.

Production settings expose only `Test notification`. This creates one local
completed-style preview clearly labeled as a test. It validates rendering and
native window placement without entering the real attention queue or changing
connection health.

## Failure Handling

- If the hook is not configured, TokenHalo continues its existing quota and
  statistics behavior.
- If installation fails, restore the backup and keep the integration disconnected.
- If the helper or watcher fails, show connection health in settings; do not show a
  task-failed capsule.
- If the notification window fails to show, retain the state in the queue and keep
  the orb's accessible status updated.
- If placement data is unavailable, place the capsule above the orb and clamp to
  the primary work area.
- If foreground detection fails, show eligible notifications normally.
- If the Codex open action fails, keep the notification visible and change the
  action to the verified lower-capability label.
- Event timestamps and timers use monotonic elapsed time after ingestion so system
  clock changes do not extend or prematurely dismiss a visible capsule.

## Testing

### Pure unit tests

- every allowed state transition and rejected out-of-order transition;
- user-input resolution, interruption, and newer-turn reset behavior;
- queue priority, deduplication, acknowledgement, postpone, cap, and overflow;
- foreground suppression and timer pause/resume behavior;
- top-first placement, clearance comparison, tie-breaking, clamping, scaling, and
  multi-monitor work areas;
- safe-copy selection and inaccessible deep-link capability fallback.

### Frontend component tests

- four visual states and accessible labels;
- state-specific actions and timeouts;
- reduced motion and increased contrast;
- multiple-attention badge;
- expanded-card interaction with persistent and nonpersistent capsules;
- production test notification remaining isolated from the real queue.

### Rust and integration tests

- hook configuration ownership, backup, atomic update, disconnect, and rollback;
- allowlist parsing and rejection of malformed, oversized, or unsupported events;
- atomic inbox delivery, bounded restart recovery, invalid-file cleanup, and deduplication;
- metadata-only reconciliation and stale working-state expiry;
- `task-toast` window contract: transparent, hidden initially, skip taskbar,
  nonactivating show, all-Spaces behavior on macOS, and preference-matched z-order;
- task-open capability reporting and safe fallback.

### Manual device matrix

- macOS and Windows notification placement on each screen edge;
- multiple monitors with different scale factors;
- ordinary desktop and full-screen application spaces;
- orb dragging while a persistent capsule is visible;
- Codex foreground suppression;
- app stopped during an event and restarted afterward;
- connect, update, and disconnect without damaging unrelated Codex settings;
- locked/click-through and always-on-top preference combinations.

## Acceptance Criteria

- The simulator can demonstrate all four states, each direction, multiple tasks,
  and recovery cases through the production state core.
- Real Codex work produces task-state changes without uploading or persisting task
  content.
- Needs-input and failed events cannot be silently displaced by lower-priority
  events.
- Completed capsules dismiss after seven seconds and the compact quota display
  returns.
- The orb stays fixed while the capsule selects top, left, right, or bottom within
  the active monitor work area.
- Opening expanded quota/statistics cards preserves unresolved critical task state.
- Codex integration can be connected and disconnected without altering unrelated
  configuration.
- Hook or TokenHalo failures never block or fail a Codex task.
- Existing frontend, Rust, build, brand-consistency, and cross-platform window
  contract tests remain green.
