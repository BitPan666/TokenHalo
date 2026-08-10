# Task Toast Button Highlight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a restrained translucent white top highlight to the blue task-toast primary button without changing its size, copy, or layout.

**Architecture:** Keep the existing React markup unchanged and implement the visual treatment entirely in the shared `.task-toast-primary` CSS rule. Use layered CSS gradients and inset shadows so both the task action and permission action receive the same finish.

**Tech Stack:** React 19, native CSS, Vitest, Testing Library, jsdom CSSOM

## Global Constraints

- Preserve the existing blue body, white text, pill shape, dimensions, and focus-visible outline.
- Keep the highlight inside the top 35% of the button with a soft fade and no hard white stripe.
- Add no outer glow and make no changes to secondary buttons, card layout, copy, timings, or notification logic.
- Keep text contrast no lower than the current button.

---

### Task 1: Add the primary-button glass highlight

**Files:**
- Modify: `src/components/TaskToast.test.tsx`
- Modify: `src/styles.css:459-474`

**Interfaces:**
- Consumes: the existing `.task-toast-primary` class used by `TaskToast` and `TaskPermissionToast`.
- Produces: a layered blue button background with a translucent white top highlight and restrained inset depth.

- [ ] **Step 1: Write the failing visual-style contract test**

Extend the existing primary-action style test to load `src/styles.css` through CSSOM and verify that `.task-toast-primary` has a layered gradient background and inset shadows:

```tsx
const style = document.createElement("style");
style.textContent = styles;
document.head.append(style);
const primaryRule = Array.from((style.sheet as CSSStyleSheet).cssRules)
  .find((rule): rule is CSSStyleRule => (
    rule instanceof CSSStyleRule && rule.selectorText === ".task-toast-primary"
  ));

expect(primaryRule?.style.backgroundImage).toContain("linear-gradient");
expect(primaryRule?.style.backgroundImage.match(/linear-gradient/g)).toHaveLength(2);
expect(primaryRule?.style.boxShadow).toContain("inset");
style.remove();
```

- [ ] **Step 2: Run the focused test and confirm it fails for the missing highlight**

Run: `npm test -- src/components/TaskToast.test.tsx`

Expected: FAIL because the current `.task-toast-primary` has a flat color background and no inset highlight/depth shadows.

- [ ] **Step 3: Implement the approved A treatment**

Update `.task-toast-primary` to use two layered gradients: a low-opacity white-to-transparent highlight over the upper portion and the existing blue body beneath it. Add a subtle white top inset and dark bottom inset, then add restrained hover and active variants that do not affect layout.

```css
.task-toast-primary {
  border: 1px solid color-mix(in srgb, var(--task-action-blue) 44%, #35506c);
  color: #fff;
  background-image:
    linear-gradient(180deg, rgb(255 255 255 / .34) 0%, rgb(255 255 255 / .12) 34%, transparent 56%),
    linear-gradient(180deg, color-mix(in srgb, var(--task-action-blue) 84%, #fff) 0%, color-mix(in srgb, var(--task-action-blue) 72%, #35506c) 100%);
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / .42),
    inset 0 -1px 1px rgb(35 67 105 / .2);
}

.task-toast-primary:hover {
  background-image:
    linear-gradient(180deg, rgb(255 255 255 / .4) 0%, rgb(255 255 255 / .15) 34%, transparent 56%),
    linear-gradient(180deg, color-mix(in srgb, var(--task-action-blue) 86%, #fff) 0%, color-mix(in srgb, var(--task-action-blue) 74%, #35506c) 100%);
}

.task-toast-primary:active {
  transform: translateY(1px);
  background-image:
    linear-gradient(180deg, rgb(255 255 255 / .22) 0%, rgb(255 255 255 / .08) 34%, transparent 56%),
    linear-gradient(180deg, color-mix(in srgb, var(--task-action-blue) 79%, #fff) 0%, color-mix(in srgb, var(--task-action-blue) 68%, #35506c) 100%);
}
```

- [ ] **Step 4: Run focused tests and the frontend build**

Run: `npm test -- src/components/TaskToast.test.tsx src/TaskToastApp.test.tsx`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

- [ ] **Step 5: Verify the live development surface**

Open or refresh the running development app, hover a task capsule to reveal “打开 Codex”, and confirm the top highlight is soft, white, translucent, and clipped to the pill. Press the button without releasing and confirm the subtle 1px press feedback, then check the first-use permission capsule uses the same finish.

- [ ] **Step 6: Commit only the button implementation and its test**

```bash
git add src/styles.css src/components/TaskToast.test.tsx docs/superpowers/plans/2026-08-10-task-toast-button-highlight.md
git commit -m "feat: refine task toast button highlight"
```
