# TokenHalo Renaming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the current application to TokenHalo across runtime identity, package metadata, documentation, artifacts, and repository links while preserving supported TokenHalo preferences and Token statistics cache data.

**Architecture:** Introduce one focused Rust migration module that copies an allowlisted set of legacy configuration files into the new Tauri Bundle ID directory before existing loaders run. Keep branding changes separate from quota-domain concepts, then update manifests, runtime strings, documentation, workflows, and tests in reviewable commits. Rename the GitHub repository only after local verification and a separate user approval.

**Tech Stack:** Tauri 2, Rust 2021, React 19, TypeScript 5, Vite 7, Vitest 3, GitHub Actions.

## Global Constraints

- Canonical product name: `TokenHalo`.
- Canonical subtitle: `Codex Usage Monitor`.
- npm and Rust package name: `tokenhalo`.
- Rust library crate: `tokenhalo_lib`.
- Tauri Bundle ID: `app.tokenhalo.desktop`.
- GitHub repository target: `change-42-yhmm/tokenhalo`.
- Artifact names: `tokenhalo-windows-unsigned.zip` and `tokenhalo-macos-universal-unsigned.zip`.
- Preserve application version `0.1.3`; a version bump is outside this plan.
- Preserve functional `quota` names such as `QuotaCard`, quota fields, quota endpoints, and quota tests.
- Preserve the original MIT `TokenHalo contributors` copyright line and add a TokenHalo contributors line.
- Permit the old brand only in legal attribution, legacy migration constants/tests, Git history, and the approved rename spec.
- Do not delete or modify the legacy application directory during migration.
- Do not redesign icons, screenshots, layout, colors, or application behavior.
- Do not rename the GitHub repository until the user explicitly approves that external change.
- Execute on branch `codex/tokenhalo-rename` in a clean worktree created from the commit containing this plan; do not modify the current dirty main worktree, its deleted `src-tauri/Cargo.lock`, `.superpowers/`, or its broken legacy `.worktrees`.

---

## File Structure

### Create

- `src-tauri/src/brand_migration.rs` — allowlisted, idempotent legacy configuration migration and unit tests.

### Modify

- `src-tauri/src/lib.rs` — register and invoke migration; update tray, User-Agent, and runtime product strings.
- `src-tauri/src/config_contract.rs` — assert canonical TokenHalo Tauri metadata.
- `src-tauri/src/main.rs` — call `tokenhalo_lib::run()`.
- `src-tauri/src/macos_overlay.rs` — rename the native panel type.
- `src-tauri/Cargo.toml` — rename Rust package and library.
- `src-tauri/Cargo.lock` — rename the root package entry.
- `src-tauri/tauri.conf.json` — update product name, Bundle ID, descriptions, title, and copyright.
- `package.json` and `package-lock.json` — update npm project identity.
- `index.html` — update document title.
- `src/components/DesignPlayground.tsx` — update the design-preview brand label.
- `vite.config.ts` — exclude `.worktrees/**` from Vitest discovery.
- `.github/workflows/ci.yml` and `.github/workflows/release.yml` — update artifact/archive names.
- `.github/ISSUE_TEMPLATE/bug_report.yml` and `.github/ISSUE_TEMPLATE/feature_request.yml` — update current product copy.
- `README.md`, `CONTRIBUTING.md`, `PRIVACY.md`, `SECURITY.md`, `LICENSE` — update public identity and attribution.
- `docs/GITHUB-RELEASE-CHECKLIST.md`, `docs/PROJECT-SUMMARY.md`, `docs/RELEASE.md`, `docs/RELEASE_TEMPLATE.md`, `docs/TEST-MATRIX.md` — update current release and product documentation.
- Historical tracked plans/specs returned by the legacy-brand audit — update current-product references without changing technical history.

---

### Task 1: Create the legacy configuration migration

**Files:**
- Create: `src-tauri/src/brand_migration.rs`
- Modify: `src-tauri/src/lib.rs:1-10`
- Test: `src-tauri/src/brand_migration.rs`

**Interfaces:**
- Consumes: a platform configuration root from `app.path().config_dir()` and the TokenHalo `app_config_dir`.
- Produces:

