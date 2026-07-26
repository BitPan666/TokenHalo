# 测试矩阵

状态含义：

- `Pass (automated)`：本分支在 2026-07-26 实际运行的自动化验证已通过。
- `Pass (build)`：本分支在 2026-07-26 实际生成了对应本机产物。
- `Not run (manual)`：本轮没有完成 GUI 或实机手工验收，不表示通过。
- `Pending (CI/device)`：仍需目标 CI 或指定平台设备验证。

| 范围 | 场景 | 预期 | 状态 |
| --- | --- | --- | --- |
| 自动化 | `npm test -- --run` | 前端组件、App 生命周期、窗口控制和统计 hook 全部通过 | Pass (automated): 13 files, 194 tests |
| 自动化 | `npm run build` | TypeScript 和 Vite 生产构建成功 | Pass (automated) |
| 自动化 | `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` | Rust 源码格式检查通过 | Pass (automated) |
| 自动化 | `cargo test --manifest-path src-tauri/Cargo.toml` | Rust 后端、统计解析、缓存、窗口和玻璃策略全部通过 | Pass (automated): 86 tests |
| 构建 | `npm run tauri build -- --bundles app` | 生成本机 macOS `TokenHalo.app` | Pass (build) |
| 构建 | 默认 app + DMG bundle | `.app` 已生成；DMG 脚本需单独复查本机构建环境 | Pending (local packaging) |
| 统计聚合 | 近 7 日 7 桶 | 最近 7 个连续自然日，每日一柱，最右为今天 | Pass (automated); Not run (manual) |
| 统计聚合 | 每周 12 桶 | 最近 12 个 ISO 自然周，周一开始，最右为当前周 | Pass (automated); Not run (manual) |
| 统计聚合 | 每月 12 桶 | 当前自然年 1 月至 12 月，未来月份保留零值位置 | Pass (automated); Not run (manual) |
| 统计文案 | 中英文 Token 单位 | 中文按普通数字、万、亿显示；英文按 K、M、B 显示 | Pass (automated/browser visual) |
| 统计边界 | 跨本地午夜 | Token 增量进入正确的本地自然日 | Pass (automated) |
| 统计边界 | 跨年 ISO 周 | 元旦附近仍使用正确 ISO 周年和周序号 | Pass (automated) |
| 增量索引 | 新建、追加、截断、同长替换、删除 session 文件 | 只计新增差量；重写会重建；删除会移除旧贡献 | Pass (automated); Not run (manual) |
| 缓存 | 主缓存损坏、备份恢复、提交失败 | 可从 `.bak` 恢复，失败不破坏上一份有效缓存 | Pass (automated) |
| 缓存 | synthetic session 和 cache 结构检查 | 只保存相对 session 标识和数值索引，不含提示词或绝对 session 根路径 | Pass (automated) |
| 缓存 | 实际用户 app config cache 人工检查 | 不包含 raw JSON、对话正文、认证信息或绝对 session 根路径 | Not run (manual); synthetic cache test passed |
| 统计失败 | 已有统计后刷新失败 | 保留旧统计并标记 stale；额度数据路径保持独立 | Pass (automated) for backend/UI states; Not run (manual desktop) |
| 统计失败 | 没有旧统计且目录不可读 | 显示 unavailable 和安全文案，额度页面仍可切换和使用 | Pass (automated) for backend/UI states; Not run (manual desktop) |
| 数据 | Codex 正常登录 | 显示当前登录套餐实际返回的有效额度窗口与会员类型 | Not run (manual) |
| 数据 | 仅返回 `604800` 秒窗口的账户 | 一周额度作为主指标，不显示空白或伪造的次级百分比 | Pass (automated/browser mock); Not run (live desktop) |
| 数据 | 同时返回 `18000` 与 `604800` 秒窗口的账户 | 五小时额度作为主指标，每周额度作为次级指标 | Pass (automated/browser mock); Not run (live desktop) |
| 数据 | 未登录或登录过期 | 显示登录提示，不暴露响应或 Token | Not run (manual) |
| 数据 | 401/403/429/断网 | 安全文案、保留旧额度并退避 | Pass (automated) for snapshot merge; Not run (manual desktop) |
| 数据 | 变形或缺字段额度响应 | 不崩溃，不显示虚假额度 | Pass (automated) for parser; Not run (manual integration) |
| 登录态 | Windows `CODEX_HOME` 或用户目录 `.codex/auth.json` | 可以读取本机 Codex 登录态 | Pending (device) |
| 登录态 | macOS `CODEX_HOME` 或 `~/.codex/auth.json` | 可以读取本机 Codex 登录态 | Not run (manual) |
| 窗口尺寸 | 100/320/400 切换 | 悬浮球、额度页、统计页按目标尺寸切换 | Pass (automated); Not run (manual) |
| 共享卡片 | 额度页与统计页展开状态 | 玻璃、图标顺序、语言、置顶和设置入口完全一致 | Pass (automated/browser visual) |
| 额度刷新 | 额度不可用或已退出登录 | 标题栏刷新仍可用，且不会被内容状态禁用 | Pass (automated/browser interaction); Not run (manual desktop) |
| 窗口位置 | 屏幕中心、四边、四角切换 100/320/400 | 按水平和垂直锚点反向展开，完整留在工作区 | Pass (automated geometry/controller); Not run (manual) |
| 窗口位置 | 展开卡片拖动后收起和再次展开 | 以拖动后的锚点收起，并按上次页面尺寸恢复 | Pass (automated controller); Not run (manual) |
| 窗口并发 | 快速 hover、离开、页面切换和失败回滚 | 最终 UI 与最后一次有效意图和物理尺寸一致 | Pass (automated) |
| 窗口 | macOS 第二个普通 Space | 单个浮层持续显示 | Pass (automated policy only); Not run (manual) |
| 窗口 | macOS 其他应用原生全屏 Space | 非激活 NSPanel 在 Safari 或 VS Code 全屏上持续显示 | Pass (automated policy only); Not run (manual) |
| 窗口 | 关闭并重新开启始终置顶 | 关闭时退出浮动层级，重新开启后恢复跨 Space 和全屏浮动 | Not run (manual) |
| 窗口 | 多显示器、缩放、移除显示器 | 恢复到可见工作区 | Pending (device); 本版本不复制多个浮层 |
| 偏好 | 老配置升级 | 缺少新字段时使用 quota 页、40/40 和 Regular 默认玻璃值 | Pass (automated) |
| 偏好 | 修改页面、透明度、样式和效果强度后重启 | 恢复最后页面和已保存值；首次为 quota、40/40 和 Regular | Pass (automated persistence contract); Not run (manual restart) |
| 玻璃 | macOS 26+ 透明窗口 | 原生 Liquid Glass 只覆盖 80×80 悬浮球或 320/400 卡片，不产生窗口矩形底板 | Pass (automated geometry/runtime launch); Pending (manual visual) |
| 玻璃 | 较早 macOS | 同一 frame 使用原生 Vibrancy，圆角与当前卡片一致 | Pass (automated mapping/build); Pending (target device) |
| 玻璃 | CSS 回退 | 原生应用失败时内容保持可读，悬浮球外部和展开卡片圆角外透明 | Pass (automated/browser visual); Pending (manual desktop) |
| 视觉 | 400×400 统计卡片 | 数据、7/12/12 柱密度、免责声明和设置面板完整显示 | Pass (automated/browser visual) |
| 托盘 | Windows 托盘菜单 | 显示/隐藏、刷新、解锁、固定、语言切换、开机启动、退出可用 | Pending (device) |
| 菜单栏 | macOS 菜单栏托盘 | 显示/隐藏、刷新、解锁、固定、语言切换、开机启动、退出可用 | Not run (manual) |
| 生命周期 | 单实例、关闭隐藏、休眠恢复 | 无重复后台进程，窗口可恢复 | Not run (manual) |
| 性能 | 空闲 CPU/内存 | 无持续高 CPU，记录平台基线 | Not run (manual) |
| 构建 | Windows unsigned 包 | 生成 `tokenhalo-windows-unsigned.zip` | Pending (CI) |
| 构建 | macOS Universal unsigned 包 | 生成支持 Apple Silicon 和 Intel 的 unsigned zip | Pending (CI); local outputs are host-architecture `.app` and `.dmg`, while the universal unsigned zip remains CI-only |
| 隐私 | 静态关键词扫描 | 统计模块不持久化或记录 prompt、response、authorization、access token 等内容 | Pass (automated/static review); matches only fixtures, safe status `message`, and tests |
| 文案 | 中英文常驻免责声明 | 两种语言都说明仅本机、不上传、可能不完整、非官方账单/账户级用量/剩余额度 | Pass (automated component assertions) |
| 文案 | 可见 UI 中的 em dash 字符 | 不使用 `—` | Pass (static scan) |

