import { describe, expect, it } from "vitest";
import {
  planTaskToastPlacement,
  planTaskToastStackPlacement,
  type TaskToastPlacementInput,
} from "./taskToastPlacement";

const toastSize = { width: 260, height: 96 };
const workArea = { x: 0, y: 0, width: 1_440, height: 900 };

function input(
  orbFrame: TaskToastPlacementInput["orbFrame"],
  overrides: Partial<TaskToastPlacementInput> = {},
): TaskToastPlacementInput {
  return { orbFrame, toastSize, workArea, gap: 12, ...overrides };
}

describe("planTaskToastPlacement", () => {
  it("keeps the top anchor card fixed while the stack grows upward", () => {
    const single = planTaskToastStackPlacement({
      ...input({ x: 670, y: 400, width: 100, height: 100 }, { gap: 8 }),
      anchorSize: toastSize,
      direction: "top",
    });
    const expanded = planTaskToastStackPlacement({
      ...input({ x: 670, y: 400, width: 100, height: 100 }, { gap: 8 }),
      toastSize: { width: 260, height: 304 },
      anchorSize: toastSize,
      direction: "top",
    });

    expect(single.growth).toBe("up");
    expect(expanded.growth).toBe("up");
    expect(single.anchorPosition).toEqual({ x: 590, y: 296 });
    expect(expanded.anchorPosition).toEqual(single.anchorPosition);
    expect(expanded.position).toEqual({ x: 590, y: 88 });
    expect(expanded.fits).toBe(true);
  });

  it("grows a side stack toward the larger vertical work area", () => {
    const result = planTaskToastStackPlacement({
      ...input({ x: 1_200, y: 600, width: 100, height: 100 }),
      toastSize: { width: 260, height: 304 },
      anchorSize: toastSize,
      direction: "left",
    });

    expect(result.growth).toBe("up");
    expect(result.anchorPosition.y).toBe(602);
    expect(result.position).toEqual({ x: 928, y: 394 });
    expect(result.fits).toBe(true);
  });

  it("chooses top whenever the full top capsule fits", () => {
    const result = planTaskToastPlacement(input({ x: 670, y: 400, width: 100, height: 100 }));

    expect(result).toEqual({
      direction: "top",
      position: { x: 590, y: 292 },
      frame: { x: 590, y: 292, width: 260, height: 96 },
      visibleArea: 24_960,
    });
  });

  it("uses a side only when neither top nor bottom can fit", () => {
    const result = planTaskToastPlacement(input(
      { x: 1_200, y: 20, width: 100, height: 100 },
      { workArea: { x: 0, y: 0, width: 1_440, height: 210 } },
    ));

    expect(result.direction).toBe("left");
    expect(result.position).toEqual({ x: 928, y: 22 });
  });

  it("chooses bottom near the display top even when a side has more space", () => {
    const result = planTaskToastPlacement(input({ x: 15, y: 20, width: 100, height: 100 }));

    expect(result.direction).toBe("bottom");
    expect(result.position).toEqual({ x: 0, y: 132 });
  });

  it("falls back to bottom when only bottom fully fits", () => {
    const result = planTaskToastPlacement(input(
      { x: 200, y: 10, width: 100, height: 100 },
      { workArea: { x: 0, y: 0, width: 500, height: 500 } },
    ));

    expect(result.direction).toBe("bottom");
    expect(result.position).toEqual({ x: 120, y: 122 });
  });

  it("breaks equal-clearance side ties in left then right order", () => {
    const symmetric = input(
      { x: 450, y: 20, width: 100, height: 100 },
      { workArea: { x: 0, y: 0, width: 1_000, height: 210 } },
    );

    expect(planTaskToastPlacement(symmetric).direction).toBe("left");
  });

  it("chooses the most visible side and clamps when no direction fully fits", () => {
    const result = planTaskToastPlacement(input(
      { x: 80, y: 50, width: 100, height: 100 },
      { workArea: { x: 0, y: 0, width: 240, height: 220 } },
    ));

    expect(result.direction).toBe("left");
    expect(result.position).toEqual({ x: 0, y: 52 });
    expect(result.frame).toEqual({ x: 0, y: 52, width: 260, height: 96 });
  });

  it("respects non-zero work-area origins while clamping", () => {
    const result = planTaskToastPlacement(input(
      { x: -1_900, y: 40, width: 100, height: 100 },
      { workArea: { x: -1_920, y: 25, width: 240, height: 190 } },
    ));

    expect(result.position.x).toBe(-1_920);
    expect(result.position.y).toBeGreaterThanOrEqual(25);
  });

  it("keeps fractional logical geometry without applying a scale factor", () => {
    const result = planTaskToastPlacement(input({ x: 300.5, y: 250.25, width: 80.5, height: 80.5 }));

    expect(result.position).toEqual({ x: 210.75, y: 142.25 });
  });

  it("never mutates the orb frame", () => {
    const orbFrame = { x: 20, y: 20, width: 100, height: 100 };
    const before = { ...orbFrame };

    planTaskToastPlacement(input(orbFrame));

    expect(orbFrame).toEqual(before);
  });
});
