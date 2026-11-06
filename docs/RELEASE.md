# 发布说明

## 当前发布目标

TokenHalo 使用同一套 React/CSS/Tauri 代码构建 Windows 和 macOS 版本。视觉效果、悬浮球、展开卡片、透明度、圆角和动画参数都应保持在共享前端代码中，避免维护 Windows/macOS 两套 UI。

TokenHalo is an independent open-source project. It is not affiliated with, endorsed by, or sponsored by OpenAI. Codex is referenced only to describe compatibility.

当前发布默认输出 unsigned 包：

- `tokenhalo-windows-unsigned.zip`
- `tokenhalo-macos-universal-unsigned.zip`

macOS 包使用 Universal 构建，同时支持 Apple Silicon 和 Intel Mac。

## 发布一个 GitHub 下载版本

推送 `v*` tag 会触发 `.github/workflows/release.yml`，运行测试、构建 Windows 安装包和 macOS Universal 安装包，并上传到草稿 GitHub Release。

也可以推送与应用版本一致的 `codex/release-<版本号>` 分支。工作流会把该提交作为发布目标并创建对应的 `v<版本号>` 标签；例如 `codex/release-0.1.8` 对应 `v0.1.8`。版本校验会拒绝名称与应用版本不一致的发布分支或标签。

```bash
git tag v0.1.0
git push origin v0.1.0
```

发布前置任务会取消同一分支较早的发布任务，并要求 `npm audit --audit-level=high` 通过。两个平台的构建任务均成功后，`finalize` 任务会核对非空的 `.dmg`、`.exe`、`.msi` 和 `.app.tar.gz` 附件，再自动公开发布。正式版本会设为 Latest；带 `-` 的版本保留为预发布，不改变正式更新入口。任一前置检查或构建失败时，不会公开 Release。

## CI 与构建

`.github/workflows/ci.yml` 会在 push/PR 时执行：

- 前端测试、前端构建、npm audit。
- Windows 桌面测试和 Tauri build。
- macOS 桌面测试和 Tauri Universal build。

macOS CI/release 会显式安装：

- `aarch64-apple-darwin`
- `x86_64-apple-darwin`

并使用：

```bash
npm run tauri -- build --target universal-apple-darwin
```

## macOS unsigned 包使用说明

因为当前 macOS 包未签名、未公证，首次打开时 Gatekeeper 可能会阻止启动。小范围测试用户可以使用以下方式打开：

1. 解压下载的 macOS zip。
2. 将应用移动到 Applications 或任意测试目录。
3. 右键点击应用，选择 Open。
4. 在系统提示中再次选择 Open。

如果系统仍然阻止，可以在 System Settings -> Privacy & Security 中允许打开该应用。

## 签名与公证

Unsigned 包可以用于内部测试或小范围分发，但公开分发建议补齐签名与公证：

- Windows：代码签名证书，避免 SmartScreen 或未知发布者提示。
- macOS：Apple Developer ID Application 证书、Team ID、app-specific password，并完成 notarization。
- CI：将证书、密码和 Team ID 放入 GitHub Secrets，再在 release workflow 中加入签名和公证步骤。

证书和账号凭据不能由代码仓库生成，需要由项目所有者购买、申请或配置。

## 跨平台维护原则

- 后续效果调整默认只改共享前端代码。
- 平台差异只放在桌面壳层，例如托盘、置顶、拖动、点击穿透、开机启动。
- 不默认启用原生窗口级 Acrylic/Vibrancy；它会作用于整个窗口矩形，不符合只让圆角悬浮球卡片产生毛玻璃效果的设计目标。
- Codex 登录态读取继续使用 `CODEX_HOME` 或用户目录 `.codex/auth.json`，Windows/macOS 共用同一逻辑。
