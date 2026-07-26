# Compact Statistics Range Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make TokenHalo show real last-seven-day statistics and label the three local-statistics tabs as last 7 days, last 12 weeks, and this year.

**Architecture:** Keep the existing `StatsGranularity` protocol (`day`, `week`, `month`) intact. Rust changes only the `day` period-key count from 30 to 7, while React receives new localized labels through the existing i18n keys. Existing chart, cache, aggregation, and tab-selection flows remain unchanged.

**Tech Stack:** Rust 2021, Chrono, Tauri 2, React 19, TypeScript 5.9, Vitest, Testing Library.

## Global Constraints

- `day` returns the last 7 consecutive local calendar dates, including today as the rightmost bucket.
- `week` continues to return the last 12 Monday-start ISO weeks, including the current week.
- `month` continues to return January through December of the current local calendar year.
- Keep `StatsGranularity` wire values, cache keys, refresh behavior, aggregation rules, and visual card dimensions unchanged.
- Use exact labels: `近 7 日` / `Last 7 days`, `近 12 周` / `Last 12 weeks`, and `今年` / `This year`.
- Use test-driven development. Do not rebuild app or DMG bundles in this fast UI pass.

---

## File Structure

- `src-tauri/src/token_stats/periods.rs` — period-key generation and range invariants.
- `src-tauri/src/token_stats/mod.rs` — empty day-snapshot bucket-count contract.
- `src/lib/i18n.ts` — localized range labels consumed by tab and chart copy.
- `src/components/TokenStatsCard.test.tsx` — observable localized tab/chart labels and seven-bar daily density.
- `src/App.test.tsx` and `src/App.tokenStatsIntegration.test.tsx` — existing tab interactions updated to the new accessible labels.
- `src/components/DesignPlayground.tsx` — QA preview labels that disclose the actual 7/12/12 density.
- `README.md`, `docs/KNOWN-LIMITATIONS.md`, and `docs/TEST-MATRIX.md` — current public behavior and test-matrix copy.

---

### Task 1: Return Seven Local-Day Buckets

**Files:**
- Modify: `src-tauri/src/token_stats/periods.rs:18-31,168-216`
- Modify: `src-tauri/src/token_stats/mod.rs:270-282`

**Interfaces:**
- Consumes: `StatsGranularity::Day`.
- Produces: seven chronological `TokenStatsBucket` values whose first date is six days before local today and whose last date is local today.

- [ ] **Step 1: Write the failing Rust range tests**

Change the day-count assertions and add independently derived boundary assertions:

```rust
let keys = period_keys(StatsGranularity::Day, now);
assert_eq!(keys.len(), 7);
assert_eq!(keys.first().unwrap().key, "2026-07-17");
assert_eq!(keys.last().unwrap().key, "2026-07-23");
```

In the DST and empty-snapshot tests, change the expected day length from `30` to `7` and assert there are seven distinct local dates. In `token_stats/mod.rs`, change the empty day snapshot expectation to `7`.

- [ ] **Step 2: Run the focused Rust tests and verify RED**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml token_stats::periods::tests -- --nocapture
```

Expected: FAIL because the production day range still produces 30 buckets.

- [ ] **Step 3: Implement the smallest range change**

In `period_keys`, replace only the day iterator:

```rust
StatsGranularity::Day => (0..7)
    .rev()
    .map(|days_ago| {
        let date = today - Duration::days(days_ago);
        period_key(
            date,
            date + Duration::days(1),
            date.format("%Y-%m-%d").to_string(),
            date.format("%m-%d").to_string(),
            now.timezone(),
        )
    })
    .collect(),
```

Do not change week/month branches or any cache identity.

- [ ] **Step 4: Run focused Rust tests and verify GREEN**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml token_stats::periods::tests -- --nocapture
cargo test --manifest-path src-tauri/Cargo.toml token_stats::tests::missing_session_root_returns_empty_snapshot -- --nocapture
```

Expected: PASS; day range has exactly seven chronological dates, and empty day snapshots have seven zero buckets.

- [ ] **Step 5: Commit the Rust range contract**

