# Edge-Aware Widget Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the 320×320 quota card fully inside the current monitor work area by flipping its hover expansion direction near screen edges, while preserving the orb's anchor before and after expansion or dragging.

**Architecture:** Extract all physical-pixel placement math into a pure TypeScript module, then add a small serialized window controller that owns the active expansion anchor. The existing Tauri bridge supplies a lazy adapter for window metrics and frame updates; React components and visual CSS stay unchanged.

**Tech Stack:** React 19, TypeScript 5.9, Vitest 3, Tauri JavaScript window API 2.8.x, Tauri 2.11.x.

## Global Constraints

- Preserve the existing 100×100 compact window and 320×320 expanded window.
- Preserve the current UI, hover triggers, dragging, locking, NSPanel behavior, and quota data flow.
- Default to right/down expansion and flip each axis only when the expanded card would cross the current monitor work area.
- Collapse to the same anchor; if the expanded card was dragged, use the corresponding corner at its new position.
- Use physical pixels for placement and monitor geometry, logical pixels for Tauri window sizing.
- Serialize hover transitions so rapid enter/leave events finish in request order.
- If `currentMonitor()` returns `null`, retain the current position and default left/top anchor rather than failing.
- Do not add multi-display copies, cross-monitor drag optimization, UI redesign, or new Rust commands.

## File Map

- Create `src/lib/windowPlacement.ts`: pure geometry types, scale conversion, expansion planning, collapse planning, and work-area clamping.
- Create `src/lib/windowPlacement.test.ts`: deterministic geometry tests for edges, corners, dragging, work-area origins, clamping, and scale factors.
- Create `src/lib/widgetWindow.ts`: serialized stateful controller over an injected window adapter.
- Create `src/lib/widgetWindow.test.ts`: controller tests for anchor retention, expanded-card dragging, rapid transitions, and recovery after an adapter failure.
- Modify `src/lib/bridge.ts`: lazily create the controller with Tauri's window API and delegate `setWidgetExpanded` to it.
- Modify `docs/TEST-MATRIX.md`: add edge-aware hover acceptance rows and release-gate checks.
- Modify `docs/KNOWN-LIMITATIONS.md`: record the existing single-display/cross-monitor boundary for an active hover cycle.

---

### Task 1: Implement pure edge-aware placement geometry

**Files:**
- Create: `src/lib/windowPlacement.ts`
- Create: `src/lib/windowPlacement.test.ts`

**Interfaces:**
- Consumes: Physical window position, physical compact/expanded sizes, optional physical work-area rectangle, and scale factor.
- Produces: `logicalSquareToPhysical`, `planExpansion`, `planCollapse`, and the shared `Point`, `Size`, `Rect`, `ExpansionAnchor`, and `PlacementPlan` types.

- [ ] **Step 1: Write the failing geometry tests**

