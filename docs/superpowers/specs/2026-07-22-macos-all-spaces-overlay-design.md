# macOS 全桌面额度浮层设计

## 目标

基于 TokenHalo 现有代码构建第一版 macOS Codex 用量浮层。第一版保留现有 UI、额度读取、拖动、折叠、锁定、菜单栏和开机启动能力，只改变 macOS 窗口行为。

验收标准是浮层的可见范围与 Codex 宠物一致：

- 在普通 macOS 桌面（Space）之间切换时持续显示。
- 在 Safari、VS Code 等其他应用进入 macOS 原生全屏后创建的独立 Space 中持续显示。
- 仍然只有一个浮层窗口；不为外接显示器复制多个窗口。
- 应用重启、窗口展开/收起、显示/隐藏后，跨 Space 行为保持不变。
- “始终置顶”默认开启；用户主动关闭该开关时视为明确退出浮动行为，重新开启后必须恢复上述可见范围。

## 非目标

- 第一版不重新设计 UI。
- 不实现多显示器多实例或跟随鼠标跨显示器。
- 不改变 Codex 登录态读取、额度接口、刷新频率或隐私边界。
- 不在第一版加入自动更新、签名、公证或 App Store 发布流程。
- 不改造 Windows 窗口行为；非 macOS 平台继续使用现有 Tauri 窗口。

## 方案比较

### 方案 A：只启用 Tauri `visibleOnAllWorkspaces`

优点是改动极小。缺点是 Tauri/TAO 在 macOS 上只为 `NSWindow.collectionBehavior` 增加 `CanJoinAllSpaces`，没有完整配置全屏辅助窗口行为，因此不能作为“覆盖其他应用全屏 Space”的可靠实现。

### 方案 B：使用 `tauri-nspanel` 转换现有窗口（采用）

在 macOS 上将现有 `widget` Webview 窗口转换为 `NSPanel`，保留 Tauri Webview、React UI 和现有命令接口。面板使用浮动窗口级别，并配置加入所有 Space 与全屏辅助行为。应用使用 Accessory 激活策略，以菜单栏工具形态运行。

该方案直接针对悬浮控件、HUD 和桌面宠物场景，改动集中在 macOS 初始化层，不需要重新实现 UI 或额度数据流。

### 方案 C：自行编写 Objective-C/Rust 窗口桥接

可以完全控制 `NSPanel` 子类、窗口级别与 collection behavior，但需要维护更多平台专用和不安全代码。只有在插件无法满足既有拖动、缩放或鼠标穿透行为时才考虑。

## 架构与组件

### 前端

`src/` 保持现状。React 继续负责悬浮球、展开卡片、刷新、拖动触发和窗口尺寸切换。前端不需要知道当前宿主是 `NSWindow` 还是 `NSPanel`。

### 通用 Tauri 后端

`src-tauri/src/lib.rs` 继续负责额度命令、偏好设置、托盘菜单、单实例和窗口生命周期。现有 `widget` 标签不变，避免破坏前端桥接、托盘事件和 window-state 插件。

### macOS 窗口层

新增一个边界清晰的 macOS 模块，例如 `src-tauri/src/macos_overlay.rs`：

- 只在 `target_os = "macos"` 时编译。
- 设置应用激活策略为 `Accessory`。
- 获取标签为 `widget` 的现有 Webview 窗口并转换为 `NSPanel`。
- 配置加入全部 Space、允许出现在其他应用的全屏 Space、浮动层级和不因应用失去激活而隐藏。
- 返回明确错误，由启动流程记录安全错误信息；不记录窗口指针或账户数据。

非 macOS 平台提供空实现或通过条件编译跳过该模块，确保原有 Windows 构建不受影响。

### 依赖

加入 Tauri 2 兼容的 `tauri-nspanel` v2.1。实现时固定到经过构建验证的精确 Git revision，避免跟随可变分支导致不可复现构建。插件只参与 macOS 桌面窗口管理，不接触 Codex 凭证或网络数据。

## 启动与数据流

1. Tauri 按现有 `tauri.conf.json` 创建透明、无边框、置顶的 `widget` 窗口。
2. macOS setup 阶段将应用切换为 Accessory，并把 `widget` 转换为浮动 `NSPanel`。
3. 面板沿用原标签和 Webview，React 正常加载并请求现有 Rust 命令。
4. Rust 继续从本机 Codex 登录态读取额度；返回数据和 UI 更新路径不变。
5. 展开/收起只调整同一面板尺寸；显示/隐藏、拖动和窗口状态恢复仍作用于 `widget`。

## 错误处理

- 找不到 `widget`、面板转换失败或窗口策略应用失败时，启动应返回可诊断错误，避免静默降级为一个看似正常但不能跨全屏 Space 的窗口。
- 托盘初始化失败时保留现有任务栏回退逻辑。
- 额度读取失败继续使用现有 stale/signed-out/unavailable 状态，不与窗口错误混合。
- macOS 原生窗口配置不得输出账户 token、账户 ID、原始额度响应或本机认证路径。

## 测试策略

### 自动化测试

按测试先行方式加入：

- 配置契约测试：`widget` 必须启用 `alwaysOnTop` 和 `visibleOnAllWorkspaces`。
- macOS 策略单元测试：面板策略必须声明全 Space、全屏辅助、浮动和失活不隐藏。
- Rust 现有额度解析与偏好测试全部继续通过。
- 前端现有 Vitest 测试全部继续通过。
- `npm run build`、`cargo test` 和 macOS `tauri build` 必须成功。

### macOS 实机验收

- 创建至少两个普通桌面，来回切换，浮层持续显示。
- Safari 或 VS Code 点击绿色按钮进入原生全屏，切换到该全屏 Space，浮层持续显示。
- 在普通与全屏 Space 中分别测试展开、收起、拖动和菜单栏显示/隐藏。
- 主动关闭“始终置顶”后允许窗口退出浮动层级；重新开启后恢复普通与全屏 Space 中的浮动行为。
- 退出并重新启动，窗口位置、尺寸和跨 Space 行为可恢复。
- 对照同一台 Mac 上的 Codex 宠物；若可见范围不一致，则不视为完成，并进入自定义 NSPanel 桥接方案评估。

## 完成定义

代码、自动化测试和 macOS 构建全部通过，且实机对照清单确认普通 Space 与其他应用全屏 Space 中的可见范围和 Codex 宠物一致。第一版不以 UI 改版或发布签名作为完成条件。
