# 统计卡片统一与数字格式实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 使 Token 统计卡片标题栏与使用情况卡片一致，并按中英文语言正确显示 Token 数字单位。

**架构：** `TokenStatsCard` 根据 `WidgetPreferences.language` 使用本地化格式化函数；它统一服务主数字、明细和柱状图提示。样式层移除统计卡片对共享 `CardChrome` 的局部覆盖，后端继续提供日 7、周 12 个桶。

**技术栈：** React、TypeScript、Vitest、CSS、Rust/Tauri。

## 全局约束

- 日、周、月范围分别为近 7 日、近 12 周、当年 12 个月。
- 中文使用普通数字 / 万 / 亿；英文使用 K / M / B；最多两位小数。
- 标题与右侧操作必须共享使用情况卡片的 CSS 尺寸，不缩小控件以迁就宽度。
- 本轮按快速 UI 模式：运行相关测试、构建与页面核对，不重建 `.app` 或 `.dmg`。

---

### Task 1：本地化 Token 数字格式

**文件：**

- 修改：`src/components/TokenStatsCard.tsx`
- 测试：`src/components/TokenStatsCard.test.tsx`

**接口：**

- 输入：`formatCompact(value, language)`。
- 输出：`splitCompact(value, language)`，返回数字部分和单位部分。
- 消费方：统计主数字、明细和柱图提示。

- [x] Step 1：添加中文 `525 万`、`亿` 阈值和英文 `5.25M` 的失败断言。
- [x] Step 2：运行 `npm test -- --run src/components/TokenStatsCard.test.tsx`，确认中文断言失败。
- [x] Step 3：实现语言感知格式化；中文以 10,000、100,000,000 为阈值，英文使用现有紧凑格式化器；所有显示位置传入当前语言。
- [x] Step 4：再次运行目标测试，确认中英文主数字、明细和柱图提示通过。
- [x] Step 5：提交 `TokenStatsCard` 与组件测试，提交信息为 `feat: localize token statistic units`。

### Task 2：统一共享标题栏与统计柱状图约束

**文件：**

- 修改：`src/styles.css`
- 测试：`src/components/TokenStatsCard.test.tsx`
- 测试：`src-tauri/src/token_stats/periods.rs`

**接口：**

- 输入：`CardChrome` 的基准标题、按钮和图标 CSS。
- 输出：统计卡片不再有 `.token-stats-card .card-chrome-*` 尺寸覆盖；后端 `period_keys` 持续输出日 7、周 12 个桶。

- [x] Step 1：添加“没有统计卡片标题栏尺寸覆盖”、日图 7 根和周图 12 根的失败断言。
- [x] Step 2：运行组件测试与 `cargo test --manifest-path src-tauri/Cargo.toml token_stats::periods::tests -- --nocapture`；前端样式断言应失败，Rust 范围测试应通过。
- [x] Step 3：移除 `.token-stats-card .card-chrome-*` 的本地尺寸规则；若共享标题栏换行，只调整统计卡片最小宽度。
- [x] Step 4：重新运行前端与 Rust 目标测试，确认通过。
- [x] Step 5：提交样式与测试，提交信息为 `style: align token statistic card chrome`。

### Task 3：快速回归验证与文档

**文件：**

- 修改：`docs/superpowers/specs/2026-07-26-statistics-chrome-and-number-format-design.md`
- 修改：`docs/superpowers/plans/2026-07-26-statistics-chrome-and-number-format.md`

- [x] Step 1：将规格和计划保持为中文，并检查不存在旧的“30 日”或 `Daily / Weekly / Monthly` 文案。
- [x] Step 2：运行 `npm test -- --run`、`npm run build`、`cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`、`cargo test --manifest-path src-tauri/Cargo.toml`，全部应通过。
- [x] Step 3：核对 `http://127.0.0.1:1421/` 的统计视图：标题栏尺寸统一、日图 7 根、周图 12 根、中英文数字单位正确。
- [x] Step 4：提交规格与计划状态，提交信息为 `docs: record statistics card validation`。