Create `src/lib/windowPlacement.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  logicalSquareToPhysical,
  planCollapse,
  planExpansion,
  type ExpansionAnchor,
  type Point,
  type Rect,
  type Size,
} from "./windowPlacement";

const compactSize: Size = { width: 100, height: 100 };
const expandedSize: Size = { width: 320, height: 320 };
const workArea: Rect = { x: 0, y: 0, width: 1440, height: 900 };

function expand(position: Point) {
  return planExpansion({ compactPosition: position, compactSize, expandedSize, workArea });
}

describe("planExpansion", () => {
  it.each([
    [{ x: 400, y: 300 }, { x: 400, y: 300 }, { horizontal: "left", vertical: "top" }],
    [{ x: 1340, y: 300 }, { x: 1120, y: 300 }, { horizontal: "right", vertical: "top" }],
    [{ x: 400, y: 800 }, { x: 400, y: 580 }, { horizontal: "left", vertical: "bottom" }],
    [{ x: 1340, y: 800 }, { x: 1120, y: 580 }, { horizontal: "right", vertical: "bottom" }],
    [{ x: 1340, y: 20 }, { x: 1120, y: 20 }, { horizontal: "right", vertical: "top" }],
    [{ x: 20, y: 800 }, { x: 20, y: 580 }, { horizontal: "left", vertical: "bottom" }],
  ] as Array<[Point, Point, ExpansionAnchor]>)
  ("places %# at the expected anchor", (compactPosition, position, anchor) => {
    expect(expand(compactPosition)).toEqual({ position, anchor });
  });

  it("handles a work area with a non-zero origin", () => {
    expect(planExpansion({
      compactPosition: { x: -100, y: 980 },
      compactSize,
      expandedSize,
      workArea: { x: -1920, y: 25, width: 1920, height: 1055 },
    })).toEqual({
      position: { x: -320, y: 760 },
      anchor: { horizontal: "right", vertical: "bottom" },
    });
  });

  it("keeps the current position when no monitor is available", () => {
    expect(planExpansion({
      compactPosition: { x: 1300, y: 760 }, compactSize, expandedSize, workArea: null,
    })).toEqual({
      position: { x: 1300, y: 760 },
      anchor: { horizontal: "left", vertical: "top" },
    });
  });

  it("clamps oversized and off-bound windows to the work-area origin", () => {
    expect(planExpansion({
      compactPosition: { x: 400, y: 400 },
      compactSize,
      expandedSize,
      workArea: { x: 50, y: 40, width: 250, height: 200 },
    }).position).toEqual({ x: 50, y: 40 });
  });
});

describe("planCollapse", () => {
  const anchor: ExpansionAnchor = { horizontal: "right", vertical: "bottom" };

  it("returns to the original compact position", () => {
    expect(planCollapse({
      expandedPosition: { x: 1120, y: 580 }, compactSize, expandedSize, anchor, workArea,
    })).toEqual({ x: 1340, y: 800 });
  });

  it("uses the expanded card's new position after dragging", () => {
    expect(planCollapse({
      expandedPosition: { x: 700, y: 400 }, compactSize, expandedSize, anchor, workArea,
    })).toEqual({ x: 920, y: 620 });
  });
});

it("converts logical square sizes to physical pixels", () => {
  expect(logicalSquareToPhysical(100, 2)).toEqual({ width: 200, height: 200 });
  expect(logicalSquareToPhysical(320, 1.5)).toEqual({ width: 480, height: 480 });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npx vitest run --dir src src/lib/windowPlacement.test.ts
```

Expected: FAIL because `./windowPlacement` does not exist.

- [ ] **Step 3: Implement the pure geometry module**

Create `src/lib/windowPlacement.ts`:

```ts
export interface Point { x: number; y: number }
export interface Size { width: number; height: number }
export interface Rect extends Point, Size {}

export interface ExpansionAnchor {
  horizontal: "left" | "right";
  vertical: "top" | "bottom";
}

export interface PlacementPlan {
  position: Point;
  anchor: ExpansionAnchor;
}

interface ExpansionInput {
  compactPosition: Point;
  compactSize: Size;
  expandedSize: Size;
  workArea: Rect | null;
}

interface CollapseInput {
  expandedPosition: Point;
  compactSize: Size;
  expandedSize: Size;
  anchor: ExpansionAnchor;
  workArea: Rect | null;
}

export function logicalSquareToPhysical(side: number, scaleFactor: number): Size {
  const physicalSide = Math.round(side * scaleFactor);
  return { width: physicalSide, height: physicalSide };
}

function clampPosition(position: Point, size: Size, workArea: Rect | null): Point {
  if (!workArea) return position;
  const maxX = workArea.x + Math.max(0, workArea.width - size.width);
  const maxY = workArea.y + Math.max(0, workArea.height - size.height);
  return {
    x: Math.min(Math.max(position.x, workArea.x), maxX),
    y: Math.min(Math.max(position.y, workArea.y), maxY),
  };
}

export function planExpansion(input: ExpansionInput): PlacementPlan {
  const { compactPosition, compactSize, expandedSize, workArea } = input;
  const crossesRight = workArea
    ? compactPosition.x + expandedSize.width > workArea.x + workArea.width
    : false;
  const crossesBottom = workArea
    ? compactPosition.y + expandedSize.height > workArea.y + workArea.height
    : false;
  const anchor: ExpansionAnchor = {
    horizontal: crossesRight ? "right" : "left",
    vertical: crossesBottom ? "bottom" : "top",
  };
  const position = {
    x: anchor.horizontal === "right"
      ? compactPosition.x + compactSize.width - expandedSize.width
      : compactPosition.x,
    y: anchor.vertical === "bottom"
      ? compactPosition.y + compactSize.height - expandedSize.height
      : compactPosition.y,
  };
  return { position: clampPosition(position, expandedSize, workArea), anchor };
}

export function planCollapse(input: CollapseInput): Point {
  const { expandedPosition, compactSize, expandedSize, anchor, workArea } = input;
  const position = {
    x: anchor.horizontal === "right"
      ? expandedPosition.x + expandedSize.width - compactSize.width
      : expandedPosition.x,
    y: anchor.vertical === "bottom"
      ? expandedPosition.y + expandedSize.height - compactSize.height
      : expandedPosition.y,
  };
  return clampPosition(position, compactSize, workArea);
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the same Vitest command. Expected: 12 geometry cases pass with zero failures.

- [ ] **Step 5: Commit the tested geometry**

```bash
git add src/lib/windowPlacement.ts src/lib/windowPlacement.test.ts
git commit -m "feat: calculate edge-aware widget placement"
```

---

### Task 2: Serialize window transitions and connect the Tauri bridge

**Files:**
- Create: `src/lib/widgetWindow.ts`
- Create: `src/lib/widgetWindow.test.ts`
- Modify: `src/lib/bridge.ts`

**Interfaces:**
- Consumes: `logicalSquareToPhysical`, `planExpansion`, `planCollapse`, and geometry types from Task 1.
- Produces: `createWidgetWindowController(adapter) -> WidgetWindowController`; preserves `setWidgetExpanded(expanded: boolean): Promise<void>` as the public bridge API.

- [ ] **Step 1: Write failing controller tests**

Create `src/lib/widgetWindow.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createWidgetWindowController, type WidgetWindowAdapter, type WidgetWindowState } from "./widgetWindow";