## 发布门槛

发布前应满足：

- 前端测试、前端构建、Rust 测试通过。
- Windows 和 macOS CI bundle artifact 成功生成。
- Windows 实机完成安装、启动、托盘、拖动、锁定、语言切换、退出验证。
- macOS 实机完成首次打开、菜单栏托盘、透明悬浮窗、展开/收起、拖动、置顶、读取 `~/.codex/auth.json` 验证。
- macOS 实机确认浮层在至少两个普通 Space 间切换时持续显示。
- macOS 实机确认浮层在 Safari 或 VS Code 原生全屏 Space 上持续显示，并与 Codex 宠物的可见范围一致。
- macOS 实机确认关闭“始终置顶”后可退出浮动层级，重新开启后恢复普通/全屏 Space 浮动。
- macOS 实机确认悬浮球在屏幕中心、四边和四角展开时，卡片不被菜单栏、Dock 或屏幕边缘裁切。
- macOS 实机确认展开卡片拖动后，收起的悬浮球落在拖动后的对应锚点。
- macOS 实机确认悬浮球外部和展开卡片圆角外没有窗口矩形底色。
- 实机确认切换额度/统计、调整玻璃、重启后恢复最后页面和保存值。
- 实机确认统计不可用时额度读取和额度页面仍正常。
- 人工检查实际 app config cache，只包含相对 session 标识、数值索引和非敏感元数据。
- 严重和高风险问题清零。
