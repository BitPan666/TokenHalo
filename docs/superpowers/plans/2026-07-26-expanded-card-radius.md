# 展开卡片 40px 圆角实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 将剩余额度卡片和本机 Token 统计卡片的外层圆角统一为 `40px`。

**架构：** 在共享的 `.expanded-card-surface` 上定义唯一的展开卡片圆角规则，两张卡片不再各自声明不同的默认值。加载卡片保留独立规则，因为它不使用展开卡片共享类。

**技术栈：** React、TypeScript、CSS、Vitest、Testing Library、Vite

## 全局约束

- 两张展开卡片的浏览器计算圆角必须都是 `40px`。
- 仅调整最外层轮廓，不修改内部控件圆角或其他视觉参数。
- 不新增依赖。

---

### Task 1：统一展开卡片外层圆角

**文件：**
- 修改：`src/components/CardChrome.test.tsx`
- 修改：`src/styles.css`
- 修改：`docs/TEST-MATRIX.md`

**接口：**
- 使用：`.expanded-card-surface`、`.quota-card`、`.token-stats-card`
- 产出：两张展开卡片共享的 `40px` 外层圆角

- [x] **Step 1：编写失败测试**

在 `CardChrome.test.tsx` 中渲染同时带有 `.expanded-card-surface` 的额度卡片和统计卡片，并断言浏览器样式计算结果：

```tsx
it("keeps both expanded card surfaces at a shared 40px radius", () => {
  const style = document.createElement("style");
  style.dataset.cardChromeTestStyle = "true";
  style.textContent = readFileSync(
    resolve(process.cwd(), "src/styles.css"),
    "utf8",
  );
  document.head.append(style);
  const { container } = render(
    <>
      <section className="expanded-card-surface quota-card" />
      <section className="expanded-card-surface token-stats-card" />
    </>,
  );

  expect(getComputedStyle(container.querySelector(".quota-card")!).borderRadius)
    .toBe("40px");
  expect(getComputedStyle(container.querySelector(".token-stats-card")!).borderRadius)
    .toBe("40px");
});
```

- [x] **Step 2：运行测试并确认正确失败**

运行：

```bash
npm test -- --run src/components/CardChrome.test.tsx --reporter=verbose
```

预期：新测试失败，现有两个实际值分别为 `38px` 和 `32px`。

- [x] **Step 3：进行最小实现**

在 `src/styles.css` 中：

```css
.quota-card, .loading-card {
  /* 保留现有布局属性，但移除这里的 border-radius */
}

.loading-card {
  border-radius: var(--card-radius, 40px);
}

.expanded-card-surface {
  border-radius: var(--card-radius, 40px);
  /* 保留现有共享视觉属性 */
}

.token-stats-card {
  /* 保留现有布局属性，但移除这里的 border-radius */
}
```

在 `docs/TEST-MATRIX.md` 将前端测试总数增加 1。

- [x] **Step 4：运行验证**

运行：

```bash
npm test -- --run src/components/CardChrome.test.tsx --reporter=verbose
npm test -- --run --reporter=dot
npm run build
git diff --check
```

预期：相关测试、完整测试与构建均通过，`git diff --check` 无输出。

- [x] **Step 5：浏览器核对**

在 `http://127.0.0.1:1421/` 分别读取 `.quota-card` 和 `.token-stats-card` 的 `getComputedStyle(...).borderRadius`，预期均为 `40px`。

- [x] **Step 6：提交**

```bash
git add src/components/CardChrome.test.tsx src/styles.css docs/TEST-MATRIX.md docs/superpowers/plans/2026-07-26-expanded-card-radius.md
git commit -m "style: unify expanded card radius"
```