```rust
pub(crate) const LEGACY_IDENTIFIER: &str = "app.tokenhalo.desktop";

#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct MigrationReport {
    pub(crate) migrated: usize,
    pub(crate) failed: usize,
}

pub(crate) fn migrate_legacy_config(
    config_root: &std::path::Path,
    destination_dir: &std::path::Path,
) -> MigrationReport;
```

- [ ] **Step 1: Register the module and write failing migration tests**

Add this declaration near the other modules in `src-tauri/src/lib.rs`:

```rust
mod brand_migration;
```

Create `src-tauri/src/brand_migration.rs` with the interface above and tests covering copy, non-overwrite, idempotence, and partial failure:

```rust
pub(crate) fn migrate_legacy_config(
    _config_root: &std::path::Path,
    _destination_dir: &std::path::Path,
) -> MigrationReport {
    MigrationReport::default()
}

#[cfg(test)]
mod tests {
    use std::fs;
    use tempfile::tempdir;

    use super::{migrate_legacy_config, LEGACY_IDENTIFIER};

    #[test]
    fn copies_allowlisted_files_without_removing_legacy_data() {
        let root = tempdir().unwrap();
        let legacy = root.path().join(LEGACY_IDENTIFIER);
        let destination = root.path().join("app.tokenhalo.desktop");
        fs::create_dir_all(&legacy).unwrap();
        fs::write(legacy.join("preferences.json"), br#"{"language":"zh-CN"}"#).unwrap();
        fs::write(legacy.join("token-stats-index.json"), br#"{"version":1}"#).unwrap();

        let report = migrate_legacy_config(root.path(), &destination);

        assert_eq!(report.migrated, 2);
        assert_eq!(report.failed, 0);
        assert_eq!(
            fs::read(destination.join("preferences.json")).unwrap(),
            br#"{"language":"zh-CN"}"#
        );
        assert!(legacy.join("preferences.json").exists());
        assert!(legacy.join("token-stats-index.json").exists());
    }

    #[test]
    fn never_overwrites_existing_tokenhalo_files() {
        let root = tempdir().unwrap();
        let legacy = root.path().join(LEGACY_IDENTIFIER);
        let destination = root.path().join("app.tokenhalo.desktop");
        fs::create_dir_all(&legacy).unwrap();
        fs::create_dir_all(&destination).unwrap();
        fs::write(legacy.join("preferences.json"), b"legacy").unwrap();
        fs::write(destination.join("preferences.json"), b"current").unwrap();

        let report = migrate_legacy_config(root.path(), &destination);

        assert_eq!(report.migrated, 0);
        assert_eq!(report.failed, 0);
        assert_eq!(fs::read(destination.join("preferences.json")).unwrap(), b"current");
    }

    #[test]
    fn repeated_migration_is_idempotent() {
        let root = tempdir().unwrap();
        let legacy = root.path().join(LEGACY_IDENTIFIER);
        let destination = root.path().join("app.tokenhalo.desktop");
        fs::create_dir_all(&legacy).unwrap();
        fs::write(legacy.join("preferences.json"), b"legacy").unwrap();

        assert_eq!(migrate_legacy_config(root.path(), &destination).migrated, 1);
        assert_eq!(migrate_legacy_config(root.path(), &destination).migrated, 0);
        assert_eq!(fs::read(destination.join("preferences.json")).unwrap(), b"legacy");
    }

    #[test]
    fn one_failed_source_does_not_block_other_files() {
        let root = tempdir().unwrap();
        let legacy = root.path().join(LEGACY_IDENTIFIER);
        let destination = root.path().join("app.tokenhalo.desktop");
        fs::create_dir_all(legacy.join("preferences.json")).unwrap();
        fs::write(legacy.join("token-stats-index.json"), b"index").unwrap();

        let report = migrate_legacy_config(root.path(), &destination);

        assert_eq!(report.migrated, 1);
        assert_eq!(report.failed, 1);
        assert_eq!(
            fs::read(destination.join("token-stats-index.json")).unwrap(),
            b"index"
        );
    }
}
```

