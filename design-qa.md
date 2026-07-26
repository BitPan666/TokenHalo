# TokenHalo Shared-Shell Design QA

## Comparison target

- Source visual truth: `.superpowers/brainstorm/1731-1784978982/content/shared-shell-target.html`
- Source full-view evidence: `design-qa-evidence/source-full-1000.png`
- Source quota evidence: `design-qa-evidence/source-quota-320.png`
- Source statistics evidence: `design-qa-evidence/source-stats-400.png`
- Source focused headers: `design-qa-evidence/source-quota-header.png` and `design-qa-evidence/source-stats-header.png`
- Final implementation quota evidence: `design-qa-evidence/implementation-quota-success-zh-pinned-320.png`
- Final implementation statistics evidence: `design-qa-evidence/implementation-stats-success-zh-400-iteration-2.png`
- Final implementation focused headers: `design-qa-evidence/implementation-quota-success-zh-header.png` and `design-qa-evidence/implementation-stats-success-zh-header-iteration-2.png`
- Browser: the requested Codex in-app browser backend was unavailable after the documented setup and troubleshooting pass. Browser discovery exposed Chrome only; the parent task then explicitly approved Chrome as the local-only fallback. No deployment or publication occurred.

## Dimensions and normalization

| Evidence | Browser viewport | CSS capture | PNG pixels | Density |
| --- | --- | --- | --- | --- |
| Source canvas | 1000×900 | full page | 1000×924 | device scale factor 1 |
| Source quota | 1000×900 canvas | 320×320 card | 320×320 | 1:1 |
| Implementation quota | 320×320 | 320×320 card | 320×320 | 1:1 |
| Source statistics | 1000×900 canvas | 400×400 card | 400×400 | 1:1 |
| Implementation statistics | 400×400 | 400×400 card | 400×400 | 1:1 |
| Source quota header | 1000×900 canvas | 276×34 | 276×34 | 1:1 |
| Implementation quota header | 320×320 | 278×38 | 278×38 | 1:1 |
| Source statistics header | 1000×900 canvas | 356×34 | 356×34 | 1:1 |
| Implementation statistics header | 400×400 | 352×38 | 352×38 | 1:1 |

The card regions were compared at equal CSS and pixel dimensions. The source canvas includes its surrounding review frame, so card and header crops, rather than browser chrome or canvas padding, are the fidelity evidence.

## State and full-view evidence

- Quota match: Chinese, signed-in success, five-hour primary plus weekly secondary, pinned, 74%, 320×320. Source and implementation preserve the same title/subtitle hierarchy, progress treatment, divider, reset-credit content, and square card composition.
- Adaptive quota safety: `implementation-quota-weekly-en-320.png` shows weekly usage as the 64% primary with no secondary filler. `implementation-quota-stale-en-320.png`, `implementation-quota-unavailable-en-320.png`, and `implementation-quota-signed-out-en-320.png` show the required safety states without overlap.
- Statistics match: Chinese, success, daily tab, pinned, 400×400. The implementation intentionally retains the production 30-bucket chart, four-part breakdown, task count, and disclaimer rather than replacing them with the source mock's simplified six-bar body.
- Statistics unavailable: `implementation-stats-unavailable-zh-400.png`.
- Language and pin states: `implementation-quota-success-en-pinned-320.png`, `implementation-quota-success-zh-unpinned-320.png`, `implementation-stats-success-zh-unpinned-400.png`, and `implementation-stats-success-en-unpinned-400.png`.
- Settings: `implementation-quota-settings-zh-320.png` and `implementation-stats-settings-zh-400.png`.

## Focused header comparison

- Both final headers use the required order: status, refresh, page switch, language, pin, settings.
- Both implementation headers use Phosphor icons. The source uses abbreviated text glyphs as a directional mock; the production icon treatment is the required intentional replacement.
- The masked border, status glow, two-line title/subtitle hierarchy, and circular glass controls remain visually consistent across quota and statistics.
- Quota uses the compact 18px control treatment needed to fit the complete English title and all controls at 320px. Statistics retains larger controls at 400px. The English statistics title ellipsizes visually, while its accessible name remains complete; this is recorded as P3 follow-up polish, not a blocking mismatch.

## Required fidelity surfaces

- Fonts and typography: both use a compact system display sans treatment with bold numeric metrics, small muted subtitles, tabular figures, and consistent optical hierarchy. No wrapping or overlap occurs at 320px. The residual English statistics-title ellipsis is P3.
- Spacing and layout: quota and statistics retain exact 320×320 and 400×400 frames. Padding, progress/chart regions, dividers, settings sheets, radii, and vertical rhythm remain intact. Production statistics is denser than the simplified source body by design because existing chart and breakdown behavior must be preserved.
- Colors and tokens: both pages use the shared cool-blue translucent gradient, masked white/blue border, green synced status, blue active/progress accents, and semantic stale/error colors. The statistics screenshot shows more desktop-background color through the translucent surface than the white-backed source canvas; the underlying shared tokens match.
- Image and icon fidelity: the source has no photographic or illustrative image target. Production uses Phosphor vector icons for every header action and retains the existing provider mark. No emoji, text-symbol, CSS-drawn, or substitute header icons remain.
- Copy and content: current TokenHalo/Codex copy is localized; weekly-only copy is truthful; unavailable and signed-out messages are safe; no secondary percentage is invented. Quota metric/reset credits and statistics tabs/chart/breakdown/disclaimer remain present.

## Interaction and console checks

- Opened and closed settings from quota and statistics; both sheets remained readable and focus returned to the triggering control.
- Switched quota to statistics and confirmed the active-page refresh remained enabled.
- Switched both pages between Chinese and English.
- Toggled always-on-top and confirmed pinned/unpinned action state.
- Confirmed the unavailable-quota refresh control was enabled and clickable.
- Confirmed daily/weekly/monthly controls, chart bars, metric breakdown, and reset-credit controls remained present in the browser-rendered DOM.
- Browser console check after the final implementation flow: zero error or warning entries from `http://127.0.0.1:1421/`. Chrome-extension warnings/errors were excluded as unrelated to the app.

## Comparison history

### Iteration 1

- Finding: **P2 — synthetic preview badge obscured the statistics header.**
- Evidence: `design-qa-evidence/implementation-stats-success-zh-400.png` and `design-qa-evidence/implementation-stats-success-zh-header.png`.
- Impact: the 400px screenshot could not faithfully prove title or icon fidelity.
- Regression-first fix: changed the screenshot playground to mark synthetic data with `data-preview-kind="synthetic"` rather than visible overlay copy, and added a test that failed before the implementation change and passed afterward.

### Iteration 2

- Post-fix evidence: `design-qa-evidence/implementation-stats-success-zh-400-iteration-2.png` and `design-qa-evidence/implementation-stats-success-zh-header-iteration-2.png`.
- Result: the title, status, and five action icons are unobscured. Same-viewport recapture found no remaining P0, P1, or P2 difference.
- Additional browser-verification support: added a regression-tested `stats-unavailable` playground state so the required 400×400 unavailable capture uses the real `TokenStatsCard`.

## Findings

- No actionable P0, P1, or P2 findings remain.
- P3: the English statistics title ellipsizes at 400px to preserve the full icon row and practical control sizes. Accessible copy is complete, and no controls overlap.
- Evidence limit: the requested in-app browser backend was unavailable; Chrome was used only after explicit fallback approval. Native macOS glass appearance still depends on the desktop compositor and is not fully represented by a browser screenshot.

final result: passed
