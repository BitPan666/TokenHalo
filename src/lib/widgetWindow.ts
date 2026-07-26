import {
  logicalSquareToPhysical,
  planAnchoredResize,
  planCollapse,
  planExpansion,
  type ExpansionAnchor,
  type Point,
  type Rect,
  type Size,
} from "./windowPlacement";

const COMPACT_SIDE = 100;

const SIDE_BY_MODE: Record<WidgetDisplayMode, number> = {
  compact: COMPACT_SIDE,
  quota: 320,
  stats: 400,
};

export type WidgetDisplayMode = "compact" | "quota" | "stats";

export interface WidgetWindowState {
  position: Point;
  scaleFactor: number;
  workArea: Rect | null;
}

export interface WidgetWindowAdapter {
  readState(): Promise<WidgetWindowState>;
  applyFrame(
    logicalSide: number,
    physicalPosition: Point | null,
    mode: WidgetDisplayMode,
  ): Promise<void>;
}

export interface WidgetWindowController {
  setMode(mode: WidgetDisplayMode): Promise<void>;
}

export function createWidgetWindowController(adapter: WidgetWindowAdapter): WidgetWindowController {
  let currentMode: WidgetDisplayMode = "compact";
  let anchor: ExpansionAnchor | null = null;
  let currentPhysicalSize: Size | null = null;
  let queue: Promise<void> | null = null;

  async function apply(mode: WidgetDisplayMode): Promise<void> {
    if (mode === currentMode) {
      await adapter.applyFrame(SIDE_BY_MODE[mode], null, mode);
      return;
    }

    const state = await adapter.readState();
    const targetSize = logicalSquareToPhysical(SIDE_BY_MODE[mode], state.scaleFactor);
    const sourceSize = currentPhysicalSize
      ?? logicalSquareToPhysical(SIDE_BY_MODE[currentMode], state.scaleFactor);

    if (currentMode === "compact") {
      const placement = planExpansion({
        compactPosition: state.position,
        compactSize: sourceSize,
        expandedSize: targetSize,
        workArea: state.workArea,
      });
      await adapter.applyFrame(SIDE_BY_MODE[mode], placement.position, mode);
      currentMode = mode;
      currentPhysicalSize = targetSize;
      anchor = placement.anchor;
      return;
    }

    if (!anchor) throw new Error("Expanded widget mode is missing an anchor.");

    if (mode === "compact") {
      const position = planCollapse({
        expandedPosition: state.position,
        compactSize: targetSize,
        expandedSize: sourceSize,
        anchor,
        workArea: state.workArea,
      });
      await adapter.applyFrame(COMPACT_SIDE, position, mode);
      currentMode = mode;
      currentPhysicalSize = targetSize;
      anchor = null;
      return;
    }

    const position = planAnchoredResize({
      position: state.position,
      fromSize: sourceSize,
      toSize: targetSize,
      anchor,
      workArea: state.workArea,
    });
    await adapter.applyFrame(SIDE_BY_MODE[mode], position, mode);
    currentMode = mode;
    currentPhysicalSize = targetSize;
  }

  return {
    setMode(mode) {
      const operation = queue ? queue.then(() => apply(mode)) : apply(mode);
      const settled = operation.then(() => undefined, () => undefined);
      queue = settled;
      void settled.finally(() => {
        if (queue === settled) queue = null;
      });
      return operation;
    },
  };
}