- [ ] **Step 2: Run the focused Rust tests and verify the red state**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml brand_migration
```

Expected: FAIL because `migrate_legacy_config` has no implementation.

- [ ] **Step 3: Implement allowlisted, atomic, non-destructive copying**

Implement only these names:

```rust
const MIGRATED_FILES: [&str; 4] = [
    "preferences.json",
    "preferences.json.bak",
    "token-stats-index.json",
    "token-stats-index.json.bak",
];
```

Use a private helper with this signature:

```rust
fn copy_if_missing(source: &Path, destination: &Path) -> std::io::Result<bool>;
```

The helper must:

1. return `Ok(false)` when the source does not exist or the destination already exists;
2. create the TokenHalo directory when required;
3. read the legacy bytes without modifying the source;
4. write and `sync_all()` a same-directory temporary file named with the current process ID;
5. re-check destination absence before renaming;
6. remove only its own temporary file on failure;
7. never log paths or file contents.

Use a fully written and synced temporary file plus an atomic no-clobber hard link so a destination created concurrently is never overwritten:

```rust
use std::{
    fs::{self, OpenOptions},
    io::{self, Write},
    path::Path,
};

fn copy_if_missing(source: &Path, destination: &Path) -> io::Result<bool> {
    if destination.exists() || !source.exists() {
        return Ok(false);
    }
    let parent = destination
        .parent()
        .ok_or_else(|| io::Error::other("migration destination has no parent"))?;
    fs::create_dir_all(parent)?;
    let file_name = destination
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| io::Error::other("migration destination has no file name"))?;
    let temporary = parent.join(format!(
        ".{file_name}.migration-{}.tmp",
        std::process::id()
    ));
    let bytes = fs::read(source)?;
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temporary)?;
    if let Err(error) = file.write_all(&bytes).and_then(|_| file.sync_all()) {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    drop(file);
    let result = match fs::hard_link(&temporary, destination) {
        Ok(()) => Ok(true),
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => Ok(false),
        Err(error) => Err(error),
    };
    let _ = fs::remove_file(temporary);
    result
}
```

The public function loops over all four allowlisted files and returns counts:

```rust
pub(crate) fn migrate_legacy_config(
    config_root: &Path,
    destination_dir: &Path,
) -> MigrationReport {
    let legacy_dir = config_root.join(LEGACY_IDENTIFIER);
    let mut report = MigrationReport::default();
    for name in MIGRATED_FILES {
        match copy_if_missing(&legacy_dir.join(name), &destination_dir.join(name)) {
            Ok(true) => report.migrated += 1,
            Ok(false) => {}
            Err(_) => report.failed += 1,
        }
    }
    report
}
```

- [ ] **Step 4: Run migration tests and the existing Rust suite**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml brand_migration
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: all tests PASS.

- [ ] **Step 5: Commit the migration module**

```bash
git add src-tauri/src/brand_migration.rs src-tauri/src/lib.rs
git commit -m "feat: migrate legacy TokenHalo settings"
```

---

### Task 2: Wire migration before existing loaders

**Files:**
- Modify: `src-tauri/src/lib.rs:600-635`
- Test: `src-tauri/src/brand_migration.rs`
- Test: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `brand_migration::migrate_legacy_config`.
- Produces: TokenHalo startup reads migrated `preferences.json` and `token-stats-index.json` through existing loaders.

- [ ] **Step 1: Add a failing loader-order source contract**

Add this unit test to `brand_migration.rs`:

```rust
#[test]
fn startup_calls_migration_before_loading_preferences() {
    let source = include_str!("lib.rs");
    let migration = source.find("migrate_legacy_config").unwrap();
    let preference_load = source.find("load_preferences(&preferences_path)").unwrap();

    assert!(migration < preference_load);
}
```

Add this test to the existing `preference_commit_tests` module in `src-tauri/src/lib.rs`:

```rust
#[test]
fn migrated_preferences_are_loaded_by_the_existing_loader() {
    let root = tempfile::tempdir().unwrap();
    let legacy = root
        .path()
        .join(brand_migration::LEGACY_IDENTIFIER);
    let destination = root.path().join("app.tokenhalo.desktop");
    fs::create_dir_all(&legacy).unwrap();
    let mut expected = WidgetPreferences::default();
    expected.language = "zh-CN".into();
    fs::write(
        legacy.join("preferences.json"),
        serde_json::to_vec(&expected).unwrap(),
    )
    .unwrap();

    let report = brand_migration::migrate_legacy_config(root.path(), &destination);
    let loaded = load_preferences(&destination.join("preferences.json"));

    assert_eq!(report.migrated, 1);
    assert_eq!(loaded.language, "zh-CN");
}
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml startup_calls_migration_before_loading_preferences
cargo test --manifest-path src-tauri/Cargo.toml migrated_preferences_are_loaded_by_the_existing_loader
```

Expected: the loader test PASS and the ordering test FAIL because setup does not invoke migration.

- [ ] **Step 3: Invoke migration in Tauri setup**

Immediately after resolving `data_dir`, add:

```rust
let config_root = app.path().config_dir()?;
let migration = brand_migration::migrate_legacy_config(&config_root, &data_dir);
if migration.failed > 0 {
    eprintln!("legacy configuration migration incomplete");
}
```

Keep this call before:

```rust
let preferences = load_preferences(&preferences_path);
```

and before constructing `TokenStatsService`, so both consumers see migrated files. Do not delete the old directory or write an additional migration marker.

- [ ] **Step 4: Run the focused test and full Rust suite**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml startup_calls_migration_before_loading_preferences
cargo test --manifest-path src-tauri/Cargo.toml migrated_preferences_are_loaded_by_the_existing_loader
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: all tests PASS.

- [ ] **Step 5: Commit startup integration**

```bash
git add src-tauri/src/lib.rs src-tauri/src/brand_migration.rs
git commit -m "feat: load migrated TokenHalo data"
```

---

### Task 3: Rename runtime and package identity

**Files:**
- Modify: `src-tauri/src/config_contract.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/main.rs`
- Modify: `src-tauri/src/macos_overlay.rs`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `index.html`
- Modify: `src/components/DesignPlayground.tsx`

**Interfaces:**
- Consumes: canonical naming table in the approved spec.
- Produces: TokenHalo application identity, executable names, native panel type, and a dynamic User-Agent derived from the application package version.

- [ ] **Step 1: Add a failing Tauri branding contract**

Add to `src-tauri/src/config_contract.rs`:

```rust
#[test]
fn tokenhalo_metadata_is_canonical() {
    let config: Value = serde_json::from_str(include_str!("../tauri.conf.json"))
        .expect("tauri.conf.json must be valid JSON");
    let widget = config["app"]["windows"]
        .as_array()
        .and_then(|windows| windows.iter().find(|window| window["label"] == "widget"))
        .expect("widget window must exist");

    assert_eq!(config["productName"], "TokenHalo");
    assert_eq!(config["identifier"], "app.tokenhalo.desktop");
    assert_eq!(widget["title"], "TokenHalo");
    assert_eq!(config["bundle"]["shortDescription"], "Codex usage at a glance");
}
```

- [ ] **Step 2: Run the contract and verify it fails**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml tokenhalo_metadata_is_canonical
```

