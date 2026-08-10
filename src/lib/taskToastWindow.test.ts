import { describe, expect, it, vi } from "vitest";
import type { TaskCompanionEntry } from "./taskCompanion";
import {
  createTaskToastWindowController,
  taskToastStackSize,
  type TaskToastShowRequest,
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

const stackEntries = ["one", "two", "three"].map((suffix, index): TaskCompanionEntry => ({
  ...entry,
  event: {
    ...entry.event,
    eventId: `event-${suffix}`,
    threadId: `thread-${suffix}`,
    occurredAt: `2026-08-04T10:00:0${index}.000Z`,
  },
}));

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
  it("uses compact peeks when collapsed and full cards when expanded", () => {
    expect(taskToastStackSize(1, false)).toEqual({ width: 260, height: 96 });
    expect(taskToastStackSize(3, false)).toEqual({ width: 260, height: 118 });
    expect(taskToastStackSize(3, true)).toEqual({ width: 260, height: 304 });
  });

  it("expands three task cards upward without moving the anchor card", async () => {
    const fake = adapter({
      readState: vi.fn(async () => ({
        orbPosition: { x: 1_000, y: 1_000 },
        orbSize: { width: 200, height: 200 },
        scaleFactor: 2,
        workArea: { x: 0, y: 0, width: 2_880, height: 1_800 },
      })),
    });
    const controller = createTaskToastWindowController(fake);

    await controller.show({
      entries: stackEntries,
      hiddenCount: 1,
      expanded: true,
      language: "zh-CN",
      openAction: "app",
    } as unknown as TaskToastShowRequest);

    expect(fake.apply).toHaveBeenCalledWith({
      physicalPosition: { x: 840, y: 376 },
      logicalSize: { width: 260, height: 304 },
      payload: expect.objectContaining({
        entries: stackEntries,
        hiddenCount: 1,
        expanded: true,
        visibleCapacity: 3,
        growth: "up",
        direction: "top",
      }),
    });
  });

  it("reduces visible capacity and rolls clipped cards into the hidden count", async () => {
    const fake = adapter({
      readState: vi.fn(async () => ({
        orbPosition: { x: 1_000, y: 400 },
        orbSize: { width: 200, height: 200 },
        scaleFactor: 2,
        workArea: { x: 0, y: 0, width: 2_880, height: 1_800 },
      })),
    });
    const controller = createTaskToastWindowController(fake);

    await controller.show({
      entries: stackEntries,
      hiddenCount: 1,
      expanded: true,
      language: "en",
      openAction: "app",
    } as unknown as TaskToastShowRequest);

    expect(fake.apply).toHaveBeenCalledWith(expect.objectContaining({
      logicalSize: { width: 260, height: 96 },
      payload: expect.objectContaining({
        entries: [stackEntries[0]],
        hiddenCount: 3,
        visibleCapacity: 1,
        growth: "up",
      }),
    }));
  });

  it("converts native geometry to logical units and positions before showing", async () => {
    const fake = adapter();
    const controller = createTaskToastWindowController(fake);

    const placement = await controller.show({
      entries: [entry],
      hiddenCount: 0,
      expanded: false,
      language: "zh-CN",
      openAction: "app",
    });

    expect(placement.direction).toBe("top");
    expect(fake.apply).toHaveBeenCalledWith({
      physicalPosition: { x: 840, y: 392 },
      logicalSize: { width: 260, height: 96 },
      payload: {
        entries: [entry],
        hiddenCount: 0,
        expanded: false,
        visibleCapacity: 1,
        growth: "up",
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

    expect((await controller.show({
      entries: [entry],
      hiddenCount: 0,
      expanded: false,
      language: "en",
      openAction: "none",
    })).direction)
      .toBe("top");
    expect((await controller.show({
      entries: [entry],
      hiddenCount: 0,
      expanded: false,
      language: "en",
      openAction: "none",
    })).direction)
      .toBe("bottom");
    expect(readState).toHaveBeenCalledTimes(2);
  });

  it("places the first-use permission capsule with the same adaptive rules", async () => {
    const fake = adapter();
    const controller = createTaskToastWindowController(fake);

    await controller.show({ kind: "permission", language: "zh-CN" });

    expect(fake.apply).toHaveBeenCalledWith(expect.objectContaining({
      payload: {
        kind: "permission",
        direction: "top",
        language: "zh-CN",
      },
    }));
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
