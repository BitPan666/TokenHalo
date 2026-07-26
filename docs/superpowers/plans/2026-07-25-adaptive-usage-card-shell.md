# Adaptive Usage Card and Shared Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make TokenHalo classify Codex usage windows from returned durations, present weekly-only accounts accurately, and give the remaining-usage and local-statistics pages the same blue-glass header, icon actions, settings access, and localized copy.

**Architecture:** Rust parses every usable response window, deduplicates it, and selects primary/secondary display roles without assuming that `primary_window` means five hours. TypeScript classifies each selected duration into presentation semantics. A shared React `CardChrome` renders the title, subtitle, status indicator, and ordered action set while the two existing cards retain their page-specific content and appearance-sheet preview state. `App` remains the owner of persisted preferences, page switching, active-page refresh, language, always-on-top, and settings visibility.

**Tech Stack:** Tauri 2, Rust 2021, Serde JSON, React 19, TypeScript 5.9, Vitest, Testing Library, CSS, Phosphor Icons.

## Global Constraints

- Treat `window_seconds`, within a 60-second tolerance, as the presentation source of truth: `18000` is five hours and `604800` is one week.
- Parse direct keys and window arrays before assigning display roles; direct `primary_window` and `secondary_window` keys are compatibility hints, not semantic labels.
- Keep the serialized `shortWindow` and `weeklyWindow` fields for compatibility in this change, but redefine them internally as selected primary and optional secondary display windows.
- Never fabricate a remaining percentage, reset timestamp, period, or second window.
- Keep the expanded remaining-usage card at 320×320 and the local-statistics card at 400×400.
- Keep the collapsed orb visually unchanged; it may use the dynamically classified primary-window accessible label.
- Use the Token statistics blue glass surface and masked border for both expanded pages.
- Render controls in this exact order on both expanded pages: status dot, refresh, page switch, language, always-on-top, settings.
- Use `ArrowClockwise`, `ChartBar`/`Gauge`, `Translate`, `PushPin`/`PushPinSlash`, and `GearSix` from `@phosphor-icons/react`; do not render `EN`, `中`, or other text labels as action icons.
- Keep refresh available in unavailable and signed-out states.
- The same appearance/information sheet must open from either expanded page.
- Do not expose raw English backend messages in Chinese UI.
- Do not rename, push, or otherwise mutate the GitHub remote as part of this work.
- Use test-driven development and commit after every task.

---

## File Structure

### New files

- `src/lib/usagePeriod.ts` — duration classification and period metadata.
- `src/lib/usagePeriod.test.ts` — duration-boundary and dynamic-copy tests.
- `src/components/CardChrome.tsx` — shared expanded-card title, subtitle, status, and ordered action bar.
- `src/components/CardChrome.test.tsx` — icon order, callback, state, and accessibility tests.
- `src/components/QuotaCard.test.tsx` — weekly-only, dual-window, unavailable, settings, and localization tests.

### Modified files

- `src-tauri/src/codex.rs` — collect, deduplicate, classify, and select response windows; use product-neutral safe errors.
- `src/lib/i18n.ts` — dynamic period labels, shared control labels, shared titles, subtitles, and localized operation errors.
- `src/components/QuotaCard.tsx` — use adaptive period copy, omit absent secondary content, use `CardChrome`, and host the existing appearance sheet.
- `src/components/TokenStatsCard.tsx` — replace its private header with `CardChrome` while preserving chart/settings behavior.
- `src/App.tsx` — provide both cards with the same preference actions, plan context, status context, and localized operation notices.
- `src/components/DesignPlayground.tsx` — supply the shared callbacks and add weekly-only/shared-shell preview states.
- `src/styles.css` — shared blue glass surface, header/action styles, 320px fit rules, and retained page-specific layout.
- `src/App.test.tsx` — update dynamic labels and verify quota-page shared actions.
- `src/App.tokenStatsIntegration.test.tsx` — verify statistics-page language, pin, settings, refresh, and page-switch wiring.
- `src/components/TokenStatsCard.test.tsx` — adapt fixtures to `CardChrome` and retain statistics behavior coverage.
- `README.md` — describe adaptive account windows instead of guaranteed 5-hour plus weekly windows.
- `PRIVACY.md` — call the upstream endpoint the Codex usage service.
- `docs/PROJECT-SUMMARY.md` — describe adaptive current/weekly usage display.
- `docs/TEST-MATRIX.md` — add weekly-only and shared-shell manual cases.

---

### Task 1: Select Usage Windows by Duration in Rust

**Files:**
- Modify: `src-tauri/src/codex.rs`