```bash
git add src-tauri/src/token_stats/periods.rs src-tauri/src/token_stats/mod.rs
git commit -m "feat: show seven days of token statistics"
```

### Task 2: Localize Range Tabs and Update Current Documentation

**Files:**
- Modify: `src/lib/i18n.ts:78-98,169-189`
- Modify: `src/components/TokenStatsCard.test.tsx:40-70,410-620,760-785`
- Modify: `src/App.test.tsx` and `src/App.tokenStatsIntegration.test.tsx` tab-name expectations
- Modify: `src/components/DesignPlayground.tsx:66-70`
- Modify: `README.md:53-55`
- Modify: `docs/KNOWN-LIMITATIONS.md:11`
- Modify: `docs/TEST-MATRIX.md:17-19,51`

**Interfaces:**
- Consumes: existing `copy[language].statsDaily`, `statsWeekly`, and `statsMonthly` strings.
- Produces: localized tab names and matching chart accessible labels without changing tab `StatsGranularity` values.

- [ ] **Step 1: Write the failing frontend behavior test**

Update the existing statistics-card fixture to seven day buckets and add a focused Chinese/English assertion:

```tsx
function ControlledCard({
  value = snapshot(),
  language = preferences.language,
}: {
  value?: TokenStatsSnapshot;
  language?: WidgetPreferences["language"];
}) {
  // Preserve the existing stateful granularity/key helper and pass:
  // preferences={{ ...preferences, language }}
}

it.each([
  ["zh-CN", ["近 7 日", "近 12 周", "今年"], "近 7 日 Token 图表"],
  ["en", ["Last 7 days", "Last 12 weeks", "This year"], "Last 7 days Token chart"],
] as const)("renders localized range tabs for %s", (language, labels, chartLabel) => {
  render(<ControlledCard value={snapshot()} language={language} />);
  labels.forEach((label) => expect(screen.getByRole("button", { name: label })).toBeVisible());
  expect(screen.getByRole("group", { name: chartLabel })).toBeVisible();
});
```

Make the daily visual-density assertions expect seven bars and the selected final `7/7` fixture instead of thirty bars and `7/30`. Update existing interaction expectations from `每周` to `近 12 周`.

- [ ] **Step 2: Run the focused frontend test and verify RED**

Run:

```bash
npm test -- --run src/components/TokenStatsCard.test.tsx
```

Expected: FAIL because i18n still exposes `每日`/`每周`/`每月` and the fixture still represents thirty daily bars.

- [ ] **Step 3: Implement labels and supporting fixture/documentation updates**

Set i18n values exactly:

```ts
// zh-CN
statsDaily: "近 7 日",
statsWeekly: "近 12 周",
statsMonthly: "今年",

// en
statsDaily: "Last 7 days",
statsWeekly: "Last 12 weeks",
statsMonthly: "This year",
```

Keep `TokenStatsCard` mapping to the same three `StatsGranularity` values. Change the DesignPlayground options to `Last 7 days · 7`, `Last 12 weeks · 12`, and `This year · 12`. Update current docs to say 7/12/current-year and update the visual matrix density from `30/12/12` to `7/12/12`.

- [ ] **Step 4: Run focused frontend tests and verify GREEN**

Run:

```bash
npm test -- --run src/components/TokenStatsCard.test.tsx src/App.test.tsx src/App.tokenStatsIntegration.test.tsx
```

Expected: PASS; accessible tab names, chart labels, seven-bar daily density, tab interaction, and existing statistics loading behavior all pass.

- [ ] **Step 5: Run the fast verification set**

Run:

```bash
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml
git diff --check
```

Expected: each command exits 0. Do not run `npm run tauri build` or produce new bundles.

- [ ] **Step 6: Commit the UI and documentation change**

```bash
git add src/lib/i18n.ts src/components/TokenStatsCard.test.tsx src/App.test.tsx src/App.tokenStatsIntegration.test.tsx src/components/DesignPlayground.tsx README.md docs/KNOWN-LIMITATIONS.md docs/TEST-MATRIX.md
git commit -m "feat: label compact token statistic ranges"
```
