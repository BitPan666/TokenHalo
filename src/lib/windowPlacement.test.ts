import { describe, expect, it } from "vitest";
import {
  logicalSquareToPhysical,
  planCollapse,
  planAnchoredResize,
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

describe("planAnchoredResize", () => {
  it("grows a right-bottom anchored quota card to stats size without moving its anchor", () => {
    expect(planAnchoredResize({
      position: { x: 1120, y: 580 },
      fromSize: { width: 320, height: 320 },
      toSize: { width: 400, height: 400 },
      anchor: { horizontal: "right", vertical: "bottom" },
      workArea,
    })).toEqual({ x: 1040, y: 500 });
  });

  it("shrinks a left-top stats card to quota size in place", () => {
    expect(planAnchoredResize({
      position: { x: 200, y: 160 },
      fromSize: { width: 400, height: 400 },
      toSize: { width: 320, height: 320 },
      anchor: { horizontal: "left", vertical: "top" },
      workArea,
    })).toEqual({ x: 200, y: 160 });
  });
});

it("converts logical square sizes to physical pixels", () => {
  expect(logicalSquareToPhysical(100, 2)).toEqual({ width: 200, height: 200 });
  expect(logicalSquareToPhysical(320, 1.5)).toEqual({ width: 480, height: 480 });
});

it("preserves the right-bottom anchor through scaled expansion and collapse", () => {
  const scaledCompactSize = logicalSquareToPhysical(100, 1.5);
  const scaledExpandedSize = logicalSquareToPhysical(320, 1.5);
  const compactPosition = { x: 1290, y: 750 };
  const expansion = planExpansion({
    compactPosition,
    compactSize: scaledCompactSize,
    expandedSize: scaledExpandedSize,
    workArea,
  });

  expect(expansion).toEqual({
    position: { x: 960, y: 420 },
    anchor: { horizontal: "right", vertical: "bottom" },
  });
  expect(planCollapse({
    expandedPosition: expansion.position,
    compactSize: scaledCompactSize,
    expandedSize: scaledExpandedSize,
    anchor: expansion.anchor,
    workArea,
  })).toEqual(compactPosition);
});
