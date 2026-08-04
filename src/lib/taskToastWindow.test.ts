import { describe, expect, it, vi } from "vitest";
import type { TaskCompanionEntry } from "./taskCompanion";
import {
  createTaskToastWindowController,
  type TaskToastWindowAdapter,
} from "./taskToastWindow";

const entry: TaskCompanionEntry = {
  event: {
    schemaVersion: 1,
    eventId: "event-one",
    threadId: "thread-one",
    turnId: "turn-one",
    status: "completed",
    occurredAt: "2026-08-04T10:00:00.000Z",
    projectName: "TokenHalo",
    taskTitle: null,
    durationMs: 70_000,
    source: "simulator",
  },
  acknowledged: false,
  postponedUntil: null,
  toastExpired: false,
};

function adapter(overrides: Partial<TaskToastWindowAdapter> = {}): TaskToastWindowAdapter {
  return {
    readState: vi.fn(async () => ({
      orbPosition: { x: 1_000, y: 600 },
      orbSize: { width: 200, height: 200 },
      scaleFactor: 2,
      workArea: { x: 0, y: 0, width: 2_880, height: 1_800 },
    })),
    apply: vi.fn(async () => undefined),
    hide: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("createTaskToastWindowController", () => {
  it("converts native geometry to logical units and positions before showing", async () => {
    const fake = adapter();
    const controller = createTaskToastWindowController(fake);

    const placement = await controller.show({
      entry,
      language: "zh-CN",
      openAction: "app",
    });

    expect(placement.direction).toBe("top");
    expect(fake.apply).toHaveBeenCalledWith({
      physicalPosition: { x: 840, y: 384 },
      logicalSize: { width: 260, height: 96 },
      payload: {
        entry,
        direction: "top",
        language: "zh-CN",
        openAction: "app",
      },
    });
  });

  it("recomputes placement from the latest orb position each time", async () => {
    const readState = vi.fn()
      .mockResolvedValueOnce({
        orbPosition: { x: 500, y: 400 },
        orbSize: { width: 100, height: 100 },
        scaleFactor: 1,
        workArea: { x: 0, y: 0, width: 1_440, height: 900 },
      })
      .mockResolvedValueOnce({
        orbPosition: { x: 10, y: 10 },
        orbSize: { width: 100, height: 100 },
        scaleFactor: 1,
        workArea: { x: 0, y: 0, width: 1_440, height: 900 },
      });
    const fake = adapter({ readState });
    const controller = createTaskToastWindowController(fake);

    expect((await controller.show({ entry, language: "en", openAction: "none" })).direction)
      .toBe("top");
    expect((await controller.show({ entry, language: "en", openAction: "none" })).direction)
      .toBe("right");
    expect(readState).toHaveBeenCalledTimes(2);
  });

  it("hides only the toast surface", async () => {
    const fake = adapter();
    const controller = createTaskToastWindowController(fake);

    await controller.hide();

    expect(fake.hide).toHaveBeenCalledOnce();
    expect(fake.readState).not.toHaveBeenCalled();
    expect(fake.apply).not.toHaveBeenCalled();
  });
});
