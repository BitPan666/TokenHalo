# Privacy

TokenHalo is designed to be local-first and minimal.

## What It Reads

- The app reads the local Codex Desktop login file from `CODEX_HOME/auth.json` or the user's `.codex/auth.json`.
- The app sends the existing Codex access token only to the ChatGPT quota endpoints needed to read Codex usage.
- The app may read the account identifier from the login file or token payload only to set the request header expected by the Codex usage service.
- The local statistics feature automatically scans Token-count records in the current user's `~/.codex/sessions`.
- The statistics parser reads timestamps and numeric Token counters needed for aggregation. Prompt text, response text, code, and file contents are outside its persisted data model.

## What It Stores

TokenHalo stores widget preferences in its own application config directory:

- locked state
- always-on-top state
- pinned provider
- auto-rotate interval
- language and last expanded page
- glass transparency and blur strength

The same application config directory also contains a local statistics index. The index contains relative session identifiers, file size and modification fingerprints, byte cursors, numeric cumulative parser state, aggregate totals, cache version, timezone, and update metadata. It does not contain raw JSONL records, prompt or response text, code, Codex tokens, account IDs, raw quota responses, or the absolute `~/.codex/sessions` root.

## What It Sends

The app only calls these quota-related HTTPS endpoints from the local desktop process:

- `https://chatgpt.com/backend-api/wham/usage`
- `https://chatgpt.com/backend-api/wham/rate-limit-reset-credits`

Local Token statistics and their cache are not uploaded. No telemetry, analytics, crash reporting, or third-party tracking is included.

## Logging

Logs are intentionally generic. They must not include tokens, account IDs, raw backend responses, request headers, local auth paths, or personal file paths.

## Accuracy Boundary

TokenHalo displays remaining-quota windows returned by the Codex usage service. It does not calculate remaining quota from local Token statistics and does not fabricate values when the response shape is unknown.

The local statistics boundary is:

```text
Token statistics only parse local token-count records. They may omit cloud,
other-device, deleted, unreadable, or format-changed records. They are trend
estimates, not official billing, account-wide usage, or remaining quota.
Raw session text and statistics are not uploaded.
```
