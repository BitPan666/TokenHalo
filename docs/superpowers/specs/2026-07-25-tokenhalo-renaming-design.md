# TokenHalo 全量改名与兼容迁移设计

## 状态

已批准，2026-07-25。

## 目标

将当前基于 Quota Float 开发的桌面应用统一重命名为 **TokenHalo**，副标题为 **Codex Usage Monitor**。改名覆盖用户可见品牌、代码包标识、构建产物、发布文档和后续开发约定，同时保留现有功能、偏好设置、Token 统计索引和必要的上游版权声明。

改名完成后，所有新增功能、文档、Issue、发布说明和安装包均以 TokenHalo 为唯一当前产品名。

## 命名决策

### 规范名称

| 用途 | 规范值 |
| --- | --- |
| 产品显示名 | `TokenHalo` |
| 英文副标题 | `Codex Usage Monitor` |
| npm 包名 | `tokenhalo` |
| Rust package | `tokenhalo` |
| Rust library crate | `tokenhalo_lib` |
| Tauri product name | `TokenHalo` |
| Tauri Bundle ID | `app.tokenhalo.desktop` |
| GitHub 仓库目标名称 | `tokenhalo` |
| HTTP User-Agent | `TokenHalo/<应用版本>` |
| Windows 未签名包 | `tokenhalo-windows-unsigned.zip` |
| macOS Universal 未签名包 | `tokenhalo-macos-universal-unsigned.zip` |
| macOS 应用包 | `TokenHalo.app` |
| Windows 可执行文件 | `tokenhalo.exe` |
| macOS panel 类型 | `TokenHaloPanel` |

TokenHalo 是独立品牌名；Codex 只用于准确说明兼容对象。README、应用描述和发布页面必须明确说明本项目不是 OpenAI 官方产品，也未获得 OpenAI 认可或赞助。

名称已完成初步网络重名检查，但该检查不构成正式商标法律意见。

## 改名范围

### 用户可见品牌

以下位置全部改为 TokenHalo：

- README 标题、图片替代文本、产品简介、隐私边界和下载说明；
- HTML 标题、托盘提示、窗口标题和构建错误文字；
- Tauri product name、short description、long description 和版权展示；
- GitHub Issue 模板、贡献指南、安全说明、隐私说明和发布清单；
- GitHub Actions artifact 名称及 Release 压缩包名称；
- 设计预览中的品牌文字；
- 文档中的命令输出示例、应用包名称和可执行文件名称；
- GitHub 仓库链接、Issues 链接和 Releases 链接。

现有图标和截图如果不含 Quota Float 字样则继续使用；本次不包含视觉品牌重设计。

### 内部代码身份

以下内部标识同步改名：

- `quota-float` → `tokenhalo`；
- `quota_float_lib` → `tokenhalo_lib`；
- `QuotaFloatPanel` → `TokenHaloPanel`；
- `QuotaFloat/<version>` → `TokenHalo/<version>`；
- `app.quotafloat.desktop` → `app.tokenhalo.desktop`。

内部业务概念中的 `quota` 不属于旧品牌，不做机械替换。例如 `QuotaCard`、额度字段、额度接口和额度测试名称继续保留，因为它们准确描述业务含义。

### 历史与法律例外

以下位置允许继续出现旧名称：

1. MIT `LICENSE` 中原有的 `Quota Float contributors` 版权声明必须保留，并新增 TokenHalo 贡献者声明。
2. 兼容迁移代码和迁移测试中必须保留旧 Bundle ID `app.quotafloat.desktop`，仅用于定位旧配置目录。
3. Git 提交历史不重写，历史提交信息中的旧名称保持原样。
4. 若需说明项目来源，可在致谢或版权语境中使用旧名称，但不得将其作为当前产品名展示。

除上述允许项外，受版本控制的当前文件中不应残留 `Quota Float`、`quota-float`、`quota_float`、`QuotaFloat` 或 `quotafloat`。

## 旧数据兼容迁移

Tauri 的 `app_config_dir` 由系统配置目录与 Bundle ID 组成。Bundle ID 改为 `app.tokenhalo.desktop` 后，新旧版本会使用不同目录，因此必须进行一次性迁移。

### 路径

- 新目录：`${configDir}/app.tokenhalo.desktop`
- 旧目录：`${configDir}/app.quotafloat.desktop`

实现时通过 Tauri 的 `config_dir()` 获取平台配置根目录，不硬编码用户名或操作系统绝对路径。