**Interfaces:**
- Produces `collect_windows(rate_limit) -> Vec<UsageWindow>`.
- Produces `select_display_windows(windows) -> (Option<UsageWindow>, Option<UsageWindow>)`.
- Preserves the existing serialized `ProviderSnapshot.short_window` and `weekly_window` contract as display-primary and display-secondary fields.

- [ ] **Step 1: Add failing selection tests**

Replace the narrow `finds_window_by_duration_or_name_in_arrays` test with explicit response-shape tests:

```rust
#[test]
fn selects_weekly_primary_without_a_duplicate_secondary() {
    let rate_limit = serde_json::json!({
        "primary_window": {
            "remainingPercent": 64,
            "windowSeconds": 604800,
            "resetsAt": "2026-07-31T08:31:12Z"
        }
    });
    let (primary, secondary) = select_display_windows(collect_windows(&rate_limit));
    assert_eq!(primary.unwrap().window_seconds, 604_800);
    assert!(secondary.is_none());
}

#[test]
fn orders_five_hour_before_weekly_regardless_of_response_keys() {
    let rate_limit = serde_json::json!({
        "primary_window": {"remainingPercent": 41, "windowSeconds": 604800},
        "secondary_window": {"remainingPercent": 73, "windowSeconds": 18000}
    });
    let (primary, secondary) = select_display_windows(collect_windows(&rate_limit));
    assert_eq!(primary.unwrap().window_seconds, 18_000);
    assert_eq!(secondary.unwrap().window_seconds, 604_800);
}

#[test]
fn deduplicates_aliases_for_the_same_window() {
    let rate_limit = serde_json::json!({
        "primary_window": {
            "remainingPercent": 64,
            "windowSeconds": 604800,
            "resetsAt": "2026-07-31T08:31:12Z"
        },
        "windows": [{
            "name": "weekly",
            "remainingPercent": 64,
            "windowSeconds": 604800,
            "resetsAt": "2026-07-31T08:31:12Z"
        }]
    });
    assert_eq!(collect_windows(&rate_limit).len(), 1);
}

#[test]
fn preserves_custom_and_unknown_windows_in_stable_order() {
    let rate_limit = serde_json::json!({
        "windows": [
            {"remainingPercent": 71, "windowSeconds": 86400},
            {"remainingPercent": 52}
        ]
    });
    let (primary, secondary) = select_display_windows(collect_windows(&rate_limit));
    assert_eq!(primary.unwrap().window_seconds, 86_400);
    assert_eq!(secondary.unwrap().window_seconds, 0);
}
```

- [ ] **Step 2: Run the focused tests and verify failure**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml codex::tests -- --nocapture
```

Expected: FAIL because `collect_windows` and `select_display_windows` do not exist.

- [ ] **Step 3: Implement collection, deduplication, and selection**

Replace `find_window` with constants and helpers equivalent to:

```rust
const FIVE_HOURS_SECONDS: u64 = 18_000;
const ONE_WEEK_SECONDS: u64 = 604_800;
const WINDOW_TOLERANCE_SECONDS: u64 = 60;

fn matches_duration(window: &UsageWindow, expected: u64) -> bool {
    window.window_seconds > 0
        && window.window_seconds.abs_diff(expected) <= WINDOW_TOLERANCE_SECONDS
}

fn same_window(left: &UsageWindow, right: &UsageWindow) -> bool {
    left.window_seconds == right.window_seconds
        && left.resets_at == right.resets_at
}

fn push_unique(windows: &mut Vec<UsageWindow>, candidate: &Value) {
    let Some(window) = parse_window(Some(candidate)) else { return };
    if !windows.iter().any(|current| same_window(current, &window)) {
        windows.push(window);
    }
}
```

`collect_windows` must visit direct keys in stable order, then every supported array:

```rust
for key in [
    "primary_window", "primaryWindow", "short_window", "shortWindow",
    "five_hour_window", "fiveHourWindow", "primary",
    "secondary_window", "secondaryWindow", "weekly_window", "weeklyWindow",
    "week_window", "weekWindow", "weekly", "secondary",
] {
    if let Some(value) = rate_limit.get(key) {
        push_unique(&mut windows, value);
    }
}
for key in ["windows", "limit_windows", "limitWindows", "limits", "buckets"] {
    if let Some(items) = rate_limit.get(key).and_then(Value::as_array) {
        for item in items {
            push_unique(&mut windows, item);
        }
    }
}
```

`select_display_windows` must prefer five-hour, then weekly, then stable response order, removing the chosen values from secondary consideration:

```rust
fn select_display_windows(
    windows: Vec<UsageWindow>,
) -> (Option<UsageWindow>, Option<UsageWindow>) {
    let five_hour = windows.iter().position(|item| matches_duration(item, FIVE_HOURS_SECONDS));
    let weekly = windows.iter().position(|item| matches_duration(item, ONE_WEEK_SECONDS));
    let primary_index = five_hour.or(weekly).or_else(|| (!windows.is_empty()).then_some(0));
    let Some(primary_index) = primary_index else { return (None, None) };
    let secondary_index = if five_hour == Some(primary_index) {
        weekly.filter(|index| *index != primary_index)
    } else {
        windows.iter().enumerate().find_map(|(index, _)| (index != primary_index).then_some(index))
    };
    (
        windows.get(primary_index).cloned(),
        secondary_index.and_then(|index| windows.get(index).cloned()),
    )
}
```

- [ ] **Step 4: Wire selection into `fetch_snapshot`**

Replace both `find_window` calls with:

```rust
let (short_window, weekly_window) =
    select_display_windows(collect_windows(rate_limit));
