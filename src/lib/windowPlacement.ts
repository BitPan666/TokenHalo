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

interface AnchoredResizeInput {
  position: Point;
  fromSize: Size;
  toSize: Size;
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

export function planAnchoredResize(input: AnchoredResizeInput): Point {
  const { position, fromSize, toSize, anchor, workArea } = input;
  return clampPosition({
    x: anchor.horizontal === "right" ? position.x + fromSize.width - toSize.width : position.x,
    y: anchor.vertical === "bottom" ? position.y + fromSize.height - toSize.height : position.y,
  }, toSize, workArea);
}
