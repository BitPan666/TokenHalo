# Local Token Statistics and Native Glass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 400×400 local Codex Token statistics page, incremental `~/.codex/sessions` aggregation, edge-aware page resizing, and adjustable native macOS glass without regressing the existing quota widget.

**Architecture:** Rust owns privacy-safe JSONL parsing, per-file incremental indexing, cache persistence, time-bucket aggregation, and native macOS glass. React owns the quota/stats page state, chart selection, settings sheet, and CSS tint/border layer. The existing single NSPanel and anchor geometry remain the only window; its mode changes between 100, 320, and 400 logical pixels.

**Tech Stack:** Tauri 2, Rust 2021, Tokio, Serde/JSON, Chrono + chrono-tz, React 19, TypeScript 5.9, Vitest, CSS, `tauri-nspanel`, `window-vibrancy` 0.8.

## Global Constraints

- Compact, quota, and statistics modes are exactly 100×100, 320×320, and 400×400 logical pixels.
- Daily means 30 natural days, one bar per day; weekly means 12 ISO natural weeks starting Monday, one bar per week; monthly means January through December of the current natural year, one bar per month.
- Only parse Token count events from `~/.codex/sessions`; never persist prompts, responses, source code, raw JSON lines, authentication values, or full absolute user paths.
- Statistics are local trend estimates, not official billing, account-wide usage, or remaining quota.
- Default glass values are transparency `40`, blur strength `40`, and fixed border highlight `50`.
- The unit suffix uses neutral gray `#737B86`.
- Active tabs use `#3779DF → rgba(91, 171, 255, 0.72)` from top to bottom.
- Chart bars use `#3C7FE7 → rgba(103, 184, 255, 0.60)` from top to bottom.
- macOS 26+ uses Liquid Glass; older macOS uses Vibrancy fallback; a native-effect failure must preserve a readable transparent CSS fallback.
- Existing all-Spaces/fullscreen NSPanel behavior, one-widget behavior, quota refresh, locking, language, tray, autostart, and edge-aware expansion must remain functional.
- Use test-driven development and commit after every task.

---

## File Structure

### New Rust files

- `src-tauri/src/token_stats/mod.rs` — public service, scan serialization, and snapshot construction.
- `src-tauri/src/token_stats/models.rs` — serialized API types and private aggregate/index types.
- `src-tauri/src/token_stats/parser.rs` — privacy-limited JSONL Token record parsing and cumulative-delta calculation.
- `src-tauri/src/token_stats/periods.rs` — day/week/month keys, bucket ranges, labels, and summary reduction.
- `src-tauri/src/token_stats/index.rs` — recursive file discovery, append/rebuild/delete reconciliation.
- `src-tauri/src/token_stats/cache.rs` — versioned atomic cache load/save and backup recovery.
- `src-tauri/src/macos_glass.rs` — macOS 26 Liquid Glass, legacy Vibrancy, normalization, and safe fallback.

### New frontend files

- `src/components/TokenStatsCard.tsx` — 400×400 statistics page, bars, selection, empty/error states, and settings entry.
- `src/components/TokenStatsCard.test.tsx` — statistics card behavior and accessibility tests.
- `src/components/AppearanceSheet.tsx` — transparency/blur controls, explanation, reset, and local-data disclaimer.
- `src/components/AppearanceSheet.test.tsx` — live preview, persistence, and rollback tests.
- `src/lib/tokenStats.ts` — snapshot fetch/refresh helper and browser mock data.
- `src/lib/useTokenStats.ts` — visible-page refresh lifecycle and stale snapshot retention.
- `src/lib/useTokenStats.test.tsx` — initial load, 60-second refresh, and failure behavior.

### Modified files

- `src-tauri/Cargo.toml` — time-zone, traversal, native-glass, and test dependencies.
- `src-tauri/src/models.rs` — new backward-compatible preferences.
- `src-tauri/src/lib.rs` — token service state, commands, preference event/apply flow, startup setup.
- `src/types.ts` — statistics API and preference types.
- `src/lib/bridge.ts` — defaults, stats calls, window-mode call, native preference event handling.
- `src/lib/windowPlacement.ts` and test — anchored resize between expanded modes.
- `src/lib/widgetWindow.ts` and test — `compact | quota | stats` controller.
- `src/App.tsx` — page state, view toggle, mode selection, stats lifecycle.
- `src/components/QuotaCard.tsx` — page-switch action.
- `src/lib/i18n.ts` — statistics/settings/disclaimer copy.
- `src/styles.css` — approved 400×400 glass card and responsive bar layout.
- `src/components/DesignPlayground.tsx` — browser preview for daily/weekly/monthly and appearance settings.
- `README.md`, `PRIVACY.md`, `docs/KNOWN-LIMITATIONS.md`, `docs/TEST-MATRIX.md` — user-facing scope and validation.

---

### Task 1: Backward-Compatible Preference Contract

**Files:**
- Modify: `src-tauri/src/models.rs`
- Modify: `src/types.ts`
- Modify: `src/lib/bridge.ts`
- Modify: `src/App.tsx`

**Interfaces:**
- Produces Rust `ExpandedView::{Quota, TokenStats}` and fields `expanded_view`, `glass_transparency`, `glass_blur_strength`.
- Produces TypeScript `ExpandedView = "quota" | "tokenStats"` and matching camelCase preference fields.
- Values normalize to transparency `10...90` and blur `0...60`.

- [ ] **Step 1: Add failing Rust preference tests**

Append to `src-tauri/src/models.rs`:

