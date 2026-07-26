# macOS All-Spaces Codex Quota Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing TokenHalo widget remain visible across normal macOS Spaces and other applications' native fullscreen Spaces, matching the Codex pet's display scope while preserving the current UI and quota data flow.

**Architecture:** Keep the existing `widget` Tauri Webview and React frontend unchanged. On macOS only, register `tauri-nspanel`, convert the existing window to a non-activating floating `NSPanel`, and apply all-Spaces plus fullscreen-auxiliary collection behavior; all non-macOS builds retain the existing Tauri window path.

**Tech Stack:** Tauri 2.11.x, Rust 2021, React 19, TypeScript 5.9, Vitest 3, `tauri-nspanel` 2.1 pinned to Git revision `a3122e894383aa068ec5365a42994e3ac94ba1b6`.

## Global Constraints

- Preserve the current UI, quota auth/HTTP implementation, refresh cadence, privacy boundary, tray actions, dragging, resizing, locking, and autostart behavior.
- macOS is the only platform receiving the NSPanel behavior; Windows must continue compiling without the macOS dependency.
- Use one `widget` window only; do not duplicate windows across physical displays or follow the pointer between displays.
- Default behavior must cover normal Spaces and other apps' native fullscreen Spaces; disabling “always on top” is an explicit opt-out, and re-enabling it must restore floating behavior.
- Do not add signing, notarization, auto-update, App Store, or UI-redesign work.
- Pin the Git dependency to the exact revision above; do not depend on a mutable branch.
- Never log Codex tokens, account IDs, raw quota responses, auth paths, or native window pointers.

## File Map

- Create `src-tauri/src/config_contract.rs`: test-only contract for the `widget` Tauri configuration.
- Create `src-tauri/src/macos_overlay.rs`: macOS-only NSPanel class, declarative overlay policy, initialization, and policy tests.
- Modify `src-tauri/src/lib.rs`: register the test module, conditionally register the plugin, and invoke macOS overlay initialization.
- Modify `src-tauri/Cargo.toml`: add a macOS-targeted, revision-pinned `tauri-nspanel` dependency.
- Modify `src-tauri/Cargo.lock`: capture the resolved pinned dependency graph.
- Modify `src-tauri/tauri.conf.json`: mark `widget` visible on all workspaces and prevent maximize/fullscreen transitions.
- Modify `src-tauri/capabilities/default.json`: deny internal double-click maximize for the panel drag surface.
- Modify `docs/TEST-MATRIX.md`: record ordinary-Space and fullscreen-Space acceptance scenarios.
- Modify `docs/KNOWN-LIMITATIONS.md`: document the macOS-only scope and remaining manual verification boundary.

---

### Task 1: Lock the cross-Space Tauri configuration

**Files:**
- Create: `src-tauri/src/config_contract.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src-tauri/capabilities/default.json`

**Interfaces:**
- Consumes: Tauri's existing `widget` configuration in `src-tauri/tauri.conf.json`.
- Produces: A window contract with `alwaysOnTop = true`, `visibleOnAllWorkspaces = true`, `fullscreen = false`, and `maximizable = false`.

- [ ] **Step 1: Add the test-only module registration**

Add near the top of `src-tauri/src/lib.rs`:

```rust
#[cfg(test)]
mod config_contract;
```

- [ ] **Step 2: Write the failing configuration contract test**

Create `src-tauri/src/config_contract.rs`:

```rust
use serde_json::Value;

#[test]
fn widget_is_configured_for_cross_space_overlay_use() {
    let config: Value = serde_json::from_str(include_str!("../tauri.conf.json"))
        .expect("tauri.conf.json must be valid JSON");
    let widget = config["app"]["windows"]
        .as_array()
        .and_then(|windows| windows.iter().find(|window| window["label"] == "widget"))
        .expect("widget window must exist");

    assert_eq!(widget["alwaysOnTop"], true);
    assert_eq!(widget["visibleOnAllWorkspaces"], true);
    assert_eq!(widget["fullscreen"], false);
    assert_eq!(widget["maximizable"], false);
}
```

- [ ] **Step 3: Run the focused test and verify RED**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml config_contract::widget_is_configured_for_cross_space_overlay_use -- --exact
```

Expected: FAIL because `visibleOnAllWorkspaces`, `fullscreen`, and `maximizable` are absent and therefore deserialize as `null`.

- [ ] **Step 4: Apply the minimum window configuration**

Add these properties to the `widget` entry in `src-tauri/tauri.conf.json`:

```json
"maximizable": false,
"fullscreen": false,
"visibleOnAllWorkspaces": true
```

Add this permission after `core:window:allow-start-dragging` in `src-tauri/capabilities/default.json`:

```json
"core:window:deny-internal-toggle-maximize"
```

- [ ] **Step 5: Run the focused test and verify GREEN**

Run the same `cargo test` command. Expected: one focused test passes.

- [ ] **Step 6: Commit the configuration contract**

```bash
git add src-tauri/src/config_contract.rs src-tauri/src/lib.rs src-tauri/tauri.conf.json src-tauri/capabilities/default.json
git commit -m "test: lock macOS overlay window config"
```

---

### Task 2: Define and test the macOS panel policy

**Files:**
- Create: `src-tauri/src/macos_overlay.rs`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`

