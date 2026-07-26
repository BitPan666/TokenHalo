# TokenHalo 跨电脑开发交接

本文用于在另一台电脑上恢复 TokenHalo 的完整开发环境。GitHub 保存源码、提交历史、测试和文档；本机登录态、偏好、依赖与构建缓存不会上传。

## 当前基线

- 产品名称：TokenHalo
- 本地开发分支：`codex/tokenhalo-rename`
- GitHub 交接基线：`main`
- 技术栈：React 19、TypeScript、Vite、Tauri 2、Rust
- 上次完整验证：2026-07-27，前端 194 项测试、生产构建和 Rust `cargo check` 通过

当前版本已包含：

- Codex 剩余额度读取与五小时/每周窗口自适应展示
- 本机 Token 统计，以及近 7 日、近 12 周和今年三个范围
- 剩余额度卡片与本机统计卡片的统一标题、图标、间距和圆角
- 中英文切换、刷新、置顶和设置操作
- macOS 卡片范围原生玻璃效果，以及透明度、样式和强度设置
- Quota Float 到 TokenHalo 的偏好与本机统计索引迁移

## 在另一台电脑恢复

安装 Node.js 20+、Rust stable 和 Tauri 2 所需的系统依赖，然后执行：

```bash
git clone https://github.com/peter9237/TokenHalo.git
cd TokenHalo
npm install
npm test
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
npm run tauri dev
```

GitHub 的 `main` 已包含当前可开发快照，不需要切换到其他分支。

如果需要恢复本机保存的完整原始提交历史，可在克隆后的仓库旁执行：

```bash
cd ..
cat TokenHalo/handoff/TokenHalo-2026-07-27.bundle.part-* \
  > /tmp/TokenHalo-2026-07-27.bundle
shasum -a 256 -c TokenHalo/handoff/TokenHalo-2026-07-27.bundle.sha256
git bundle verify /tmp/TokenHalo-2026-07-27.bundle
git clone /tmp/TokenHalo-2026-07-27.bundle TokenHalo-history
cd TokenHalo-history
git switch codex/tokenhalo-rename
git remote add origin https://github.com/peter9237/TokenHalo.git
```

日常继续开发优先使用普通的 GitHub 克隆方式；只有需要追溯旧提交时才使用 Bundle。

浏览器开发模式使用 mock 数据。真实剩余额度和本机 Token 统计必须通过 Tauri 桌面环境验证。

## 不会随 GitHub 同步的内容

- `~/.codex/auth.json`：Codex 登录态；请在新电脑登录 Codex Desktop
- `~/.codex/sessions`：新电脑自身的本机 Token 统计来源
- TokenHalo 的本机偏好和统计索引
- `node_modules`、`dist`、`src-tauri/target` 和生成的 `.app`
- `.env*`、凭据文件、`.codex` 和 `.superpowers` 本机工作文件

这些内容不应提交到 GitHub。换电脑后重新安装依赖和构建即可。

## 继续开发前检查

```bash
git status
git log -1 --oneline
npm test
cargo test --manifest-path src-tauri/Cargo.toml
npm run build
```

预期 Git 工作区应保持干净。修改 UI 前先确认额度卡片与统计卡片共享的 `CardChrome` 规格，避免再次出现标题字体、图标尺寸、间距或圆角不一致。

## 下一步建议

1. 在另一台电脑运行 Tauri 实机，确认额度读取、本机统计和玻璃设置。
2. 验证多显示器、置顶、拖动、收起悬浮球和开机启动行为。
3. 发布前完成 macOS 签名与公证，并按 `docs/GITHUB-RELEASE-CHECKLIST.md` 检查。