if short_window.is_none() {
    return ProviderSnapshot::failure(
        "unavailable",
        "Codex usage response contains no usable windows.",
    );
}
```

Update `safe_http_failure` and other user-safe service strings to say `Codex usage service`, never `Quota service`.

- [ ] **Step 5: Run formatting and Rust tests**

Run:

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml codex::tests -- --nocapture
```

Expected: formatting check PASS; weekly-only, five-hour-only, dual-window, custom, unknown, duplicate, parsing, and HTTP-safe-message tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/codex.rs
git commit -m "fix: classify Codex usage windows by duration"
```

---

### Task 2: Add Dynamic Period Semantics and Localized Copy

**Files:**
- Create: `src/lib/usagePeriod.ts`
- Create: `src/lib/usagePeriod.test.ts`
- Modify: `src/lib/i18n.ts`

**Interfaces:**
- Produces `UsagePeriod = { kind: "fiveHour" | "weekly" | "hours" | "days" | "current"; value?: number }`.
- Produces `classifyUsagePeriod(windowSeconds)`.
- Produces localized primary, secondary, and accessible remaining labels without calendar-week assumptions.

- [ ] **Step 1: Add failing duration-classification tests**

Create `src/lib/usagePeriod.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { classifyUsagePeriod } from "./usagePeriod";

describe("classifyUsagePeriod", () => {
  it.each([17_940, 18_000, 18_060])("recognizes the five-hour tolerance at %i", (seconds) => {
    expect(classifyUsagePeriod(seconds)).toEqual({ kind: "fiveHour" });
  });

  it.each([604_740, 604_800, 604_860])("recognizes the weekly tolerance at %i", (seconds) => {
    expect(classifyUsagePeriod(seconds)).toEqual({ kind: "weekly" });
  });

  it("uses clean day and hour units for custom periods", () => {
    expect(classifyUsagePeriod(86_400)).toEqual({ kind: "days", value: 1 });
    expect(classifyUsagePeriod(43_200)).toEqual({ kind: "hours", value: 12 });
  });

  it("uses current-period semantics when duration is absent", () => {
    expect(classifyUsagePeriod(0)).toEqual({ kind: "current" });
  });
});
```

- [ ] **Step 2: Run the helper test and verify failure**

Run: `npm test -- --run src/lib/usagePeriod.test.ts`

Expected: FAIL because `usagePeriod.ts` does not exist.

- [ ] **Step 3: Implement period classification**

Create `src/lib/usagePeriod.ts`:

```ts
export type UsagePeriod =
  | { kind: "fiveHour" }
  | { kind: "weekly" }
  | { kind: "hours"; value: number }
  | { kind: "days"; value: number }
  | { kind: "current" };

const FIVE_HOURS = 18_000;
const ONE_WEEK = 604_800;
const TOLERANCE = 60;

const near = (value: number, expected: number) =>
  value > 0 && Math.abs(value - expected) <= TOLERANCE;

export function classifyUsagePeriod(windowSeconds: number): UsagePeriod {
  if (near(windowSeconds, FIVE_HOURS)) return { kind: "fiveHour" };
  if (near(windowSeconds, ONE_WEEK)) return { kind: "weekly" };
  if (windowSeconds > 0 && windowSeconds % 86_400 === 0) {
    return { kind: "days", value: windowSeconds / 86_400 };
  }
  if (windowSeconds > 0 && windowSeconds % 3_600 === 0) {
    return { kind: "hours", value: windowSeconds / 3_600 };
  }
  return { kind: "current" };
}
```

- [ ] **Step 4: Add failing Chinese and English copy tests**

Extend `src/lib/usagePeriod.test.ts`:

```ts
import { copy } from "./i18n";