Expected: FAIL on `TokenHalo` / `app.tokenhalo.desktop`.

- [ ] **Step 3: Update npm, Cargo, Tauri, and HTML metadata**

Apply these exact mappings:

```text
package.json name                    tokenhalo -> tokenhalo
package-lock.json root names         tokenhalo -> tokenhalo
Cargo.toml package name              tokenhalo -> tokenhalo
Cargo.toml lib name                  tokenhalo_lib -> tokenhalo_lib
Cargo.lock root package name         tokenhalo -> tokenhalo
tauri productName/title              TokenHalo -> TokenHalo
tauri identifier                     app.tokenhalo.desktop -> app.tokenhalo.desktop
index.html title                     TokenHalo -> TokenHalo
DesignPlayground brand label         TOKENHALO -> TOKENHALO
```

Set Tauri descriptions to:

```json
"shortDescription": "Codex usage at a glance",
"longDescription": "TokenHalo is a lightweight floating desktop monitor for Codex usage limits and local Token statistics.",
"copyright": "Copyright TokenHalo contributors"
```

- [ ] **Step 4: Update Rust identifiers and runtime strings**

Use:

```rust
fn main() {
    tokenhalo_lib::run();
}
```

Rename both `TokenHaloPanel` occurrences to `TokenHaloPanel`.

