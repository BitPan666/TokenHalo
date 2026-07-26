# TokenHalo Adaptive Usage Card and Shared Shell Design

**Date:** 2026-07-25  
**Status:** Approved direction, pending written-spec review

## Problem

TokenHalo currently assumes that the quota response's `primary_window` is
always a five-hour window and labels it accordingly. That assumption is false
for the currently tested `PROLITE` account: its live response contains one
`604800`-second window, resets after seven days, and has no secondary window.
The UI therefore shows a misleading “5 小时剩余” label above a seven-day value.

The expanded remaining-usage card and the local Token statistics card also use
different surface backgrounds, header structures, action sets, icon sizing,
and copy hierarchy. Switching pages feels like moving between two separate
products.

## Goals

- Determine the displayed usage period from response data, not from
  `primary_window` or `secondary_window` names alone.
- Show five-hour, one-week, or unknown-period copy only when supported by the
  actual parsed duration.
- Avoid empty or duplicated secondary metrics when an account returns only one
  usage window.
- Keep the remaining-usage card's current 320×320 content structure.
- Keep the Token statistics card's current 400×400 content structure.
- Give both expanded cards the Token statistics card's blue glass background,
  border treatment, title hierarchy, and action styling.
- Give both cards the same ordered action set, using Phosphor icons.
- Keep all action labels, tooltips, status messages, and page copy localized.

## Non-goals

- Do not merge the remaining-usage and Token statistics content into one page.
- Do not force both cards to use the same dimensions.
- Do not change the 100×100 collapsed orb in this work.
- Do not infer official usage from local Token statistics.
- Do not change account settings, redeem reset credits, or fabricate missing
  usage windows.
- Do not rename or publish the GitHub repository as part of this UI work.

## Evidence and Source-of-truth Rule

The current official Codex pricing documentation still describes five-hour
shared usage windows for several plans and notes that additional weekly limits
may apply. The currently tested `PROLITE` response instead contains:

- plan: `PROLITE`;
- one primary window with `window_seconds = 604800`;
- no secondary window.

TokenHalo must therefore treat the response's numeric window duration as the
source of truth for presentation. Key names are compatibility hints only.

## Adaptive Window Classification

### Recognized durations

Use a small tolerance for service-side rounding:

- `18000 ± 60` seconds: five-hour window;
- `604800 ± 60` seconds: one-week window;
- any other positive duration: custom current-period window;
- missing or zero duration: unknown current-period window.

### Window selection

Parse all candidate windows before assigning display roles.

1. Deduplicate candidates that describe the same duration and reset time.
2. If both recognized five-hour and one-week windows exist:
   - show the five-hour window as the large primary metric;
   - show the one-week window as the secondary metric.
3. If only a one-week window exists:
   - show it as the large primary metric;
   - omit the secondary window block.
4. If only a five-hour window exists:
   - show it as the large primary metric;
   - omit the secondary window block.
5. If only an unrecognized-duration window exists:
   - show it as the large primary metric with generic current-period copy.
6. If multiple unrecognized windows exist:
   - preserve stable response order;
   - show the first as primary and the next non-duplicate as secondary;
   - use duration-derived labels when possible and generic labels otherwise.
7. If no usable window exists, retain the safe unavailable state and never
   invent a remaining percentage.

The parser may continue accepting legacy direct keys and array-based window
collections, but direct keys must not bypass duration classification.

## Dynamic Copy

Chinese labels:

- five-hour primary: `5 小时额度剩余`;
- one-week primary: `一周额度剩余`;
- custom positive duration: `{N} 小时额度剩余` or `{N} 天额度剩余` when the
  duration divides cleanly;
- unknown duration: `当前周期额度剩余`;
- one-week secondary: `一周额度剩余`;
- generic secondary: `较长周期额度剩余`.

English labels:

- `5-hour usage remaining`;
- `Weekly usage remaining`;
- `{N}-hour usage remaining` or `{N}-day usage remaining`;
- `Current-period usage remaining`;
- `Longer-period usage remaining`.

The reset line remains derived from the returned reset timestamp. A seven-day
rolling window must not be described as a calendar week ending on Sunday.

For the tested `PROLITE` response, the main card must display:

- `一周额度剩余`;
- the returned remaining percentage;
- the returned reset countdown/date;
- no empty second-window percentage.

## Shared Expanded-card Surface

The remaining-usage card keeps its current:

- 320×320 size;
- large percentage;
- horizontal progress bar;
- reset countdown;
- reset-credit information;
- status and error states.

Its expanded background changes to the same blue glass surface as the Token
statistics card:

- same cool blue gradient;
- same glass alpha and blur variables;
- same two-pixel masked highlight border;
- same ink and muted-text colors;
- same focus-ring language.

Quota health may continue to affect progress-bar color and status indicators,
but it must no longer replace the expanded card's shared background. The
collapsed orb remains unchanged.