```rust
#[cfg(test)]
mod preference_tests {
    use super::*;

    #[test]
    fn old_preferences_receive_new_defaults() {
        let raw = r#"{
          "locked": false,
          "alwaysOnTop": true,
          "pinnedProvider": null,
          "autoRotateSeconds": 12,
          "language": "zh-CN"
        }"#;
        let value: WidgetPreferences = serde_json::from_str(raw).unwrap();
        assert_eq!(value.expanded_view, ExpandedView::Quota);
        assert_eq!(value.glass_transparency, 40);
        assert_eq!(value.glass_blur_strength, 40);
    }

    #[test]
    fn appearance_values_are_clamped() {
        let value = WidgetPreferences {
            glass_transparency: 100,
            glass_blur_strength: 999,
            ..WidgetPreferences::default()
        }.normalized();
        assert_eq!(value.glass_transparency, 90);
        assert_eq!(value.glass_blur_strength, 60);
    }
}
```

- [ ] **Step 2: Run the Rust tests and verify failure**

Run: `cargo test --manifest-path src-tauri/Cargo.toml preference_tests -- --nocapture`

Expected: FAIL because `ExpandedView` and the new fields do not exist.

- [ ] **Step 3: Implement the Rust contract**

Add before `WidgetPreferences` and extend its default/normalization:

```rust
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum ExpandedView {
    #[default]
    Quota,
    TokenStats,
}

fn default_glass_transparency() -> u8 { 40 }
fn default_glass_blur_strength() -> u8 { 40 }

// Inside WidgetPreferences:
#[serde(default)]
pub expanded_view: ExpandedView,
#[serde(default = "default_glass_transparency")]
pub glass_transparency: u8,
#[serde(default = "default_glass_blur_strength")]
pub glass_blur_strength: u8,

// Inside Default:
expanded_view: ExpandedView::Quota,
glass_transparency: default_glass_transparency(),
glass_blur_strength: default_glass_blur_strength(),

// Inside normalized:
self.glass_transparency = self.glass_transparency.clamp(10, 90);
self.glass_blur_strength = self.glass_blur_strength.min(60);
```

- [ ] **Step 4: Update the TypeScript contract and every default object**

Add to `src/types.ts`:

```ts
export type ExpandedView = "quota" | "tokenStats";

export interface WidgetPreferences {
  locked: boolean;
  alwaysOnTop: boolean;
  pinnedProvider: ProviderId | null;
  autoRotateSeconds: number;
  language: Language;
  expandedView: ExpandedView;
  glassTransparency: number;
  glassBlurStrength: number;
}
```

Set the added defaults in both `src/lib/bridge.ts` and `src/App.tsx`:

```ts
expandedView: "quota",
glassTransparency: 40,
glassBlurStrength: 40,
```

- [ ] **Step 5: Run all contract tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml preference_tests && npm test -- --run`

Expected: Rust preference tests PASS and existing Vitest suite PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/models.rs src/types.ts src/lib/bridge.ts src/App.tsx
git commit -m "feat: add token view and glass preferences"
```

---

### Task 2: Three-Mode Edge-Aware Window Geometry

**Files:**
- Modify: `src/lib/windowPlacement.ts`
- Modify: `src/lib/windowPlacement.test.ts`
- Modify: `src/lib/widgetWindow.ts`
- Modify: `src/lib/widgetWindow.test.ts`
- Modify: `src/lib/bridge.ts`

**Interfaces:**
- Produces `WidgetDisplayMode = "compact" | "quota" | "stats"`.
- Produces `WidgetWindowController.setMode(mode): Promise<void>`.
- Produces `setWidgetMode(mode): Promise<void>` bridge function.

- [ ] **Step 1: Add failing anchored-resize tests**

Add to `src/lib/windowPlacement.test.ts`:

```ts
import { planAnchoredResize } from "./windowPlacement";

it("grows a right-bottom anchored quota card to stats size without moving its anchor", () => {
  expect(planAnchoredResize({
    position: { x: 1120, y: 580 },
    fromSize: { width: 320, height: 320 },
    toSize: { width: 400, height: 400 },
    anchor: { horizontal: "right", vertical: "bottom" },
    workArea,
  })).toEqual({ x: 1040, y: 500 });
});

it("shrinks a left-top stats card to quota size in place", () => {
  expect(planAnchoredResize({
    position: { x: 200, y: 160 },
    fromSize: { width: 400, height: 400 },
    toSize: { width: 320, height: 320 },
    anchor: { horizontal: "left", vertical: "top" },
    workArea,
  })).toEqual({ x: 200, y: 160 });
});
```

Add to `src/lib/widgetWindow.test.ts`:

```ts
it("switches quota to stats and keeps a bottom-right anchor", async () => {
  const fake = fakeAdapter({ position: { x: 1340, y: 800 }, scaleFactor: 1, workArea });
  const controller = createWidgetWindowController(fake.adapter);
  await controller.setMode("quota");
  await controller.setMode("stats");
  expect(fake.frames).toEqual([
    { logicalSide: 320, position: { x: 1120, y: 580 } },
    { logicalSide: 400, position: { x: 1040, y: 500 } },
  ]);
});
```

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `npm test -- --run src/lib/windowPlacement.test.ts src/lib/widgetWindow.test.ts`

Expected: FAIL because `planAnchoredResize`, `WidgetDisplayMode`, and `setMode` do not exist.

- [ ] **Step 3: Implement anchored resize**

Add to `src/lib/windowPlacement.ts`:

```ts
interface AnchoredResizeInput {
  position: Point;
  fromSize: Size;
  toSize: Size;
  anchor: ExpansionAnchor;
  workArea: Rect | null;
}

export function planAnchoredResize(input: AnchoredResizeInput): Point {
  const { position, fromSize, toSize, anchor, workArea } = input;
  return clampPosition({
    x: anchor.horizontal === "right" ? position.x + fromSize.width - toSize.width : position.x,
    y: anchor.vertical === "bottom" ? position.y + fromSize.height - toSize.height : position.y,
  }, toSize, workArea);
}
```

- [ ] **Step 4: Replace the boolean controller with explicit modes**

In `src/lib/widgetWindow.ts`, use:

```ts
export type WidgetDisplayMode = "compact" | "quota" | "stats";
const SIDE_BY_MODE: Record<WidgetDisplayMode, number> = {
  compact: 100,
  quota: 320,
  stats: 400,
};

export interface WidgetWindowController {
  setMode(mode: WidgetDisplayMode): Promise<void>;
}
```

Track `currentMode`, `anchor`, and current physical size. Compact-to-expanded uses `planExpansion`; expanded-to-expanded uses `planAnchoredResize`; expanded-to-compact uses `planCollapse`. Keep the existing promise queue and only clear the anchor after a successful collapse.

- [ ] **Step 5: Update the bridge**

Replace `setWidgetExpanded` with:

```ts
export async function setWidgetMode(mode: WidgetDisplayMode): Promise<void> {
  if (!isTauri()) return;
  const controller = await getWidgetWindowController();
  await controller.setMode(mode);
}
```

- [ ] **Step 6: Run geometry tests**

Run: `npm test -- --run src/lib/windowPlacement.test.ts src/lib/widgetWindow.test.ts`

Expected: PASS, including rapid transition and adapter-failure tests updated to call `setMode`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/windowPlacement.ts src/lib/windowPlacement.test.ts src/lib/widgetWindow.ts src/lib/widgetWindow.test.ts src/lib/bridge.ts
git commit -m "feat: support edge-aware quota and stats sizes"
```

---

### Task 3: Token Models and Natural-Period Generation

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/token_stats/models.rs`
- Create: `src-tauri/src/token_stats/periods.rs`
- Create: `src-tauri/src/token_stats/mod.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Produces `StatsGranularity::{Day, Week, Month}`.
- Produces `TokenTotals`, `DailySessionTotals`, `TokenStatsBucket`, and `TokenStatsSnapshot`.
- Produces `periods::build_buckets(daily, granularity, now, timezone)`.

- [ ] **Step 1: Add dependencies**

Add to `[dependencies]` in `src-tauri/Cargo.toml`:

```toml
chrono-tz = "0.10"
iana-time-zone = "0.1"
walkdir = "2"
```

Add:

```toml
[dev-dependencies]
tempfile = "3"
```

- [ ] **Step 2: Write failing period tests**

Create `src-tauri/src/token_stats/periods.rs` with a test module that asserts:

```rust
#[test]
fn day_week_and_month_counts_match_the_contract() {
    let tz: chrono_tz::Tz = "Asia/Shanghai".parse().unwrap();
    let now = tz.with_ymd_and_hms(2026, 7, 23, 14, 0, 0).unwrap();
    assert_eq!(period_keys(StatsGranularity::Day, now).len(), 30);
    assert_eq!(period_keys(StatsGranularity::Week, now).len(), 12);
    assert_eq!(period_keys(StatsGranularity::Month, now).len(), 12);
}

#[test]
fn iso_week_starts_on_monday_and_crosses_year_correctly() {
    let tz: chrono_tz::Tz = "Asia/Shanghai".parse().unwrap();
    let now = tz.with_ymd_and_hms(2027, 1, 1, 12, 0, 0).unwrap();
    let latest = period_keys(StatsGranularity::Week, now).pop().unwrap();
    assert_eq!(latest.label, "W53");
    assert_eq!(latest.range_start.weekday(), chrono::Weekday::Mon);
}

#[test]
fn daylight_saving_transition_keeps_one_bucket_per_local_date() {
    let tz: chrono_tz::Tz = "America/Los_Angeles".parse().unwrap();
    let now = tz.with_ymd_and_hms(2026, 3, 9, 12, 0, 0).unwrap();
    let keys = period_keys(StatsGranularity::Day, now);
    assert_eq!(keys.len(), 30);
    assert_eq!(
        keys.iter()
            .map(|key| key.range_start.date_naive())
            .collect::<std::collections::HashSet<_>>()
            .len(),
        30
    );
}
```

- [ ] **Step 3: Run and verify failure**

Run: `cargo test --manifest-path src-tauri/Cargo.toml token_stats::periods -- --nocapture`

Expected: FAIL because the models and `period_keys` are undefined.

- [ ] **Step 4: Create serialized models**

In `models.rs`, define the exact API:

```rust
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum StatsGranularity { Day, Week, Month }