it("formats recognized and custom primary labels in both languages", () => {
  expect(copy["zh-CN"].usagePeriodRemaining({ kind: "fiveHour" })).toBe("5 小时额度剩余");
  expect(copy["zh-CN"].usagePeriodRemaining({ kind: "weekly" })).toBe("一周额度剩余");
  expect(copy.en.usagePeriodRemaining({ kind: "days", value: 2 })).toBe("2-day usage remaining");
  expect(copy.en.usagePeriodRemaining({ kind: "current" })).toBe("Current-period usage remaining");
});

it("formats complete accessible remaining labels", () => {
  expect(copy["zh-CN"].usageAvailableLabel({ kind: "weekly" }, 64)).toBe("一周额度剩余 64%");
  expect(copy.en.usageAvailableLabel({ kind: "hours", value: 12 }, 73)).toBe("12-hour usage remaining 73%");
});
```

Run: `npm test -- --run src/lib/usagePeriod.test.ts`

Expected: FAIL because the dynamic copy functions do not exist.

- [ ] **Step 5: Replace fixed five-hour copy with typed functions**

Import `UsagePeriod` into `src/lib/i18n.ts` and define language-specific helpers
above the `copy` object:

```ts
function zhUsagePeriodRemaining(period: UsagePeriod): string {
  if (period.kind === "fiveHour") return "5 小时额度剩余";
  if (period.kind === "weekly") return "一周额度剩余";
  if (period.kind === "hours") return `${period.value} 小时额度剩余`;
  if (period.kind === "days") return `${period.value} 天额度剩余`;
  return "当前周期额度剩余";
}

function enUsagePeriodRemaining(period: UsagePeriod): string {
  if (period.kind === "fiveHour") return "5-hour usage remaining";
  if (period.kind === "weekly") return "Weekly usage remaining";
  if (period.kind === "hours") return `${period.value}-hour usage remaining`;
  if (period.kind === "days") return `${period.value}-day usage remaining`;
  return "Current-period usage remaining";
}
```

Then expose the helpers inside the two language branches:

```ts
usagePeriodRemaining: zhUsagePeriodRemaining,
usageAvailableLabel: (period: UsagePeriod, percent: number) =>
  `${zhUsagePeriodRemaining(period)} ${percent}%`,
longerPeriodRemaining: "较长周期额度剩余",

usagePeriodRemaining: enUsagePeriodRemaining,
usageAvailableLabel: (period: UsagePeriod, percent: number) =>
  `${enUsagePeriodRemaining(period)} ${percent}%`,
longerPeriodRemaining: "Longer-period usage remaining",
```

Add the English equivalent using `5-hour`, `Weekly`, `${value}-hour`, `${value}-day`, and `Current-period`. Remove `shortRemaining`, fixed `availableLabel`, and calendar-week `weeklyUntil` usages after their callers migrate.

Also add shared titles, shared control labels, plan/update subtitle functions, localized Codex usage service fallback, and operation-notice strings needed by Tasks 3–5.

- [ ] **Step 6: Run helper and type checks**

Run:

```bash
npm test -- --run src/lib/usagePeriod.test.ts
npm run build
```

Expected: helper tests PASS and TypeScript build PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/usagePeriod.ts src/lib/usagePeriod.test.ts src/lib/i18n.ts
git commit -m "feat: add adaptive usage period copy"
```

---

### Task 3: Build the Shared `CardChrome`

**Files:**
- Create: `src/components/CardChrome.tsx`
- Create: `src/components/CardChrome.test.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Receives title/subtitle, status tone/label, current view, preferences, loading/disabled state, settings-open state, and five action callbacks.
- Renders one non-button status indicator followed by five icon buttons in the approved order.
- Restores focus to the settings button when the appearance sheet closes.

- [ ] **Step 1: Add a failing action-order and icon test**

Create `src/components/CardChrome.test.tsx` with a shared render helper and:

```tsx
it("renders the status and five icon actions in the required order", () => {
  const { container } = renderChrome({ view: "quota" });
  const nav = screen.getByRole("navigation", { name: "悬浮窗控制" });
  expect(within(nav).getAllByRole("button").map((button) => button.getAttribute("aria-label")))
    .toEqual(["刷新额度数据", "切换到本机 Token 统计", "Switch to English", "取消置顶", "设置与说明"]);
  expect(nav.firstElementChild).toHaveAttribute("role", "status");
  expect(within(nav).getAllByRole("button").every((button) => button.querySelector("svg"))).toBe(true);
  expect(container).not.toHaveTextContent(/^(EN|中)$/);
});