const workArea = { x: 0, y: 0, width: 1440, height: 900 };

function fakeAdapter(initial: WidgetWindowState) {
  let state = initial;
  const frames: Array<{ logicalSide: number; position: { x: number; y: number } | null }> = [];
  const adapter: WidgetWindowAdapter = {
    readState: vi.fn(async () => state),
    applyFrame: vi.fn(async (logicalSide, position) => {
      frames.push({ logicalSide, position });
      if (position) state = { ...state, position };
    }),
  };
  return { adapter, frames, moveTo: (position: { x: number; y: number }) => { state = { ...state, position }; } };
}

describe("createWidgetWindowController", () => {
  it("expands left/up and collapses to the original bottom-right anchor", async () => {
    const fake = fakeAdapter({ position: { x: 1340, y: 800 }, scaleFactor: 1, workArea });
    const controller = createWidgetWindowController(fake.adapter);

    await controller.setExpanded(true);
    await controller.setExpanded(false);

    expect(fake.frames).toEqual([
      { logicalSide: 320, position: { x: 1120, y: 580 } },
      { logicalSide: 100, position: { x: 1340, y: 800 } },
    ]);
  });

  it("collapses to the selected anchor after the expanded card is dragged", async () => {
    const fake = fakeAdapter({ position: { x: 1340, y: 800 }, scaleFactor: 1, workArea });
    const controller = createWidgetWindowController(fake.adapter);

    await controller.setExpanded(true);
    fake.moveTo({ x: 700, y: 400 });
    await controller.setExpanded(false);

    expect(fake.frames.at(-1)).toEqual({ logicalSide: 100, position: { x: 920, y: 620 } });
  });

  it("serializes a rapid expand then collapse", async () => {
    let releaseFirst!: () => void;
    const firstFrame = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const fake = fakeAdapter({ position: { x: 1340, y: 800 }, scaleFactor: 1, workArea });
    vi.mocked(fake.adapter.applyFrame)
      .mockImplementationOnce(async () => firstFrame)
      .mockImplementation(async (logicalSide, position) => {
        fake.frames.push({ logicalSide, position });
      });
    const controller = createWidgetWindowController(fake.adapter);

    const expanding = controller.setExpanded(true);
    const collapsing = controller.setExpanded(false);
    await Promise.resolve();
    expect(fake.adapter.applyFrame).toHaveBeenCalledTimes(1);

    releaseFirst();
    await Promise.all([expanding, collapsing]);
    expect(fake.adapter.applyFrame).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fake.adapter.applyFrame).mock.calls.at(-1)?.[0]).toBe(100);
  });

  it("finishes in the state requested by the last rapid hover event", async () => {
    const fake = fakeAdapter({ position: { x: 400, y: 300 }, scaleFactor: 1, workArea });
    const controller = createWidgetWindowController(fake.adapter);

    await Promise.all([
      controller.setExpanded(true),
      controller.setExpanded(false),
      controller.setExpanded(true),
    ]);

    expect(fake.frames.map((frame) => frame.logicalSide)).toEqual([320, 100, 320]);
  });

  it("continues processing after an adapter failure", async () => {
    const fake = fakeAdapter({ position: { x: 400, y: 300 }, scaleFactor: 1, workArea });
    vi.mocked(fake.adapter.applyFrame).mockRejectedValueOnce(new Error("resize failed"));
    const controller = createWidgetWindowController(fake.adapter);

    await expect(controller.setExpanded(true)).rejects.toThrow("resize failed");
    await expect(controller.setExpanded(true)).resolves.toBeUndefined();
    expect(fake.adapter.applyFrame).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
npx vitest run --dir src src/lib/widgetWindow.test.ts
```

Expected: FAIL because `./widgetWindow` does not exist.

- [ ] **Step 3: Implement the controller**

Create `src/lib/widgetWindow.ts`:

```ts
import {
  logicalSquareToPhysical,
  planCollapse,
  planExpansion,
  type ExpansionAnchor,
  type Point,
  type Rect,
  type Size,
} from "./windowPlacement";

const COMPACT_SIDE = 100;
const EXPANDED_SIDE = 320;

export interface WidgetWindowState {
  position: Point;
  scaleFactor: number;
  workArea: Rect | null;
}

export interface WidgetWindowAdapter {
  readState(): Promise<WidgetWindowState>;
  applyFrame(logicalSide: number, physicalPosition: Point | null): Promise<void>;
}

export interface WidgetWindowController {
  setExpanded(expanded: boolean): Promise<void>;
}

interface ActiveExpansion {
  anchor: ExpansionAnchor;
  compactSize: Size;
  expandedSize: Size;
}

export function createWidgetWindowController(adapter: WidgetWindowAdapter): WidgetWindowController {
  let active: ActiveExpansion | null = null;
  let queue: Promise<void> = Promise.resolve();

  async function apply(expanded: boolean): Promise<void> {
    if (expanded && active) return;

    if (!expanded && !active) {
      await adapter.applyFrame(COMPACT_SIDE, null);
      return;
    }

    const state = await adapter.readState();
    const compactSize = logicalSquareToPhysical(COMPACT_SIDE, state.scaleFactor);
    const expandedSize = logicalSquareToPhysical(EXPANDED_SIDE, state.scaleFactor);

    if (expanded) {
      const placement = planExpansion({
        compactPosition: state.position, compactSize, expandedSize, workArea: state.workArea,
      });
      await adapter.applyFrame(EXPANDED_SIDE, placement.position);
      active = { anchor: placement.anchor, compactSize, expandedSize };
      return;
    }

    const transition = active;
    const position = planCollapse({
      expandedPosition: state.position,
      compactSize: transition.compactSize,
      expandedSize: transition.expandedSize,
      anchor: transition.anchor,
      workArea: state.workArea,
    });
    await adapter.applyFrame(COMPACT_SIDE, position);
    active = null;
  }

  return {
    setExpanded(expanded) {
      const operation = queue.then(() => apply(expanded));
      queue = operation.then(() => undefined, () => undefined);
      return operation;
    },
  };
}
```

- [ ] **Step 4: Run the focused controller tests and verify GREEN**

Run the same focused Vitest command. Expected: five controller tests pass.

- [ ] **Step 5: Replace the bridge's size-only implementation**

Add this import and module state near the top of `src/lib/bridge.ts`:

```ts
import { createWidgetWindowController, type WidgetWindowController } from "./widgetWindow";

let widgetWindowControllerPromise: Promise<WidgetWindowController> | null = null;
```

Replace `setWidgetExpanded` with:

```ts
async function getWidgetWindowController(): Promise<WidgetWindowController> {
  if (!widgetWindowControllerPromise) {
    widgetWindowControllerPromise = import("@tauri-apps/api/window").then((api) => {
      const currentWindow = api.getCurrentWindow();
      return createWidgetWindowController({
        async readState() {
          const [position, scaleFactor, monitor] = await Promise.all([
            currentWindow.outerPosition(),
            currentWindow.scaleFactor(),
            api.currentMonitor(),
          ]);
          return {
            position: { x: position.x, y: position.y },
            scaleFactor,
            workArea: monitor ? {
              x: monitor.workArea.position.x,
              y: monitor.workArea.position.y,
              width: monitor.workArea.size.width,
              height: monitor.workArea.size.height,
            } : null,
          };
        },
        async applyFrame(logicalSide, physicalPosition) {
          await currentWindow.setSize(new api.LogicalSize(logicalSide, logicalSide));
          if (physicalPosition) {
            await currentWindow.setPosition(new api.PhysicalPosition(
              Math.round(physicalPosition.x),
              Math.round(physicalPosition.y),
            ));
          }
        },
      });
    });
  }
  return widgetWindowControllerPromise;
}

export async function setWidgetExpanded(expanded: boolean): Promise<void> {
  if (!isTauri()) return;
  const controller = await getWidgetWindowController();
  await controller.setExpanded(expanded);
}
```

- [ ] **Step 6: Run controller tests, all frontend tests, and TypeScript build**

Run:

```bash
npx vitest run --dir src src/lib/widgetWindow.test.ts
npm test
npm run build
```

Expected: controller tests pass, the full frontend suite passes, and TypeScript/Vite build exits 0.

- [ ] **Step 7: Commit the controller and bridge integration**

```bash
git add src/lib/widgetWindow.ts src/lib/widgetWindow.test.ts src/lib/bridge.ts
git commit -m "feat: expand quota widget away from screen edges"
```

---

### Task 3: Document and verify the complete desktop behavior

**Files:**
- Modify: `docs/TEST-MATRIX.md`
- Modify: `docs/KNOWN-LIMITATIONS.md`

**Interfaces:**
- Consumes: Completed geometry/controller/bridge implementation from Tasks 1 and 2.
- Produces: Reproducible automated checks, a macOS edge/corner acceptance checklist, and a rebuilt `.app` bundle.

- [ ] **Step 1: Extend the window test matrix**

Add these rows under the existing window rows in `docs/TEST-MATRIX.md`:

```markdown
| 窗口 | 悬浮球位于屏幕四边和四角时 hover 展开 | 320×320 卡片按可用空间选择方向并完整留在工作区 | 几何与控制器自动化测试通过，待 macOS 实机验证 |
| 窗口 | 展开卡片拖动后收起 | 悬浮球收至拖动后卡片对应的锚点位置 | 控制器自动化测试通过，待 macOS 实机验证 |
| 窗口 | 快速反复进入/离开 hover | 窗口变换按请求顺序完成，最终状态与最后一次 hover 一致 | 控制器自动化测试通过 |
```

Add to the macOS release gate list:

```markdown
- macOS 实机确认悬浮球在屏幕中心、四边和四角展开时，卡片不被菜单栏、Dock 或屏幕边缘裁切。
- macOS 实机确认展开卡片拖动后，收起的悬浮球落在拖动后的对应锚点。
```

- [ ] **Step 2: Record the active-hover display boundary**

Add to `docs/KNOWN-LIMITATIONS.md`:

```markdown
- 展开方向按 hover 开始时所在显示器的工作区与缩放比例计算；单次展开期间跨显示器拖动不做二次方向计算。
```

- [ ] **Step 3: Run the complete automated verification suite**

Run each command separately and require exit code 0:

```bash
npm test
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri build -- --bundles app
git diff --check
```

Expected:

- Vitest reports all existing and new geometry/controller tests passing.
- TypeScript/Vite production build succeeds.
- Rust formatting and all Rust tests pass unchanged.
- Tauri emits `src-tauri/target/release/bundle/macos/TokenHalo.app`.
- Git whitespace check is clean.

- [ ] **Step 4: Run the macOS visual acceptance checklist**

Launch the rebuilt `.app` after quitting any older TokenHalo instance, then verify:

1. Center and top-left positions expand right/down.
2. Right-edge positions expand left; bottom-edge positions expand up.
3. All four corners choose the corresponding two-axis direction and remain fully visible.
4. Collapse returns the orb to its exact pre-hover position.
5. Dragging the expanded card changes the collapse anchor to the dragged location.
6. Rapid hover enter/leave does not leave the window at an intermediate size or position.
7. The same checks work in an ordinary Space and over another app's native fullscreen Space.

- [ ] **Step 5: Commit documentation and verified state**

```bash
git add docs/TEST-MATRIX.md docs/KNOWN-LIMITATIONS.md
git commit -m "docs: add edge-aware expansion verification"
```