#[derive(Debug, Default, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TokenTotals {
    pub total_tokens: u64,
    pub input_tokens: u64,
    pub cached_input_tokens: u64,
    pub output_tokens: u64,
    pub reasoning_tokens: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TokenStatsBucket {
    pub key: String,
    pub label: String,
    pub range_start: String,
    pub range_end: String,
    pub totals: TokenTotals,
    pub task_count: u64,
    pub peak_task_tokens: u64,
    pub is_future: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenStatsSnapshot {
    pub status: String,
    pub granularity: StatsGranularity,
    pub buckets: Vec<TokenStatsBucket>,
    pub updated_at: String,
    pub message: Option<String>,
    pub partial: bool,
}
```

Private indexed daily values must be keyed by local `NaiveDate` and then by relative session path so task counts and peak sessions remain derivable.

- [ ] **Step 5: Implement natural-period keys and reduction**

Implement `period_keys` using local dates:

- Day: `today - 29 days ... today`.
- Week: Monday of the current ISO week minus 11 weeks ... current week.
- Month: January 1 through December 1 of `now.year()`.

`build_buckets` sums totals from included days, counts sessions with positive totals once per bucket, and sets `peak_task_tokens` to the maximum session total within the bucket.

- [ ] **Step 6: Register the module and run tests**

Add `mod token_stats;` to `src-tauri/src/lib.rs`.

Run: `cargo test --manifest-path src-tauri/Cargo.toml token_stats::periods -- --nocapture`

Expected: PASS for 30/12/12 counts, ISO week boundary, zero buckets, and future month flags.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/token_stats src-tauri/src/lib.rs
git commit -m "feat: model token statistics periods"
```

---

### Task 4: Privacy-Limited JSONL Delta Parser

**Files:**
- Create: `src-tauri/src/token_stats/parser.rs`
- Modify: `src-tauri/src/token_stats/mod.rs`

**Interfaces:**
- Consumes `TokenTotals`.
- Produces `ParserState`, `ParsedContribution`, and `parse_jsonl(reader, state, timezone)`.
- Never returns or caches raw JSON.

- [ ] **Step 1: Write parser tests with realistic JSONL**

Tests must cover:

```rust
const RECORDS: &str = r#"
{"timestamp":"2026-07-23T01:00:00Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"cached_input_tokens":40,"output_tokens":20,"reasoning_output_tokens":5,"total_tokens":125}}}}
{"timestamp":"2026-07-23T01:05:00Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":160,"cached_input_tokens":70,"output_tokens":35,"reasoning_output_tokens":8,"total_tokens":203},"last_token_usage":{"total_tokens":78}}}}
"#;

#[test]
fn cumulative_records_produce_only_the_non_negative_delta() {
    let result = parse_text(RECORDS, "Asia/Shanghai");
    assert_eq!(result.total.total_tokens, 203);
    assert_eq!(result.total.input_tokens, 160);
    assert_eq!(result.total.cached_input_tokens, 70);
    assert_eq!(result.total.output_tokens, 35);
}

#[test]
fn last_usage_is_not_added_again() {
    let result = parse_text(RECORDS, "Asia/Shanghai");
    assert_ne!(result.total.total_tokens, 281);
}
```

Also add reset, malformed-line, missing-field, cross-local-midnight, and unrelated-event tests.

- [ ] **Step 2: Run and verify failure**

Run: `cargo test --manifest-path src-tauri/Cargo.toml token_stats::parser -- --nocapture`

Expected: FAIL because parser functions do not exist.

- [ ] **Step 3: Implement narrow deserialization**

Deserialize only:

```rust
#[derive(Deserialize)]
struct LogEnvelope {
    timestamp: Option<String>,
    #[serde(rename = "type")]
    kind: Option<String>,
    payload: Option<TokenPayload>,
}

#[derive(Deserialize)]
struct TokenPayload {
    #[serde(rename = "type")]
    kind: Option<String>,
    info: Option<TokenInfo>,
}

#[derive(Deserialize)]
struct TokenInfo {
    total_token_usage: Option<RawTotals>,
    last_token_usage: Option<RawTotals>,
}
```

Do not add fields for message text, prompt text, tool arguments, code, or response bodies.

- [ ] **Step 4: Implement field-wise cumulative deltas**

Use:

```rust
fn delta(current: u64, previous: u64) -> u64 {
    if current >= previous { current - previous } else { current }
}
```

Apply it separately to total/input/cache/output/reasoning. Attribute each delta to the record timestamp converted into the supplied `Tz`. Treat `last_token_usage` only as a diagnostic consistency signal.

- [ ] **Step 5: Run parser tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml token_stats::parser -- --nocapture`

Expected: PASS; malformed/unrelated lines contribute zero and set a non-sensitive skipped-record counter.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/token_stats/parser.rs src-tauri/src/token_stats/mod.rs
git commit -m "feat: parse local codex token deltas"
```

---

### Task 5: Incremental File Index and Deletion Reconciliation

**Files:**
- Create: `src-tauri/src/token_stats/index.rs`
- Modify: `src-tauri/src/token_stats/models.rs`
- Modify: `src-tauri/src/token_stats/mod.rs`

**Interfaces:**
- Consumes `parse_jsonl`.
- Produces `TokenStatsIndex::scan(root, timezone)`.
- Index keys are session-root-relative UTF-8 paths; absolute home paths are not serialized.

- [ ] **Step 1: Write temp-directory index tests**

Create tests that:

1. Write one session file and scan.
2. Append one cumulative record and scan again.
3. Assert only the delta was added.
4. Truncate/rewrite the file and assert its old contribution was removed.
5. Delete the file and assert its contribution disappeared.
6. Add a malformed second file and assert the first remains available with `partial = true`.

Use `tempfile::tempdir()` and `std::fs::write/OpenOptions`.

- [ ] **Step 2: Run and verify failure**

Run: `cargo test --manifest-path src-tauri/Cargo.toml token_stats::index -- --nocapture`

Expected: FAIL because `TokenStatsIndex` and `scan` do not exist.

- [ ] **Step 3: Implement versioned per-file index state**

Use:

```rust
const INDEX_VERSION: u32 = 1;

#[derive(Default, Serialize, Deserialize)]
pub struct TokenStatsIndex {
    pub version: u32,
    pub files: HashMap<String, IndexedSession>,
    pub partial: bool,
}

#[derive(Default, Serialize, Deserialize)]
pub struct IndexedSession {
    pub len: u64,
    pub modified_millis: u128,
    pub cursor: u64,
    pub parser_state: ParserState,
    pub by_day: BTreeMap<NaiveDate, TokenTotals>,
}
```

Store no raw lines. If the file length grows and the previous metadata is consistent, seek to `cursor`; if it shrinks or changes without growth, remove its old contribution and parse from byte zero.

- [ ] **Step 4: Implement discovery and deletion**

Walk `root` recursively with `WalkDir`, accept regular `.jsonl` files only, and derive keys with `path.strip_prefix(root)`. After a successful discovery pass, remove index entries whose relative paths were not seen.

- [ ] **Step 5: Run index and parser tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml token_stats:: -- --nocapture`

Expected: PASS; appending, rewriting, deleting, malformed lines, and repeated scans are idempotent.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/token_stats/index.rs src-tauri/src/token_stats/models.rs src-tauri/src/token_stats/mod.rs
git commit -m "feat: index codex session logs incrementally"
```

---

### Task 6: Atomic Cache and Token Statistics Service

**Files:**
- Create: `src-tauri/src/token_stats/cache.rs`
- Modify: `src-tauri/src/token_stats/mod.rs`
- Modify: `src-tauri/src/token_stats/models.rs`

**Interfaces:**
- Produces `TokenStatsService::new(root, cache_path)`.
- Produces async `TokenStatsService::snapshot(granularity, force)`.
- One Tokio mutex serializes scans; failures return stale data when available.

- [ ] **Step 1: Write cache recovery tests**

Cover:

- normal save/load;
- invalid main cache with valid `.bak`;
- invalid version causing an empty rebuild;
- serialized content does not contain a known prompt string or the absolute temp directory.

- [ ] **Step 2: Run and verify failure**

Run: `cargo test --manifest-path src-tauri/Cargo.toml token_stats::cache -- --nocapture`

Expected: FAIL because cache functions do not exist.

- [ ] **Step 3: Implement atomic persistence**

Use the same contract as preferences:

```rust
pub fn save(path: &Path, index: &TokenStatsIndex) -> Result<(), String>
pub fn load(path: &Path) -> Option<TokenStatsIndex>
```

Write `token-stats-index.json.tmp`, `sync_all`, rotate the old file to `.bak`, then rename the temp file. On commit failure, restore the backup.

- [ ] **Step 4: Implement the service**

`TokenStatsService` owns:

```rust
pub struct TokenStatsService {
    root: PathBuf,
    cache_path: PathBuf,
    scan_lock: tokio::sync::Mutex<()>,
    index: Mutex<TokenStatsIndex>,
    last_snapshot: Mutex<HashMap<StatsGranularity, TokenStatsSnapshot>>,
}
```

Resolve runtime timezone with `iana_time_zone::get_timezone()` and parse it as `chrono_tz::Tz`, falling back to UTC only if detection fails. `snapshot` scans when forced or when the last scan is older than 60 seconds, then calls `build_buckets`.

Map conditions:

- missing/empty directory → `empty`;
- successful data → `ok`;
- refresh failure with previous buckets → `stale`;
- refresh failure without previous buckets → `unavailable`;
- skipped lines/files → `partial = true`.

- [ ] **Step 5: Run all token service tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml token_stats:: -- --nocapture`

Expected: PASS, including stale retention and cache recovery.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/token_stats/cache.rs src-tauri/src/token_stats/mod.rs src-tauri/src/token_stats/models.rs
git commit -m "feat: cache local token statistics safely"
```

---

### Task 7: Tauri Commands and Frontend Statistics Bridge

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/types.ts`
- Create: `src/lib/tokenStats.ts`
- Create: `src/lib/useTokenStats.ts`
- Create: `src/lib/useTokenStats.test.tsx`

**Interfaces:**
- Produces command `get_token_stats(granularity, force)`.
- Produces `fetchTokenStats(granularity, force)`.
- Produces `useTokenStats(active, granularity)`.

- [ ] **Step 1: Add frontend types and failing hook tests**

Add camelCase equivalents of the Rust models to `src/types.ts`.

In `useTokenStats.test.tsx`, mock `fetchTokenStats` and assert:

- active statistics view loads immediately;
- inactive view performs no request;
- a visible view refreshes after 60 seconds;
- a failed refresh retains the previous snapshot and exposes a notice.

- [ ] **Step 2: Run and verify failure**

Run: `npm test -- --run src/lib/useTokenStats.test.tsx`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Register backend state and command**

Extend `AppState` with `token_stats: token_stats::TokenStatsService`. During setup:

```rust
let sessions_root = dirs::home_dir()
    .unwrap_or_else(|| data_dir.clone())
    .join(".codex")
    .join("sessions");
let token_stats = token_stats::TokenStatsService::new(
    sessions_root,
    data_dir.join("token-stats-index.json"),
);
```

Add:

```rust
#[tauri::command]
async fn get_token_stats(
    granularity: token_stats::StatsGranularity,
    force: bool,
    state: State<'_, AppState>,
) -> Result<token_stats::TokenStatsSnapshot, String> {
    Ok(state.token_stats.snapshot(granularity, force).await)
}
```

Register it in `generate_handler!`.

- [ ] **Step 4: Implement browser mock and hook**

`fetchTokenStats` invokes `get_token_stats`. Browser mode returns deterministic 30/12/12 buckets.

`useTokenStats` stores `snapshot`, `loading`, and `error`; triggers immediately when `active`; starts a 60-second interval only while active; and never clears a successful snapshot on refresh failure.

- [ ] **Step 5: Run bridge and backend tests**

Run: `npm test -- --run src/lib/useTokenStats.test.tsx && cargo test --manifest-path src-tauri/Cargo.toml`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/lib.rs src/types.ts src/lib/tokenStats.ts src/lib/useTokenStats.ts src/lib/useTokenStats.test.tsx
git commit -m "feat: expose local token statistics to react"
```

---

### Task 8: Accessible Token Statistics Card

**Files:**
- Create: `src/components/TokenStatsCard.tsx`
- Create: `src/components/TokenStatsCard.test.tsx`
- Modify: `src/lib/i18n.ts`

**Interfaces:**
- Consumes `TokenStatsSnapshot`, `StatsGranularity`, selected bucket key, preferences, and callbacks.
- Produces user actions for granularity, bucket selection, quota-page switch, refresh, and opening settings.

- [ ] **Step 1: Write failing component tests**

Render an `ok` snapshot and assert:

- three tabs are named `每日`, `每周`, `每月`;
- 30 daily buckets render as 30 buttons;
- the latest valid bucket starts selected;
- clicking a bucket updates total/input/output/cache/task/peak values;
- keyboard Enter/Space selects a focused bar;
- `empty`, `stale`, and `unavailable` copy is correct;
- the disclaimer is always present in successful and stale states.

- [ ] **Step 2: Run and verify failure**

Run: `npm test -- --run src/components/TokenStatsCard.test.tsx`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Add exact localized copy**

Add keys for:

```ts
statsTitle: "CODEX · 本机统计",
statsDaily: "每日",
statsWeekly: "每周",
statsMonthly: "每月",
statsEmpty: "暂无本机 Token 统计",
statsStale: "数据可能已过期",
statsDisclaimer: "仅统计本机可读取的 Codex 日志，可能遗漏云端、其他设备或已删除记录，仅供趋势参考。",
```

Provide concise English equivalents in the same object shape.

- [ ] **Step 4: Implement the card**

Use semantic buttons for tabs and bars. Bar height is:

```ts
const max = Math.max(1, ...snapshot.buckets.map((bucket) => bucket.totals.totalTokens));
const height = `${Math.max(bucket.totals.totalTokens > 0 ? 8 : 2, bucket.totals.totalTokens / max * 100)}%`;
```

Use `Intl.NumberFormat` with compact notation and two significant fractional digits. The selected bucket controls every headline and detail value.

- [ ] **Step 5: Run component tests**

Run: `npm test -- --run src/components/TokenStatsCard.test.tsx`

Expected: PASS, including accessible names containing bucket label and formatted Token total.

- [ ] **Step 6: Commit**

```bash
git add src/components/TokenStatsCard.tsx src/components/TokenStatsCard.test.tsx src/lib/i18n.ts
git commit -m "feat: add accessible token statistics card"
```

---

### Task 9: App Page Switching and Refresh Lifecycle

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/QuotaCard.tsx`
- Modify: `src/lib/bridge.ts`
- Test: `src/lib/widgetWindow.test.ts`
- Test: `src/components/TokenStatsCard.test.tsx`

**Interfaces:**
- Consumes `setWidgetMode`, `useTokenStats`, and preference persistence.
- Quota action changes `expandedView` to `tokenStats`; stats action changes it to `quota`.

- [ ] **Step 1: Add failing integration expectations**

Add tests that assert page-switch buttons call the supplied callback and that stats mode requests logical side 400 while quota mode requests 320.

- [ ] **Step 2: Run and verify failure**

Run: `npm test -- --run src/components/TokenStatsCard.test.tsx src/lib/widgetWindow.test.ts`

Expected: FAIL until callbacks/modes are wired.

- [ ] **Step 3: Wire explicit window modes**

In `App.tsx`:

```ts
const expandedMode = preferences.expandedView === "tokenStats" ? "stats" : "quota";

const handleHover = useCallback((value: boolean) => {
  setHovered(value);
  setCompact(!value);
  if (value) void refresh(true);
  void setWidgetMode(value ? expandedMode : "compact").catch(/* existing notice path */);
}, [expandedMode, refresh]);
```

When switching an already expanded page, persist `expandedView` and immediately call `setWidgetMode(next === "tokenStats" ? "stats" : "quota")`.

- [ ] **Step 4: Render the selected page**

Keep `QuotaCard` unchanged except for a page-switch callback/icon. Render `TokenStatsCard` only when expanded and `expandedView === "tokenStats"`. Call `useTokenStats(!compact && expandedView === "tokenStats", granularity)`.

- [ ] **Step 5: Run all frontend tests**

Run: `npm test -- --run`

Expected: PASS with no quota snapshot regression.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/components/QuotaCard.tsx src/lib/bridge.ts src/components/TokenStatsCard.test.tsx src/lib/widgetWindow.test.ts
git commit -m "feat: switch between quota and token statistics"
```

---

### Task 10: Approved Glass Statistics Styling

**Files:**
- Modify: `src/styles.css`
- Modify: `src/components/DesignPlayground.tsx`
- Test: `src/components/TokenStatsCard.test.tsx`

**Interfaces:**
- Consumes CSS custom properties `--glass-transparency` and `--glass-blur-strength`.
- Produces the approved 400×400 visual without changing quota-card content layout.

- [ ] **Step 1: Add stable class assertions**

Assert the component exposes:

```text
token-stats-card
token-stats-tabs
token-stats-tab--active
token-stats-chart
token-stats-bar--selected
token-stats-suffix
token-stats-disclaimer
```

- [ ] **Step 2: Implement the approved CSS**

Use a transparent card with a masked 2px pseudo-element border. Apply:

```css
.token-stats-card {
  --glass-alpha: .60;
  width: 100%;
  height: 100%;
  min-width: 400px;
  min-height: 400px;
  border-radius: 32px;
  background: linear-gradient(
    145deg,
    rgb(228 244 255 / calc(var(--glass-alpha) * 1)),
    rgb(201 229 248 / calc(var(--glass-alpha) * .78)) 48%,
    rgb(189 215 246 / calc(var(--glass-alpha) * .70))
  );
}

.token-stats-tab--active {
  background: linear-gradient(to bottom, #3779df, rgb(91 171 255 / .72));
}

.token-stats-bar {
  background: linear-gradient(to bottom, #3c7fe7, rgb(103 184 255 / .60));
}

.token-stats-suffix { color: #737b86; }
```

The masked border opacity is `.50`. Interior action buttons, detail rows, and task count remain flat.

- [ ] **Step 3: Add 30/12/12 chart density rules**

Set the chart to CSS grid with `grid-template-columns: repeat(var(--bucket-count), minmax(0, 1fr))`; daily mode uses a smaller gap than weekly/monthly. Hide non-key axis labels visually while retaining accessible names.

- [ ] **Step 4: Add browser design-preview states**

Extend `DesignPlayground` so `npm run dev` can display daily, weekly, monthly, empty, stale, and settings states at 400×400 with the approved parameters.

- [ ] **Step 5: Run build and visual smoke check**

Run: `npm test -- --run && npm run build`

Expected: tests PASS and TypeScript/Vite build succeeds.

Manual: open the design playground against a high-contrast wallpaper and confirm the card remains readable, the `M` is neutral gray, and gradients run dark-top to light-translucent-bottom.

- [ ] **Step 6: Commit**

```bash
git add src/styles.css src/components/DesignPlayground.tsx src/components/TokenStatsCard.test.tsx
git commit -m "style: apply approved token statistics glass design"
```

---

### Task 11: Appearance Sheet and Preference Rollback

**Files:**
- Create: `src/components/AppearanceSheet.tsx`
- Create: `src/components/AppearanceSheet.test.tsx`
- Modify: `src/components/TokenStatsCard.tsx`
- Modify: `src/App.tsx`
- Modify: `src/lib/i18n.ts`

**Interfaces:**
- Consumes preferences and `onSave(nextPreferences): Promise<void>`.
- Produces live CSS preview and persisted values on pointer/key release.

- [ ] **Step 1: Write failing settings tests**

Assert:

- values start at 40/40;
- transparency range is 10–90;
- blur range is 0–60;
- moving a slider updates CSS variables immediately;
- successful save retains the value;
- failed save restores the last saved value and reports an error;
- reset restores 40/40;
- no border-highlight control exists;
- local-data disclaimer is visible.

- [ ] **Step 2: Run and verify failure**

Run: `npm test -- --run src/components/AppearanceSheet.test.tsx`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement controlled sliders**

Keep `draft` and `saved` preference values. Apply:

```tsx
style={{
  "--glass-transparency": draft.glassTransparency,
  "--glass-blur-strength": draft.glassBlurStrength,
  "--glass-alpha": (100 - draft.glassTransparency) / 100,
} as React.CSSProperties}
```

Call `onSave` from `onPointerUp` and keyboard `onKeyUp`; on rejection, set draft back to saved values and show the existing non-blocking operation notice.

- [ ] **Step 4: Wire the sheet into the information action**

The statistics card’s `i` action opens “设置与说明”. Stop pointer-down propagation inside controls so slider use never drags the window.

- [ ] **Step 5: Run settings and frontend tests**

Run: `npm test -- --run src/components/AppearanceSheet.test.tsx src/components/TokenStatsCard.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/AppearanceSheet.tsx src/components/AppearanceSheet.test.tsx src/components/TokenStatsCard.tsx src/App.tsx src/lib/i18n.ts
git commit -m "feat: add glass appearance settings"
```

---

### Task 12: macOS 26 Liquid Glass and Vibrancy Fallback

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/macos_glass.rs`
- Modify: `src-tauri/src/macos_overlay.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/tauri.conf.json`

**Interfaces:**
- Produces `macos_glass::apply(window: &tauri::WebviewWindow, preferences: &WidgetPreferences) -> GlassBackend`.
- `GlassBackend::{LiquidGlass, Vibrancy, CssFallback}` is testable without logging sensitive data.

- [ ] **Step 1: Pin the native dependency**

Add under the macOS target dependencies:

```toml
window-vibrancy = "0.8.0"
```

Confirm `tauri.conf.json` keeps the widget transparent and enables `macOSPrivateApi`.

- [ ] **Step 2: Add pure policy tests**

Test:

```rust
assert_eq!(normalize_radius(40), 40.0);
assert_eq!(normalize_radius(99), 60.0);
assert_eq!(tint_alpha(40), 153);
assert_eq!(legacy_material(0), NSVisualEffectMaterial::Popover);
assert_eq!(legacy_material(40), NSVisualEffectMaterial::HudWindow);
assert_eq!(legacy_material(60), NSVisualEffectMaterial::Sidebar);
```

Implement the exact legacy mapping as `0..=20 → Popover`, `21..=45 → HudWindow`, and `46..=60 → Sidebar`.

- [ ] **Step 3: Implement macOS 26 Liquid Glass**

Follow the pinned crate’s official Tauri WebView integration:

```rust
window.with_webview(move |webview| {
    use window_vibrancy::{apply_liquid_glass, LiquidGlassOptions, NSGlassEffectViewStyle};
    let webview = unsafe { &*webview.inner().cast() };
    let options = LiquidGlassOptions::new(NSGlassEffectViewStyle::Clear)
        .radius(preferences.glass_blur_strength as f64)
        .tint_color((205, 232, 250, tint_alpha(preferences.glass_transparency)))
        .opaque(false)
        .content_view(webview);
    apply_liquid_glass(&window_clone, options)
})
```

Before reapplying, clear the previous Liquid Glass/Vibrancy layer through the crate’s matching clear function.

- [ ] **Step 4: Implement legacy fallback**

If Liquid Glass reports an unsupported platform version, call:

```rust
apply_vibrancy(
    &window,
    legacy_material(preferences.glass_blur_strength),
    Some(NSVisualEffectState::Active),
    Some(32.0),
)
```

If both native paths fail, return `CssFallback`; do not abort startup.

- [ ] **Step 5: Apply on startup and preference changes**

Call native glass after `macos_overlay::configure(app)` and again after successfully persisting new preferences. Emit `preferences-changed` after application. A native failure emits a non-sensitive `glass-effect-status` event and leaves the transparent CSS fallback active.

- [ ] **Step 6: Run Rust tests and macOS build**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`

Expected: PASS.

Run: `npm run tauri build -- --bundles app`

Expected: macOS `.app` build succeeds with the NSPanel and native glass dependency.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/macos_glass.rs src-tauri/src/macos_overlay.rs src-tauri/src/lib.rs src-tauri/tauri.conf.json
git commit -m "feat: apply native macos glass to the widget"
```

---

### Task 13: Privacy, Limitations, Release Documentation, and Full Verification

**Files:**
- Modify: `README.md`
- Modify: `PRIVACY.md`
- Modify: `docs/KNOWN-LIMITATIONS.md`
- Modify: `docs/TEST-MATRIX.md`

**Interfaces:**
- Documents the exact local-data scope and macOS compatibility shipped by Tasks 1–12.

- [ ] **Step 1: Update README**

Add:

- quota/stats page toggle;
- daily 30-day, weekly 12-week, and current-year monthly definitions;
- GitHub install auto-detects each user’s own `~/.codex/sessions`;
- local-only disclaimer;
- macOS 26 Liquid Glass and older Vibrancy distinction;
- App Store sandbox distribution is outside this release.

- [ ] **Step 2: Update privacy and limitations**

State verbatim in both appropriate documents:

```text
Token statistics only parse local token-count records. They may omit cloud,
other-device, deleted, unreadable, or format-changed records. They are trend
estimates, not official billing, account-wide usage, or remaining quota.
Raw session text and statistics are not uploaded.
```

- [ ] **Step 3: Expand the test matrix**

Add manual rows for:

- 30 daily / 12 ISO weekly / 12 monthly buckets;
- cross-midnight and cross-year week behavior;
- append/truncate/delete session files;
- 100/320/400 resize at center, edges, and corners;
- normal and native-fullscreen Spaces;
- Liquid Glass and legacy Vibrancy;
- restart preference restoration;
- statistics failure while quota remains usable.

- [ ] **Step 4: Run the complete automated suite**

Run:

```bash
npm test -- --run
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri build -- --bundles app
```

Expected: every command exits 0.

- [ ] **Step 5: Perform privacy scan**

Run:

```bash
rg -n "prompt|response|message|content|authorization|access_token" src-tauri/src/token_stats
```

Expected: only test names/comments explaining excluded content; no persisted model field or logging statement stores these values.

Run the app, generate one new Codex session, refresh statistics, and inspect the app config cache. Expected: relative session identifiers and numeric aggregates only; no raw JSON or conversation text.

- [ ] **Step 6: Perform macOS acceptance**

Check the app in the screen center, all four edges, all four corners, a second ordinary Space, and another app’s native fullscreen Space. Switch quota ↔ statistics, drag, collapse, reopen, adjust glass, restart, and confirm the last view and 40/40 defaults or saved values restore.

- [ ] **Step 7: Commit**

```bash
git add README.md PRIVACY.md docs/KNOWN-LIMITATIONS.md docs/TEST-MATRIX.md
git commit -m "docs: explain local token statistics and glass support"
```

---

## Final Review Gate

- [ ] Confirm `git status --short` contains no unintended files, especially `.superpowers/`.
- [ ] Review `git diff` from the first implementation commit through the documentation commit.
- [ ] Re-run the four complete verification commands from Task 13.
- [ ] Confirm no test fixture, cache file, session log, account data, or absolute home path is staged.
- [ ] Compare the built 400×400 card with the approved visual: 40% transparency, blur 40, highlight 50%, neutral gray suffix, dark-top/light-translucent-bottom blue gradients, and flat interior elements.
- [ ] Confirm the README and card both display the local-only inaccuracy disclaimer.