it("uses Gauge when statistics switches back to remaining usage", () => {
  renderChrome({ view: "tokenStats" });
  expect(screen.getByRole("button", { name: "切换到剩余额度" }).querySelector("svg")).not.toBeNull();
});
```

- [ ] **Step 2: Add failing callback, disabled, and focus-return tests**

Test every button once, verify refresh remains enabled when status tone is `error`, verify preference-mutating actions honor `disabled`, and verify the settings button regains focus after `settingsOpen` changes from true to false.

Run: `npm test -- --run src/components/CardChrome.test.tsx`

Expected: FAIL because `CardChrome.tsx` does not exist.

- [ ] **Step 3: Implement `CardChrome`**

Create the component with this public shape:

```ts
export type CardStatusTone = "ok" | "active" | "stale" | "error";

export interface CardChromeProps {
  title: string;
  subtitle: string;
  statusTone: CardStatusTone;
  statusLabel: string;
  view: "quota" | "tokenStats";
  preferences: WidgetPreferences;
  refreshing?: boolean;
  disabled?: boolean;
  settingsOpen?: boolean;
  onRefresh: () => void | Promise<void>;
  onSwitchView: () => void;
  onLanguage: () => void;
  onAlwaysOnTop: () => void;
  onOpenSettings: () => void;
}
```

Render:

```tsx
<header className="card-chrome">
  <div className="card-chrome-copy">
    <p className="card-chrome-title">{title}</p>
    <p className="card-chrome-subtitle">{subtitle}</p>
  </div>
  <nav className="card-chrome-actions" aria-label={t.controls}>
    <span className={`usage-indicator usage-indicator--${statusTone}`} role="status" ... />
    <button aria-label={refreshLabel}><ArrowClockwise /></button>
    <button aria-label={switchLabel}>{view === "quota" ? <ChartBar /> : <Gauge />}</button>
    <button aria-label={t.switchLanguage}><Translate /></button>
    <button aria-label={preferences.alwaysOnTop ? t.pinOff : t.pinOn}>
      {preferences.alwaysOnTop ? <PushPin /> : <PushPinSlash />}
    </button>
    <button ref={settingsButtonRef} aria-label={t.openSettings}><GearSix /></button>
  </nav>
</header>
```

Disable refresh only while `refreshing`; disable page/language/pin/settings while a preference mutation is pending. Stop mouse-down propagation inside the action bar.

- [ ] **Step 4: Add shared header and action CSS**

Create `.card-chrome`, `.card-chrome-copy`, `.card-chrome-title`, `.card-chrome-subtitle`, and `.card-chrome-actions` rules. Use 24px circular targets in the 320px card and 28px targets at 400px through the card-size context, with matching:

- blue-gray icon ink;
- translucent white borders;
- hover/active/disabled states;
- two-pixel dark-blue focus ring;
- no wrapping or title overlap.

Move reusable `usage-indicator` styles under the shared chrome section without changing its status colors.

- [ ] **Step 5: Run focused tests and build**

Run:

```bash
npm test -- --run src/components/CardChrome.test.tsx
npm run build
```

Expected: shared chrome tests PASS and build PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/CardChrome.tsx src/components/CardChrome.test.tsx src/styles.css
git commit -m "feat: add shared expanded card chrome"
```

---

### Task 4: Migrate the Remaining-usage Card

**Files:**
- Create: `src/components/QuotaCard.test.tsx`
- Modify: `src/components/QuotaCard.tsx`
- Modify: `src/styles.css`
- Modify: `src/components/DesignPlayground.tsx`

**Interfaces:**
- The selected primary window drives the large metric and dynamic period label.
- The secondary block renders only when a selected secondary window exists.
- `QuotaCard` accepts settings open/close/save callbacks and renders the existing `AppearanceSheet`.

- [ ] **Step 1: Add failing weekly-only and dual-window tests**

Create `src/components/QuotaCard.test.tsx` with complete default props and:

```tsx
it("renders a weekly-only primary without an empty secondary metric", () => {
  renderQuota({
    shortWindow: { remainingPercent: 64, resetsAt: "2026-07-31T08:31:12Z", windowSeconds: 604800 },
    weeklyWindow: null,
  });
  expect(screen.getByText("一周额度剩余")).toBeInTheDocument();
  expect(screen.getByText("64")).toBeInTheDocument();
  expect(screen.queryByText("--")).not.toBeInTheDocument();
  expect(screen.queryByText("较长周期额度剩余")).not.toBeInTheDocument();
});

it("renders five-hour primary and weekly secondary when both exist", () => {
  renderQuota({
    shortWindow: { remainingPercent: 73, resetsAt: null, windowSeconds: 18000 },
    weeklyWindow: { remainingPercent: 42, resetsAt: null, windowSeconds: 604800 },
  });
  expect(screen.getByText("5 小时额度剩余")).toBeInTheDocument();
  expect(screen.getByText("一周额度剩余")).toBeInTheDocument();
  expect(screen.getByText("42")).toBeInTheDocument();
});
```

