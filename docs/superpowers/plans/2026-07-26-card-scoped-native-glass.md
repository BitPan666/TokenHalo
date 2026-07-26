# TokenHalo 卡片范围原生玻璃实施计划

> 执行要求：按测试驱动方式逐项完成；每个任务先补失败测试，再写最小实现，最后运行相关回归测试。

**目标：** 实现只覆盖卡片的 macOS 原生玻璃，统一悬停视觉，并提供透明度、玻璃样式和三级效果强度设置。

**架构：** React 保留透明内容层和跨平台 CSS 回退；Rust 在 `WKWebView` 同级下方管理一个带 tag 的 AppKit 原生玻璃视图。窗口控制器每次完成模式尺寸调整后同步后端原生玻璃 frame。

**技术栈：** React 19、TypeScript、Vitest、Tauri 2、Rust 2021、objc2 AppKit。

## 任务 1：稳定悬浮球视觉与设置契约

**修改文件：**

- `src/components/QuotaCard.tsx`
- `src/components/QuotaCard.test.tsx`
- `src/styles.css`
- `src/types.ts`
- `src-tauri/src/models.rs`
- `src/lib/i18n.ts`

步骤：

1. 添加测试，确认悬浮球等待和 Hover 后都不再出现闲置样式类。
2. 删除闲置计时器、状态及 `.quota-orb--idle` CSS。
3. 添加 `GlassStyle = "clear" | "regular"` 与 `glassStyle` 偏好字段。
4. 添加 Rust 测试：旧配置默认 `regular`，序列化使用 camelCase。
5. 运行：

```bash
npm test -- --run src/components/QuotaCard.test.tsx
cargo test --manifest-path src-tauri/Cargo.toml preference_tests -- --nocapture
```

## 任务 2：外观设置 UI

**修改文件：**

- `src/components/AppearanceSheet.tsx`
- `src/components/AppearanceSheet.test.tsx`
- `src/styles.css`
- `src/lib/i18n.ts`
- 所有测试与预览中的默认偏好对象

步骤：

1. 添加测试，确认设置显示清透/标准样式与弱/中/强效果，并能预览、保存、重置。
2. 保留透明度滑块。
3. 把模糊滑块替换为三级 segmented control，映射为 `20/40/60`。
4. 新增清透/标准 segmented control。
5. 更新中英文文案与键盘可访问名称。
6. 更新默认偏好和设计预览。
7. 运行：

```bash
npm test -- --run src/components/AppearanceSheet.test.tsx
npm test -- --run
```

## 任务 3：原生玻璃几何与偏好映射

**修改文件：**

- `src-tauri/Cargo.toml`
- `src-tauri/Cargo.lock`
- `src-tauri/src/macos_glass.rs`

步骤：

1. 添加纯函数测试：
   - 三种模式 frame 和圆角正确；
   - 透明度转换到安全的 tint alpha；
   - 强度档位和玻璃样式映射正确；
   - 只有外观相关字段变化时才重应用。
2. 增加 macOS 目标依赖所需的 objc2 AppKit 功能。
3. 定义 `NativeGlassMode`、`GlassGeometry`、`GlassBackend`。
4. 用固定 tag 在 WebView 容器中查找、移除和插入玻璃视图。
5. macOS 26+ 创建 `NSGlassEffectView`，设置 frame、圆角、样式、tint 和交互效果。
6. 旧 macOS 创建 `NSVisualEffectView`，设置 frame、材质、混合模式、激活状态和 layer 圆角。
7. 不调用 `contentView`，保留防重挂载契约。
8. 运行：

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml macos_glass -- --nocapture
cargo test --manifest-path src-tauri/Cargo.toml config_contract -- --nocapture
```

## 任务 4：窗口模式联动

**修改文件：**

- `src-tauri/src/lib.rs`
- `src/lib/bridge.ts`
- `src/lib/bridge.test.ts`（如不存在则在相邻窗口控制测试中覆盖）
- `src/lib/widgetWindow.test.ts`

步骤：

1. 添加后端 `set_native_glass_mode` 命令。
2. 启动时按 `compact` 应用原生玻璃。
3. 窗口控制器完成 `setSize`/`setPosition` 后调用模式同步命令。
4. 添加测试，确认 `compact`、`quota`、`stats` 都同步，重复模式也会同步。
5. 原生同步失败不回滚已完成的窗口定位，但会向调用者报告并允许下次重试。
6. 运行前端窗口控制测试与 Rust 命令相关测试。

## 任务 5：文档、全量验证与 App 构建

**修改文件：**

- `README.md`
- `docs/KNOWN-LIMITATIONS.md`
- `docs/TEST-MATRIX.md`

步骤：

1. 更新原生玻璃、旧系统回退和设置说明。
2. 运行全量验证：

```bash
npm test -- --run
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri build
```

3. 启动新构建的 `TokenHalo.app`。
4. 人工检查三种模式、Hover 稳定性、设置联动和矩形底板消失。
5. 只提交本计划涉及的文件，不提交 `.superpowers/`。