Change tray tooltip and build error to `TokenHalo`.

Build the User-Agent from package metadata:

```rust
let user_agent = format!("TokenHalo/{}", app.package_info().version);
let client = reqwest::Client::builder()
    .timeout(Duration::from_secs(12))
    .redirect(reqwest::redirect::Policy::none())
    .user_agent(user_agent)
    .build()
    .expect("static HTTP client configuration must be valid");
```

- [ ] **Step 5: Run contract, Rust tests, frontend tests, and web build**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml tokenhalo_metadata_is_canonical
cargo test --manifest-path src-tauri/Cargo.toml
npm test -- --exclude='.worktrees/**'
npm run build
```

Expected: all commands PASS.

- [ ] **Step 6: Commit canonical runtime identity**

```bash
git add package.json package-lock.json index.html src/components/DesignPlayground.tsx src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json src-tauri/src/config_contract.rs src-tauri/src/lib.rs src-tauri/src/main.rs src-tauri/src/macos_overlay.rs
git commit -m "refactor: rename application to TokenHalo"
```

---

### Task 4: Rename documentation, templates, and release artifacts

**Files:**
- Modify: `.github/ISSUE_TEMPLATE/bug_report.yml`
- Modify: `.github/ISSUE_TEMPLATE/feature_request.yml`
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/release.yml`
- Modify: `README.md`
- Modify: `CONTRIBUTING.md`
- Modify: `PRIVACY.md`
- Modify: `SECURITY.md`
- Modify: `LICENSE`
- Modify: `docs/GITHUB-RELEASE-CHECKLIST.md`
- Modify: `docs/PROJECT-SUMMARY.md`
- Modify: `docs/RELEASE.md`
- Modify: `docs/RELEASE_TEMPLATE.md`
- Modify: `docs/TEST-MATRIX.md`
- Modify: legacy plans/specs returned by `rg`

**Interfaces:**
- Consumes: `TokenHalo`, `Codex Usage Monitor`, `change-42-yhmm/tokenhalo`, and the canonical artifact names.
- Produces: current public copy with preserved upstream attribution and an explicit non-affiliation notice.

- [ ] **Step 1: Record the complete legacy-brand file list**

Run:

```bash
rg -l --hidden -i 'quota[-_ ]?float|TokenHalo|tokenhalo' \
  --glob '!node_modules/**' \
  --glob '!dist/**' \
  --glob '!src-tauri/target/**' \
  --glob '!.worktrees/**' \
  --glob '!.git/**' .
```

Save the output in the task notes. Do not run a blind replacement of standalone `quota`.

- [ ] **Step 2: Update public product copy and repository URLs**

Apply:

```text
TokenHalo                          -> TokenHalo
tokenhalo-windows-unsigned.zip     -> tokenhalo-windows-unsigned.zip
tokenhalo-macos-universal-unsigned.zip -> tokenhalo-macos-universal-unsigned.zip
github.com/change-42-yhmm/tokenhalo -> github.com/change-42-yhmm/tokenhalo
TokenHalo.app                      -> TokenHalo.app
tokenhalo.exe                      -> tokenhalo.exe
```

Add this notice near the README introduction and retain it in release-facing copy:

```markdown
TokenHalo is an independent open-source project. It is not affiliated with, endorsed by, or sponsored by OpenAI. Codex is referenced only to describe compatibility.
```

Keep descriptions factual: remaining quota comes from the Codex/ChatGPT quota response, while Token statistics come from local `~/.codex/sessions`.

Add this upgrade boundary to `README.md`, `docs/RELEASE.md`, and `docs/RELEASE_TEMPLATE.md`:

```markdown
### Upgrading from TokenHalo

TokenHalo copies supported preferences and the local Token statistics index from the legacy application directory on first launch. It does not delete or modify the legacy directory. Verify TokenHalo before uninstalling the old application; if an old login-start item remains, disable it in the operating system's login-item settings.
```

- [ ] **Step 3: Preserve upstream MIT attribution**

Keep the existing line in `LICENSE` and add:

```text
Copyright (c) 2026 TokenHalo contributors
```

The beginning of `LICENSE` must become:

```text
MIT License

Copyright (c) 2026 TokenHalo contributors
Copyright (c) 2026 TokenHalo contributors
```

- [ ] **Step 4: Rename CI and release artifacts**

Update workflow matrix values to:

```yaml
artifact-name: tokenhalo-windows-unsigned
archive-name: tokenhalo-windows-unsigned.zip
```

and:

```yaml
artifact-name: tokenhalo-macos-universal-unsigned
archive-name: tokenhalo-macos-universal-unsigned.zip
```

Do not change workflow triggers, permissions, build commands, signing status, or release draft behavior in this rename task.

- [ ] **Step 5: Run content and YAML-adjacent verification**

Run:

```bash
npm test -- --exclude='.worktrees/**'
npm run build
git diff --check
```

Expected: tests and build PASS; `git diff --check` prints nothing.

- [ ] **Step 6: Commit docs and artifact naming**

```bash
git add .github README.md CONTRIBUTING.md PRIVACY.md SECURITY.md LICENSE docs
git commit -m "docs: adopt TokenHalo product identity"
```

---

### Task 5: Isolate current tests from legacy worktrees

**Files:**
- Modify: `vite.config.ts`

**Interfaces:**
- Consumes: existing Vitest `test.exclude` list.
- Produces: repository-level `npm test` never discovers `.worktrees/**`.

- [ ] **Step 1: Add an ignored-worktree failure probe and verify the red state**

Create the ignored file `.worktrees/vitest-exclusion-probe/should-not-run.test.ts` with:

```ts
import { expect, test } from "vitest";

test("worktree probe must never be discovered", () => {
  expect("discovered").toBe("excluded");
});
```

Run from the clean implementation worktree:

```bash
npm test
```

Expected: FAIL in `should-not-run.test.ts`, proving the current configuration discovers `.worktrees`.

- [ ] **Step 2: Add the missing exclusion**

Change:

```ts
test: { exclude: ["node_modules/**", "dist/**", "release/**", "src-tauri/target/**"] },
```

to:

```ts
test: {
  exclude: [
    "node_modules/**",
    "dist/**",
    "release/**",
    "src-tauri/target/**",
    ".worktrees/**",
  ],
},
```

- [ ] **Step 3: Run the unfiltered project test command**

Delete only `.worktrees/vitest-exclusion-probe/should-not-run.test.ts`, then run:

```bash
npm test
```

Expected: 9 project test files and 129 tests PASS; no `.worktrees` path appears in output.

- [ ] **Step 4: Commit test isolation**

```bash
git add vite.config.ts
git commit -m "test: exclude local worktrees from Vitest"
```

---

### Task 6: Audit legacy names and verify the complete local rename

**Files:**
- Modify only files identified as incorrect by the audit.

**Interfaces:**
- Consumes: all earlier tasks.
- Produces: a locally verified TokenHalo tree with only documented legacy-name exceptions.

- [ ] **Step 1: Search all tracked current files**

Run:

```bash
git grep -n -I -i -E 'TokenHalo|tokenhalo|tokenhalo|TokenHalo|tokenhalo'
```

Every result must belong to exactly one of:

- `LICENSE` upstream copyright;
- `src-tauri/src/brand_migration.rs` legacy Bundle ID and tests;
- the `Upgrading from TokenHalo` compatibility sections in `README.md`, `docs/RELEASE.md`, and `docs/RELEASE_TEMPLATE.md`;
- `docs/superpowers/specs/2026-07-25-tokenhalo-renaming-design.md`;
- `docs/superpowers/plans/2026-07-25-tokenhalo-renaming.md`.