- [ ] **Step 2: Add failing shell, unavailable, settings, and localization tests**

Verify:

- the root has both `expanded-card-surface` and `quota-card`;
- the header title is `CODEX · 剩余额度`;
- plan and updated time share one subtitle;
- the shared chrome buttons appear in the required order;
- unavailable and signed-out states still expose the header refresh icon;
- opening settings renders the existing appearance dialog;
- a Chinese UI never renders raw `Quota service is temporarily unavailable.`;
- settings preview updates `--glass-transparency` and `--glass-blur-strength`;
- no `.aurora` element exists in the expanded quota card.

Run: `npm test -- --run src/components/QuotaCard.test.tsx`

Expected: FAIL against the current fixed five-hour header and aurora surface.

- [ ] **Step 3: Migrate quota presentation to dynamic period semantics**

In `QuotaCard.tsx`:

```ts
const primaryPeriod = classifyUsagePeriod(snapshot.shortWindow?.windowSeconds ?? 0);
const secondaryPeriod = snapshot.weeklyWindow
  ? classifyUsagePeriod(snapshot.weeklyWindow.windowSeconds)
  : null;
const primaryLabel = t.usagePeriodRemaining(primaryPeriod);
const primaryAria = t.usageAvailableLabel(primaryPeriod, primary ?? 0);
```

Use `primaryLabel` as visible header copy near the metric and `primaryAria` for the live region, section, progress bar, and collapsed-orb label. For a secondary weekly period use the weekly label; for another period use its duration-derived label, falling back to `t.longerPeriodRemaining`.

Render the secondary/footer percentage only when `snapshot.weeklyWindow` exists. Keep reset credits and `ProviderMark` available by placing them in a compact footer variant when there is no secondary window.

- [ ] **Step 4: Replace the private header and add appearance settings**

Remove the expanded `.aurora`, `.card-header`, and `.card-actions` markup. Render:

```tsx
<CardChrome
  title={t.quotaTitle}
  subtitle={t.cardUpdatedAt(snapshot.plan, formatUpdatedAt(snapshot.updatedAt, language))}
  statusTone={indicatorState}
  statusLabel={indicatorLabel}
  view="quota"
  preferences={preferences}
  refreshing={refreshing}
  disabled={preferenceActionsDisabled}
  settingsOpen={settingsOpen}
  onRefresh={onRefresh}
  onSwitchView={onSwitchToStats}
  onLanguage={onLanguage}
  onAlwaysOnTop={onLock}
  onOpenSettings={onOpenSettings}
/>
```

Mirror the existing `TokenStatsCard` appearance-preview state and render `AppearanceSheet` when `settingsOpen`. Keep the card expanded while its sheet is open and restore settings-button focus through `CardChrome`.

Remove the obsolete `providerCount`, `onPrevious`, `onNext`, and
`onTogglePin` props from `QuotaCard` and its call sites so the header contains
only the approved shared controls. Keep the existing provider rotation state in
`App`; this work does not add a second provider or change its automatic
rotation behavior.

- [ ] **Step 5: Apply the shared blue-glass surface at 320×320**

Add `expanded-card-surface` to the quota root and move the Token-statistics gradient, blur variables, ink variables, and masked two-pixel border to that shared class. Keep quota-specific progress colors and layout; remove health-driven expanded-background variables while leaving `.quota-orb .aurora` untouched.

Update `DesignPlayground.tsx` with a `weekly-only` quota mode and the new optional settings callbacks so the browser preview can exercise the real components.

- [ ] **Step 6: Run quota, period, and build checks**

Run:

```bash
npm test -- --run src/components/QuotaCard.test.tsx src/lib/usagePeriod.test.ts
npm run build
```

Expected: weekly-only, dual-window, unavailable refresh, settings, localization, collapsed-orb, and build checks PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/QuotaCard.tsx src/components/QuotaCard.test.tsx src/components/DesignPlayground.tsx src/styles.css
git commit -m "feat: adapt remaining usage card to response windows"
```

---

### Task 5: Migrate Statistics and Wire Shared Actions in `App`

**Files:**
- Modify: `src/components/TokenStatsCard.tsx`
- Modify: `src/components/TokenStatsCard.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/App.tokenStatsIntegration.test.tsx`
- Modify: `src/components/DesignPlayground.tsx`
- Modify: `src/styles.css`
- Modify: `src/lib/i18n.ts`

**Interfaces:**
- Both card components receive the same preference actions and settings contract.
- Active-page refresh remains distinct: quota invokes `fetchSnapshots(true)`, statistics invokes `tokenStats.refresh(true)`.
- Operation notices are stored as localization keys or mapped to safe localized copy before render.

- [ ] **Step 1: Add failing statistics chrome tests**

Extend `TokenStatsCard.test.tsx` to require:

- root classes `expanded-card-surface token-stats-card`;
- title `CODEX · 本机统计`;
- plan plus updated-time subtitle when `plan="PROLITE"`;
- ordered status, refresh, `Gauge`, `Translate`, pin, and `GearSix` controls;
- callbacks for language, always-on-top, settings, refresh, and return-to-quota;
- the same settings dialog and appearance preview behavior;
- existing tabs, chart, details, loading, empty, stale, and unavailable states unchanged.

Run: `npm test -- --run src/components/TokenStatsCard.test.tsx`

Expected: FAIL because the card still uses its private three-button header.

- [ ] **Step 2: Replace the statistics header with `CardChrome`**

Add `plan`, `onLanguage`, and `onAlwaysOnTop` props. Derive the shared status tone:

```ts
const chromeStatus = loading
  ? "active"
  : snapshot.status === "ok"
    ? "ok"
    : snapshot.status === "stale"
      ? "stale"
      : "error";
