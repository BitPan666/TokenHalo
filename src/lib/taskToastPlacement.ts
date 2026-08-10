export type ToastDirection = "top" | "left" | "right" | "bottom";

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Rect extends Point, Size {}

export interface TaskToastPlacementInput {
  orbFrame: Rect;
  toastSize: Size;
  workArea: Rect;
  gap: number;
}

export interface TaskToastPlacement {
  direction: ToastDirection;
  position: Point;
  frame: Rect;
  visibleArea: number;
}

export type TaskToastStackGrowth = "up" | "down";

export interface TaskToastStackPlacementInput extends TaskToastPlacementInput {
  anchorSize: Size;
  direction: ToastDirection;
}

export interface TaskToastStackPlacement extends TaskToastPlacement {
  growth: TaskToastStackGrowth;
  anchorPosition: Point;
  fits: boolean;
}

interface Candidate {
  direction: ToastDirection;
  frame: Rect;
  fits: boolean;
  clearance: number;
  visibleArea: number;
}

const SIDE_DIRECTIONS: ToastDirection[] = ["left", "right"];
const ALL_DIRECTIONS: ToastDirection[] = ["top", "bottom", ...SIDE_DIRECTIONS];

function candidateFrame(
  direction: ToastDirection,
  orb: Rect,
  toast: Size,
  gap: number,
): Rect {
  if (direction === "top") {
    return {
      x: orb.x + (orb.width - toast.width) / 2,
      y: orb.y - gap - toast.height,
      ...toast,
    };
  }
  if (direction === "left") {
    return {
      x: orb.x - gap - toast.width,
      y: orb.y + (orb.height - toast.height) / 2,
      ...toast,
    };
  }
  if (direction === "right") {
    return {
      x: orb.x + orb.width + gap,
      y: orb.y + (orb.height - toast.height) / 2,
      ...toast,
    };
  }
  return {
    x: orb.x + (orb.width - toast.width) / 2,
    y: orb.y + orb.height + gap,
    ...toast,
  };
}

function areaVisibleInside(frame: Rect, bounds: Rect) {
  const left = Math.max(frame.x, bounds.x);
  const top = Math.max(frame.y, bounds.y);
  const right = Math.min(frame.x + frame.width, bounds.x + bounds.width);
  const bottom = Math.min(frame.y + frame.height, bounds.y + bounds.height);
  return Math.max(0, right - left) * Math.max(0, bottom - top);
}

function evaluate(direction: ToastDirection, input: TaskToastPlacementInput): Candidate {
  const frame = candidateFrame(direction, input.orbFrame, input.toastSize, input.gap);
  const margins = [
    frame.x - input.workArea.x,
    frame.y - input.workArea.y,
    input.workArea.x + input.workArea.width - (frame.x + frame.width),
    input.workArea.y + input.workArea.height - (frame.y + frame.height),
  ];
  return {
    direction,
    frame,
    fits: margins.every((margin) => margin >= 0),
    clearance: Math.min(...margins),
    visibleArea: areaVisibleInside(frame, input.workArea),
  };
}

function clamp(value: number, minimum: number, maximum: number) {
  if (maximum < minimum) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}

function clampFrame(frame: Rect, bounds: Rect): Rect {
  return {
    ...frame,
    x: clamp(frame.x, bounds.x, bounds.x + bounds.width - frame.width),
    y: clamp(frame.y, bounds.y, bounds.y + bounds.height - frame.height),
  };
}

export function planTaskToastPlacement(input: TaskToastPlacementInput): TaskToastPlacement {
  const candidates = ALL_DIRECTIONS.map((direction) => evaluate(direction, input));
  const top = candidates[0];
  const bottom = candidates[1];
  const workAreaBottom = input.workArea.y + input.workArea.height;
  const verticallyFits = (candidate: Candidate) => (
    candidate.frame.y >= input.workArea.y
    && candidate.frame.y + candidate.frame.height <= workAreaBottom
  );
  let selected: Candidate;

  if (verticallyFits(top)) {
    selected = top;
  } else if (verticallyFits(bottom)) {
    selected = bottom;
  } else {
    const sideCandidates = candidates
      .filter((candidate) => SIDE_DIRECTIONS.includes(candidate.direction));
    const fullyFitting = sideCandidates
      .filter((candidate) => candidate.fits)
      .sort((left, right) => right.clearance - left.clearance);
    selected = fullyFitting[0] ?? sideCandidates
      .slice()
      .sort((left, right) => right.visibleArea - left.visibleArea)[0];
  }

  const frame = selected.fits ? selected.frame : clampFrame(selected.frame, input.workArea);
  return {
    direction: selected.direction,
    position: { x: frame.x, y: frame.y },
    frame,
    visibleArea: selected.visibleArea,
  };
}

export function planTaskToastStackPlacement(
  input: TaskToastStackPlacementInput,
): TaskToastStackPlacement {
  const { direction, orbFrame, toastSize, anchorSize, workArea, gap } = input;
  const anchorY = orbFrame.y + (orbFrame.height - anchorSize.height) / 2;
  const spaceAbove = anchorY - workArea.y;
  const spaceBelow = workArea.y + workArea.height - (anchorY + anchorSize.height);
  const growth: TaskToastStackGrowth = direction === "top"
    ? "up"
    : direction === "bottom"
      ? "down"
      : spaceAbove > spaceBelow ? "up" : "down";

  let rawFrame: Rect;
  if (direction === "top") {
    rawFrame = {
      x: orbFrame.x + (orbFrame.width - toastSize.width) / 2,
      y: orbFrame.y - gap - toastSize.height,
      ...toastSize,
    };
  } else if (direction === "bottom") {
    rawFrame = {
      x: orbFrame.x + (orbFrame.width - toastSize.width) / 2,
      y: orbFrame.y + orbFrame.height + gap,
      ...toastSize,
    };
  } else {
    rawFrame = {
      x: direction === "left"
        ? orbFrame.x - gap - toastSize.width
        : orbFrame.x + orbFrame.width + gap,
      y: growth === "up"
        ? anchorY - (toastSize.height - anchorSize.height)
        : anchorY,
      ...toastSize,
    };
  }

  const workAreaRight = workArea.x + workArea.width;
  const workAreaBottom = workArea.y + workArea.height;
  const verticalFits = rawFrame.y >= workArea.y
    && rawFrame.y + rawFrame.height <= workAreaBottom;
  const horizontalFits = rawFrame.x >= workArea.x
    && rawFrame.x + rawFrame.width <= workAreaRight;
  const fits = direction === "top" || direction === "bottom"
    ? verticalFits && toastSize.width <= workArea.width
    : horizontalFits && verticalFits;
  const frame = direction === "top" || direction === "bottom"
    ? { ...rawFrame, x: clamp(rawFrame.x, workArea.x, workAreaRight - rawFrame.width) }
    : fits ? rawFrame : clampFrame(rawFrame, workArea);
  const anchorPosition = {
    x: frame.x,
    y: growth === "up"
      ? frame.y + frame.height - anchorSize.height
      : frame.y,
  };

  return {
    direction,
    growth,
    position: { x: frame.x, y: frame.y },
    frame,
    anchorPosition,
    fits,
    visibleArea: areaVisibleInside(rawFrame, workArea),
  };
}
