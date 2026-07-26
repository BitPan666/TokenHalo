# 已知限制

- Codex 数据来自非公开只读接口，字段或认证方式可能变化。
- 当前发布包未签名、未公证；Windows 可能触发 SmartScreen，macOS 可能触发 Gatekeeper。
- macOS Universal 包由 GitHub Actions 的 `macos-latest` runner 构建，不能在 Windows 本机直接生成。
- GitHub workflow 只是在推送版本 tag 后生成 unsigned 包。本地构建成功不代表对应版本已经发布，也不代表它已签名或公证。
- Claude provider 在 v1 中未启用。
- 重置机会只读取数量和到期时间，不能在应用内兑换。
- 真实剩余额度依赖 Codex 后端返回的窗口数据；本机 Token 统计不会用于推算剩余额度。
- 本机 Token 统计会自动读取当前用户的 `~/.codex/sessions`，但只能统计可读取且格式仍受支持的本机 Token 计数记录。
- 本机统计按最近 7 个自然日、最近 12 个周一开始的 ISO 自然周、当前自然年 1 月至 12 月展示。它不是任意起止日期的账单报表。
- 未以换行结束的最后一条 JSONL 记录会等待后续写入完成后再解析，因此刚写入的末尾记录可能短暂延迟显示。
- 非 Token 事件不会进入统计；格式异常、数值溢出和不可读文件只显示非敏感状态，不会暴露原始日志。
- 扫描成功但统计缓存写入失败时，本次运行的当前内存统计仍可用，并显示不含原始错误或文件路径的提示。重启后可能回退到上一份有效缓存；没有可用缓存时需要重新建立索引，因此不保证保留本次尚未落盘的索引状态。
- 刷新失败但存在 last-good 数据时，统计状态为 `stale`，并保留旧的统计桶；没有 last-good 数据时，状态为 `unavailable`。
- Token 统计使用独立于剩余额度查询的 service、扫描锁、缓存和错误状态。统计失败不会阻断剩余额度页面；剩余额度仍按自己的查询结果显示。
- macOS 26 及以上使用仅覆盖卡片 frame 的原生 Liquid Glass，较早 macOS 使用同范围的 Vibrancy；原生应用失败时回退到 CSS 玻璃。Windows 继续使用卡片级 CSS 玻璃，WebView2 对桌面背景模糊的支持仍有限。
- macOS 26.5 的公开 `NSGlassEffectView` 接口提供圆角、tint 和 Clear/Regular 样式，但不提供独立的交互效果开关；TokenHalo 不调用私有或不存在的 selector。
- 跨普通桌面及其他应用全屏 Space 的浮层行为仅在 macOS 使用 NSPanel 实现；Windows 虚拟桌面行为仍沿用原生 Tauri 窗口能力。
- 自动化测试可验证窗口配置与 NSPanel 策略，但最终的 Space/全屏层级仍需在目标 macOS 版本上做可视化验收。
- 展开方向按 hover 开始时所在显示器的工作区与缩放比例计算；单次展开期间跨显示器拖动不做二次方向计算。
- 第一版只有一个浮层窗口，不会为每台外接显示器各创建一个实例。
- 本次发布不覆盖 Mac App Store sandbox。若以后进入 App Store，需要重新设计沙盒内对 `~/.codex/sessions` 的授权和访问方式，并单独完成审核与分发验证。
- 公开分发前建议补齐 Windows 代码签名、macOS Developer ID 签名和 notarization。

本机统计的英文边界原文如下：

```text
Token statistics only parse local token-count records. They may omit cloud,
other-device, deleted, unreadable, or format-changed records. They are trend
estimates, not official billing, account-wide usage, or remaining quota.
Raw session text and statistics are not uploaded.
```