## Shared Header and Action Bar

Create a reusable expanded-card header/chrome component instead of duplicating
action markup and CSS.

### Header copy

Remaining usage:

- title: `CODEX · 剩余额度` / `CODEX · Remaining usage`;
- subtitle: `{PLAN} · 更新于 {time}` / `{PLAN} · Updated {time}` when a plan is
  available;
- omit the plan prefix cleanly when unavailable.

Token statistics:

- title: `CODEX · 本机统计` / `CODEX · Local statistics`;
- subtitle: `{PLAN} · 更新于 {time}` / `{PLAN} · Updated {time}` when a plan is
  available;
- otherwise use only the updated-time copy.

### Ordered controls

Both expanded cards use this exact order:

1. status dot;
2. refresh icon — `ArrowClockwise`;
3. page switch icon — `ChartBar` when opening Token statistics and `Gauge`
   when returning to remaining usage;
4. language icon — `Translate`;
5. always-on-top icon — `PushPin` / `PushPinSlash`;
6. settings icon — `GearSix`.

The status dot remains a status indicator rather than a button. Every button
uses the current Phosphor icon library; the UI must not display placeholder
letters such as `刷`, `页`, `EN`, `中`, `顶`, or `设`.

### Interaction rules

- Refresh always invokes the active page's refresh operation.
- Refresh is available in success, stale, unavailable, and signed-out states
  unless a refresh is already running.
- Page switch preserves the existing saved expanded-view behavior.
- Language changes apply to both pages and all settings/error copy.
- Always-on-top uses the same saved preference and icon state on both pages.
- Settings opens the existing appearance/information sheet from either page.
- Buttons expose localized accessible names and tooltips.
- Buttons use a shared disabled, hover, active, and focus-visible treatment.
- The 320px header must fit without wrapping or hiding the title. The status dot
  is compact and the icon buttons use the smallest shared size that preserves a
  practical hit target.

## Component Boundaries

Add a focused shared component named `CardChrome` that owns:

- the shared title/subtitle structure;
- the status indicator;
- ordered action rendering;
- action tooltips and accessible labels.

Keep page-specific state and callbacks in `App`:

- remaining-usage refresh and snapshot status;
- Token statistics refresh and snapshot status;
- page switching;
- language mutation;
- always-on-top mutation;
- settings open/close state.

Use shared CSS surface and action classes for both cards. Keep the quota metric,
Token chart, reset-credit popover, statistics tabs, and statistics breakdown in
their existing page components.

## Error and Localization Behavior

- Do not expose raw English backend messages in a Chinese UI.
- Replace user-facing `Quota service` copy with localized `Codex 用量服务` /
  `Codex usage service` wording.
- Preserve safe generic messages; do not expose response bodies, tokens,
  account identifiers, or local auth paths.
- A failed refresh keeps the last valid values as stale when available.
- A first-load failure shows the shared unavailable state and retains the
  header refresh action.
- Unknown response shapes remain unavailable instead of being guessed.

## Testing

### Rust

- Classifies a five-hour window by duration even when it arrives under an
  unexpected key.
- Classifies a one-week window by duration even when it arrives as
  `primary_window`.
- Handles five-hour plus weekly windows.
- Handles weekly-only and five-hour-only responses without duplicates.
- Handles custom and missing durations with generic semantics.
- Preserves unavailable behavior when no valid window can be parsed.

### TypeScript and React

- Formats Chinese and English labels for recognized, custom, and unknown
  periods.
- Both cards render the same ordered control set and localized accessible
  names.
- Both cards dispatch refresh, page switch, language, always-on-top, and
  settings callbacks correctly.
- The language control renders `Translate`, not text.
- The quota unavailable state still exposes header refresh.
- The quota card omits the secondary block when no secondary window exists.
- Existing quota values, reset credits, Token charts, settings persistence,
  hover expansion, and page switching remain covered.

### Visual verification

Capture and compare:

- remaining usage at 320×320;
- Token statistics at 400×400;
- both pages in Chinese and English;
- success, stale, unavailable, and signed-out headers;
- pinned and unpinned states;
- appearance sheet opened from each page.

The final comparison must confirm matching backgrounds, border radii, header
alignment, icon order, icon styling, title hierarchy, and focus treatment while
preserving each page's distinct content density.

## Acceptance Criteria

- A live `604800`-second-only response is shown as one-week remaining usage,
  never as five-hour remaining usage.
- A live `18000`-second response can still be presented accurately for plans
  that use five-hour limits.
- No empty weekly value is shown when the service returns only one window.
- Both expanded pages share the same surface and header/action system.
- All right-side actions use real Phosphor icons.
- Both pages expose refresh, page switch, language, always-on-top, and settings.
- Existing local Token statistics, settings, migration, and collapsed-orb
  behavior remain intact.