**Interfaces:**
- Consumes: `tauri_nspanel::{CollectionBehavior, PanelLevel, StyleMask}`.
- Produces: `fn desired_policy() -> OverlayPolicy`, the single source of truth used by panel initialization.

- [ ] **Step 1: Add the pinned macOS-only dependency**

Append to `src-tauri/Cargo.toml`:

```toml
[target.'cfg(target_os = "macos")'.dependencies]
tauri-nspanel = { git = "https://github.com/ahkohd/tauri-nspanel", rev = "a3122e894383aa068ec5365a42994e3ac94ba1b6" }
```

- [ ] **Step 2: Create a deliberately incomplete policy and its failing test**

Create `src-tauri/src/macos_overlay.rs` with the following initial contents:

```rust
use tauri_nspanel::{CollectionBehavior, PanelLevel, StyleMask};

#[derive(Debug, Clone, Copy, PartialEq)]
struct OverlayPolicy {
    level: PanelLevel,
    style_mask: StyleMask,
    collection_behavior: CollectionBehavior,
    hides_on_deactivate: bool,
}

fn desired_policy() -> OverlayPolicy {
    OverlayPolicy {
        level: PanelLevel::Normal,
        style_mask: StyleMask::empty(),
        collection_behavior: CollectionBehavior::new(),
        hides_on_deactivate: true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn policy_is_nonactivating_floating_and_fullscreen_auxiliary() {
        let policy = desired_policy();

        assert_eq!(policy.level, PanelLevel::Floating);
        assert_eq!(
            policy.style_mask,
            StyleMask::empty().nonactivating_panel().resizable()
        );
        assert_eq!(
            policy.collection_behavior,
            CollectionBehavior::new()
                .full_screen_auxiliary()
                .can_join_all_spaces()
        );
        assert!(!policy.hides_on_deactivate);
    }
}
```

- [ ] **Step 3: Register the macOS module**

Add to `src-tauri/src/lib.rs`:

```rust
#[cfg(target_os = "macos")]
mod macos_overlay;
```

- [ ] **Step 4: Run the focused policy test and verify RED**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml macos_overlay::tests::policy_is_nonactivating_floating_and_fullscreen_auxiliary -- --exact
```

Expected: FAIL on `PanelLevel::Normal` versus `PanelLevel::Floating`. The first run also updates `src-tauri/Cargo.lock` with the pinned plugin dependency.

- [ ] **Step 5: Implement the required policy**

Replace `desired_policy()` with:

```rust
fn desired_policy() -> OverlayPolicy {
    OverlayPolicy {
        level: PanelLevel::Floating,
        style_mask: StyleMask::empty().nonactivating_panel().resizable(),
        collection_behavior: CollectionBehavior::new()
            .full_screen_auxiliary()
            .can_join_all_spaces(),
        hides_on_deactivate: false,
    }
}
```

- [ ] **Step 6: Run the focused policy test and verify GREEN**

Run the same focused `cargo test` command. Expected: the policy test passes.

- [ ] **Step 7: Commit the tested policy and dependency lock**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs src-tauri/src/macos_overlay.rs
git commit -m "feat: define macOS fullscreen overlay policy"
```

---

### Task 3: Convert the widget into a macOS NSPanel

**Files:**
- Modify: `src-tauri/src/macos_overlay.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `desired_policy()` and the existing `widget: WebviewWindow`.
- Produces: `pub fn configure(app: &mut tauri::App) -> tauri::Result<()>`.

- [ ] **Step 1: Define the panel class and initialization function**

Expand `src-tauri/src/macos_overlay.rs` imports and add the following implementation above its tests:

```rust
use std::io;

use tauri::Manager;
use tauri_nspanel::{
    tauri_panel, CollectionBehavior, PanelLevel, StyleMask, WebviewWindowExt,
};

tauri_panel! {
    panel!(TokenHaloPanel {
        config: {
            can_become_key_window: true,
            can_become_main_window: false,
            is_floating_panel: true,
            hides_on_deactivate: false
        }
    })
}