Any other result must be fixed before continuing.

- [ ] **Step 2: Verify canonical names and artifact strings**

Run:

```bash
git grep -n -I 'TokenHalo'
git grep -n -I 'tokenhalo-windows-unsigned.zip'
git grep -n -I 'tokenhalo-macos-universal-unsigned.zip'
git grep -n -I 'app.tokenhalo.desktop'
```

Expected: runtime metadata, public docs, and workflows contain the canonical values.

- [ ] **Step 3: Verify formatting and all available automated checks**

Run:

```bash
npm test
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri -- build
git diff --check
git status --short
```

Expected:

- `npm test`: 9 files and 129 tests PASS;
- `npm run build`: exit 0;
- Rust formatting and tests: exit 0;
- Tauri build: exit 0 and produces TokenHalo-named bundles;
- `git diff --check`: no output;
- status contains only intentional implementation files before the final commit.

If `cargo` is unavailable, stop and request permission to install/use a Rust toolchain or run equivalent GitHub CI. Do not claim complete desktop verification from frontend checks alone.

- [ ] **Step 4: Inspect built bundle names**

Run the platform-appropriate command:

```bash
find src-tauri/target -maxdepth 6 \( -name 'TokenHalo.app' -o -name 'tokenhalo.exe' -o -name '*TokenHalo*' \) -print
```

Expected: current-platform TokenHalo bundle/executable paths; no newly built TokenHalo bundle.

- [ ] **Step 5: Commit audit corrections if any**

If the audit required changes:

```bash
git add -u
git diff --cached --name-status
git commit -m "chore: complete TokenHalo rename audit"
```

If there were no changes, do not create an empty commit.

---

### Task 7: Rename the GitHub repository after explicit approval

**Files:**
- Modify: local `.git/config` remote URL only after the remote rename succeeds.
- Verify: `README.md` and release links already target `change-42-yhmm/tokenhalo`.

**Interfaces:**
- Consumes: verified local TokenHalo branch and explicit user authorization.
- Produces: GitHub repository `change-42-yhmm/tokenhalo` and matching local `origin`.

- [ ] **Step 1: Confirm the remote target is available and current authority is sufficient**

Perform read-only checks for:

```text
current repository: change-42-yhmm/tokenhalo
target repository: change-42-yhmm/tokenhalo
required permission: repository administration
```

Do not infer availability from web search alone.

- [ ] **Step 2: Ask for explicit approval immediately before the external rename**

State that the action will push `codex/tokenhalo-rename`, change the public/private repository URL, and may affect clones, badges, automation, and release links. Wait for approval.

- [ ] **Step 3: Back up the verified implementation branch to GitHub**

Run:

```bash
git push -u origin codex/tokenhalo-rename
```

Expected: the complete local TokenHalo implementation and its commits are available on the remote branch before any repository-settings change.

- [ ] **Step 4: Rename the repository using the connected GitHub capability**

Prefer a purpose-built GitHub repository-settings action. If unavailable and GitHub CLI authentication is already active, run:

```bash
gh repo rename tokenhalo --repo change-42-yhmm/tokenhalo
```

Expected: the repository is now `change-42-yhmm/tokenhalo`.

- [ ] **Step 5: Update and verify local origin**

Run:

```bash
git remote set-url origin https://github.com/change-42-yhmm/tokenhalo.git
git remote -v
git ls-remote --exit-code origin HEAD
```

Expected: fetch and push URLs both use `tokenhalo.git`, and `ls-remote` succeeds.

- [ ] **Step 6: Verify GitHub surfaces**

Confirm that all of these resolve under the new repository:

```text
https://github.com/change-42-yhmm/tokenhalo
https://github.com/change-42-yhmm/tokenhalo/issues
https://github.com/change-42-yhmm/tokenhalo/releases
```

Also verify Actions still has access to repository contents and Release permissions.

- [ ] **Step 7: Report migration boundary**

Report:

- local branch and commit IDs;
- test/build evidence;
- new GitHub URL;
- whether the old URL redirects;
- that old local application data remains untouched;
- that users should verify TokenHalo before uninstalling TokenHalo.