```

Replace `.token-stats-header` and `.token-stats-actions` with `CardChrome`, passing `view="tokenStats"`, the plan/update subtitle, active-page refresh, and shared preference callbacks. Keep `AppearanceSheet`, chart selection, and loading/data states in `TokenStatsCard`.

- [ ] **Step 3: Add failing App integration tests for both pages**

In `src/App.test.tsx`, verify the quota page:

- shows `5 小时额度剩余` for an `18000`-second primary;
- shows the same five action labels as `CardChrome`;
- dispatches language, always-on-top, settings, refresh, and statistics-page switch.

In `src/App.tokenStatsIntegration.test.tsx`, verify the statistics page:

- receives the quota account plan for its subtitle;
- language invokes persisted preference update;
- pin invokes `setAlwaysOnTop`;
- settings opens the appearance sheet;
- refresh calls only the statistics refresh helper;
- `Gauge` page switch preserves the existing resize/persistence ordering.

Run:

```bash
npm test -- --run src/App.test.tsx src/App.tokenStatsIntegration.test.tsx
```

Expected: FAIL because the statistics page lacks language/pin props and the quota page lacks settings wiring.

- [ ] **Step 4: Centralize shared action handlers in `App`**

Extract callbacks used by both branches:

```ts
const changeLanguage = useCallback(() => {
  savePreferences({
    ...preferencesRef.current,
    language: nextLanguage(normalizeLanguage(preferencesRef.current.language)),
  });
}, [savePreferences]);

const toggleAlwaysOnTop = useCallback(() => {
  // Reuse the existing guarded setAlwaysOnTop transaction and rollback notice.
}, [acquirePreferenceMutation, applyConfirmedPreferences, finishPreferenceMutation]);

const openSettings = useCallback(() => {
  if (preferenceMutationPendingRef.current) return;
  setOperationNotice(null);
  setSettingsOpen(true);
}, []);
```

Pass these callbacks, `settingsOpen`, close/save handlers, current plan, and preference-disabled state to both cards. Close settings before page switches and prevent hover collapse while the sheet is open.

- [ ] **Step 5: Localize App and backend-facing notices**

Replace raw `operationError` strings with a typed `OperationNoticeKey` rendered through `copy[language]`. Map first-load quota failure to a safe message such as `t.codexUsageUnavailable`; map unknown Chinese backend messages to the same localized fallback instead of returning raw English. Keep diagnostic details out of the UI.

Remove stale fixed-copy expectations (`5 小时剩余`, `5-hour remaining`, and `Quota service`) from tests and replace them with duration-derived phrases.

- [ ] **Step 6: Consolidate shared CSS and playground props**

Remove no-longer-used `.token-stats-header`, `.token-stats-actions`, `.card-header`, and `.card-actions` rules. Ensure `.expanded-card-surface` and `.card-chrome*` are the sole expanded-page surface/header/action definitions. Preserve:

- quota 320px spacing and footer;
- statistics 400px tabs/chart/details;
- the existing appearance sheet;
- responsive/reduced-motion/high-contrast behavior.

Update every `DesignPlayground` render with the shared actions and settings contract.

- [ ] **Step 7: Run frontend regression checks**

Run:

```bash
npm test -- --run
npm run build
```

Expected: all Vitest tests PASS; TypeScript/Vite build PASS; no fixed five-hour copy remains outside duration-aware tests and historical approved specs.

- [ ] **Step 8: Commit**

```bash
git add src/components/TokenStatsCard.tsx src/components/TokenStatsCard.test.tsx src/App.tsx src/App.test.tsx src/App.tokenStatsIntegration.test.tsx src/components/DesignPlayground.tsx src/styles.css src/lib/i18n.ts
git commit -m "feat: unify TokenHalo expanded card controls"
```

---

### Task 6: Update Product Documentation and Verify the Complete Flow

**Files:**
- Modify: `README.md`
- Modify: `PRIVACY.md`
- Modify: `docs/PROJECT-SUMMARY.md`
- Modify: `docs/TEST-MATRIX.md`
- Verify: all files changed by Tasks 1–5

- [ ] **Step 1: Update current user-facing documentation**

Replace guarantees of simultaneous five-hour and weekly windows with wording equivalent to:

```md
- Shows the usage windows returned for the signed-in Codex plan, including
  five-hour or weekly remaining usage when provided, plus reset timing and
  reset-credit information.