### 迁移文件

只迁移经过允许的本地应用数据：

- `preferences.json`
- `preferences.json.bak`
- `token-stats-index.json`
- `token-stats-index.json.bak`

不迁移认证文件、Codex 会话日志、绝对路径、原始提示词或回复内容。当前应用本来也不应在配置目录中存储这些内容。

### 迁移规则

1. TokenHalo 启动并取得新配置目录后、读取偏好和统计索引前执行迁移。
2. 如果新目标文件已经存在，不覆盖它。
3. 如果目标不存在且旧文件存在，则先复制到新目录中的临时文件，再原子重命名为目标文件。
4. 旧文件只读复制，不移动、不修改、不删除，确保用户可以回退旧版本。
5. 单个文件迁移失败不阻止应用启动；记录不含敏感路径和内容的诊断信息，并继续使用默认值或重建统计索引。
6. 迁移后的偏好仍通过现有校验和备份恢复逻辑加载。
7. 迁移后的 Token 索引若版本无效或内容损坏，沿用现有安全重建行为。
8. 多次启动必须幂等：目标存在后不再重复复制。

迁移不需要单独写入“已迁移”标志；目标文件是否存在就是幂等判定依据。

### 安装与回退边界

更换 Bundle ID 后，操作系统可能把 TokenHalo 与旧应用视为两个独立应用。发布说明必须提示用户：

- 第一次启动 TokenHalo 后确认偏好和统计正常；
- 确认前不要删除旧应用或旧配置目录；
- 确认后可手动卸载旧应用；
- 旧版开机启动项如仍存在，需要在系统设置中关闭。

本次不自动删除旧应用、旧配置目录或旧开机启动项。

## GitHub 与发布迁移

本地源码改名和 GitHub 仓库改名分为两个可验证步骤：

1. 完成代码、文档、工作流和构建产物名称修改，并在本地验证。
2. 经用户明确确认后，将 GitHub 仓库从 `quota-float` 重命名为 `tokenhalo`，随后更新本地 `origin` URL 并验证 Issues、Releases 和 Actions 链接。

在远端仓库实际完成改名之前，不发布包含失效 TokenHalo GitHub URL 的 Release。任何 GitHub 仓库改名都是独立的外部变更，不由本地文本替换隐式执行。

## 测试与验收

### 自动化测试

必须新增迁移单元测试，至少覆盖：

- 旧文件存在且新文件不存在时成功迁移；
- 新文件存在时绝不覆盖；
- 迁移重复执行保持幂等；
- 一个旧文件损坏或复制失败时不阻止其他文件和应用启动；
- 迁移后偏好可正常加载；
- 迁移后统计索引可加载，或在无效时安全重建。

现有前端和 Rust 测试应保持通过。测试发现规则必须排除 `.worktrees/**`，避免残缺的旧工作树被 Vitest 当成当前项目测试。

### 静态检查

对受版本控制的当前文件执行大小写变体搜索。除法律与兼容迁移允许项外，不得出现旧品牌字符串。

需要人工核对：

- 产品名、窗口名和托盘提示；
- npm、Cargo 和 Tauri 元数据；
- Rust crate 引用和 macOS panel 类型；
- README、隐私、安全、贡献和发布文档；
- Issue 模板与 GitHub Actions；
- 安装包、应用包和可执行文件名称；
- GitHub URL；
- 设计预览文字。

### 构建验证

完成实现后至少执行：

```text
npm test -- --exclude='.worktrees/**'
npm run build
cargo fmt --check
cargo test
npm run tauri build
```

如果当前机器缺少 Rust/Cargo 或平台签名条件，必须明确报告未执行项，不能将前端验证等同于完整桌面构建验证。

### 行为验收

- 新安装显示 TokenHalo，不再展示旧产品名；
- 首次启动能读取旧偏好与 Token 统计索引；
- 额度查询、统计、悬浮球、展开卡片、玻璃效果、托盘和开机启动行为不因改名发生变化；
- 新配置写入 TokenHalo 目录，旧目录保持不变；
- 安装包和发布页面使用 TokenHalo 命名；
- 文档以后只将 TokenHalo 作为当前产品名。

## 非目标

- 不改变额度查询或 Token 统计算法；
- 不重新设计图标、配色或界面布局；
- 不重写 Git 历史；
- 不自动删除旧配置、旧应用或旧开机启动项；
- 不在本地改名阶段自动修改 GitHub 远端仓库；
- 不借改名引入无关重构。