pub fn configure(app: &mut tauri::App) -> tauri::Result<()> {
    app.set_activation_policy(tauri::ActivationPolicy::Accessory);

    let window = app.get_webview_window("widget").ok_or_else(|| {
        tauri::Error::Io(io::Error::new(
            io::ErrorKind::NotFound,
            "widget window missing during macOS overlay setup",
        ))
    })?;
    let panel = window.to_panel::<TokenHaloPanel>()?;
    let policy = desired_policy();

    panel.set_level(policy.level.value());
    panel.set_style_mask(policy.style_mask.into());
    panel.set_collection_behavior(policy.collection_behavior.into());
    panel.set_hides_on_deactivate(policy.hides_on_deactivate);
    panel.set_floating_panel(true);

    Ok(())
}
```

The existing `OverlayPolicy`, `desired_policy()`, and test module remain in the file after this code.

- [ ] **Step 2: Register the NSPanel plugin before app setup**

In `src-tauri/src/lib.rs`, end the existing base builder chain after the window-state plugin:

```rust
let builder = tauri::Builder::default()
    .plugin(tauri_plugin_single_instance::init(|app, _, _| {
        if let Some(window) = app.get_webview_window("widget") {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }))
    .plugin(tauri_plugin_autostart::init(
        MacosLauncher::LaunchAgent,
        None,
    ))
    .plugin(WindowStateBuilder::default().build());

#[cfg(target_os = "macos")]
let builder = builder.plugin(tauri_nspanel::init());

let app = builder
```

Keep the existing `.setup(...)`, handlers, window events, `.build(...)`, and `app.run(...)` chain after `let app = builder`.

- [ ] **Step 3: Invoke panel conversion at the start of app setup**

At the beginning of the existing `.setup(|app| { ... })` closure, before reading preferences or applying window settings, add:

```rust
#[cfg(target_os = "macos")]
macos_overlay::configure(app)?;
```

This ordering ensures the existing persisted `always_on_top` preference is applied to the converted panel later in the setup closure.

- [ ] **Step 4: Format and compile-test the integration**

Run:

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml macos_overlay::tests::policy_is_nonactivating_floating_and_fullscreen_auxiliary -- --exact
```

Expected: formatting succeeds and the focused panel policy test passes with the new macro and integration compiled.

- [ ] **Step 5: Run all Rust tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: all existing parser/preference tests plus both new overlay tests pass with zero failures.

- [ ] **Step 6: Commit the panel integration**

```bash
git add src-tauri/src/macos_overlay.rs src-tauri/src/lib.rs
git commit -m "feat: float quota widget over macOS fullscreen spaces"
```

---

### Task 4: Document and verify the complete macOS build

**Files:**
- Modify: `docs/TEST-MATRIX.md`
- Modify: `docs/KNOWN-LIMITATIONS.md`

**Interfaces:**
- Consumes: the completed macOS NSPanel build.
- Produces: reproducible automated verification evidence and an explicit manual acceptance checklist.

- [ ] **Step 1: Extend the window test matrix**

Add these rows under the existing window rows in `docs/TEST-MATRIX.md`:

```markdown
| 窗口 | macOS 普通 Space 切换 | 单个浮层在所有普通桌面持续显示 | 自动化配置/策略测试通过，待实机验证 |
| 窗口 | macOS 其他应用原生全屏 Space | 非激活 NSPanel 在 Safari/VS Code 全屏上持续显示 | 自动化策略测试通过，待实机验证 |
| 窗口 | 关闭并重新开启始终置顶 | 关闭允许退出浮动层级；重新开启恢复跨 Space 与全屏浮动 | 待 macOS 实机验证 |
```

Add ordinary-Space, fullscreen-Space, and always-on-top-toggle checks to the macOS release gate list in the same file.

- [ ] **Step 2: Record the platform boundary**

Add to `docs/KNOWN-LIMITATIONS.md`:

```markdown
- 跨普通桌面及其他应用全屏 Space 的浮层行为仅在 macOS 使用 NSPanel 实现；Windows 虚拟桌面行为仍沿用原生 Tauri 窗口能力。
- 自动化测试可验证窗口配置与 NSPanel 策略，但最终的 Space/全屏层级仍需在目标 macOS 版本上做可视化验收。
```

- [ ] **Step 3: Install deterministic frontend dependencies**

Run:

```bash
npm ci
```

Expected: installation completes from `package-lock.json` without modifying it.

- [ ] **Step 4: Run the full automated verification suite**

Run each command separately and require exit code 0:

```bash
npm test
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri build -- --bundles app
git diff --check
```

Expected:

- Vitest reports all frontend tests passing.
- TypeScript/Vite production build succeeds.
- Rust formatting check produces no diff.
- All Rust tests pass.
- Tauri emits a macOS `.app` bundle under `src-tauri/target/release/bundle/macos/`.
- Git whitespace check is clean.

- [ ] **Step 5: Run the macOS visual acceptance checklist**

Launch the built `.app`, then verify:

1. The compact orb displays and expands/collapses on hover.
2. The orb remains visible when switching between two ordinary Spaces.
3. The orb remains visible over Safari or VS Code in native fullscreen.
4. Dragging and menu-bar Show/Hide work in ordinary and fullscreen Spaces.
5. Disabling always-on-top opts out; re-enabling restores ordinary/fullscreen Space visibility.
6. Quit and relaunch preserve window state and overlay behavior.
7. Compare with Codex pet on the same machine; any Space where the pet shows but TokenHalo does not is a release-blocking failure.

- [ ] **Step 6: Commit documentation and verified state**

```bash
git add docs/TEST-MATRIX.md docs/KNOWN-LIMITATIONS.md
git commit -m "docs: add macOS fullscreen overlay verification"
```