```

In `docs/TEST-MATRIX.md`, add manual rows for:

- `604800`-only account → one-week primary, no secondary filler value;
- `18000 + 604800` account → five-hour primary plus weekly secondary;
- both expanded pages → matching glass, icon order, language, pin, settings;
- unavailable/signed-out quota → header refresh remains usable.

Use `Codex usage service` in current privacy/help prose.

- [ ] **Step 2: Scan for stale product assumptions and unfinished markers**

Run:

```bash
rg -n -i "Quota service|5 小时剩余|5-hour remaining|Shows your Codex plan, 5-hour quota" src src-tauri README.md PRIVACY.md docs/PROJECT-SUMMARY.md docs/TEST-MATRIX.md
rg -n "TBD|TODO|FIXME|刷|页|顶|设" src docs/superpowers/plans/2026-07-25-adaptive-usage-card-shell.md
```

Expected: no raw service-brand copy, fixed primary-period UI copy, temporary action glyphs, or unfinished implementation markers remain. Duration-aware test fixtures and the approved design/implementation documents may still mention five-hour behavior deliberately.

- [ ] **Step 3: Run all automated verification**

Run:

```bash
npm test -- --run
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: all frontend tests, production build, Rust formatting, and Rust tests PASS.

- [ ] **Step 4: Verify the local weekly-only response**

Run the existing read-only live diagnostic path or an equivalent focused test against the current signed-in account. Confirm:

- returned primary duration is `604800`;
- selected display primary is weekly;
- selected display secondary is absent;
- no token, account identifier, response body, or auth path is printed.

- [ ] **Step 5: Perform browser visual verification**

Use the browser-control skill against the local Vite playground and capture:

- quota at 320×320: weekly-only success, stale, unavailable, signed-out;
- statistics at 400×400: success and unavailable;
- Chinese and English on both pages;
- pinned and unpinned headers;
- settings opened from quota and statistics.

For every capture, confirm:

- matching cool-blue gradient and masked border;
- matching title/subtitle hierarchy;
- exact status/refresh/page/language/pin/settings order;
- Phosphor icons only;
- no overlap at 320px;
- quota metric, reset credits, chart, tabs, and breakdown remain intact.

- [ ] **Step 6: Build the desktop bundle**

Run:

```bash
npm run tauri build -- --bundles app,dmg
```

Expected: release app and DMG build successfully with the TokenHalo product name.

- [ ] **Step 7: Review the final diff**

Run:

```bash
git diff --check
git status --short
git diff --stat HEAD~5..HEAD
```

Confirm `.superpowers/` visual-companion artifacts remain untracked and are not staged. Confirm no remote URL or GitHub repository metadata changed.

- [ ] **Step 8: Commit documentation**

```bash
git add README.md PRIVACY.md docs/PROJECT-SUMMARY.md docs/TEST-MATRIX.md
git commit -m "docs: describe adaptive TokenHalo usage windows"
```

---

## Final Acceptance Checklist

- [ ] A `604800`-second-only response renders `一周额度剩余` / `Weekly usage remaining` as the large metric and renders no empty secondary percentage.
- [ ] An `18000`-second window still renders five-hour semantics.
- [ ] Five-hour plus weekly responses render in that order regardless of upstream key names.
- [ ] Custom and missing durations use truthful custom/current-period labels.
- [ ] Both expanded pages use the same blue-glass surface, masked border, title hierarchy, status dot, and icon-button styling.
- [ ] Both pages expose active-page refresh, page switching, language switching, always-on-top, and the existing settings sheet.
- [ ] The six header items remain in exact order and fit at 320px without wrapping.
- [ ] Chinese UI never exposes raw English Codex usage-service errors.
- [ ] Collapsed orb, reset credits, statistics charts, settings persistence, hover expansion, edge anchoring, and page persistence retain test coverage.
- [ ] Frontend tests/build, Rust formatting/tests, browser checks, and Tauri app/DMG build all pass.
- [ ] `.superpowers/` stays untracked and GitHub remote state is unchanged.
