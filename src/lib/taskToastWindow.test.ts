import { describe, expect, it, vi } from "vitest";
import type { TaskCompanionEntry } from "./taskCompanion";
import {
  createTaskToastWindowController,
  taskStatusGroupStackSize,
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

function withStatus(
  source: TaskCompanionEntry,
  threadId: string,
  status: TaskCompanionEntry["event"]["status"],
  second: number,
): TaskCompanionEntry {
  return {
    ...source,
    event: {
      ...source.event,
      eventId: `${threadId}-${status}`,
      threadId,
      status,
      occurredAt: `2026-08-04T10:00:${String(second).padStart(2, "0")}.000Z`,
    },
  };
}

const fourStatusEntries = [
  withStatus(entry, "input", "needsInput", 4),
  withStatus(entry, "failed", "failed", 3),
  withStatus(entry, "completed", "completed", 2),
  withStatus(entry, "working", "working", 1),
];

const collapsedLayout = { outerExpanded: false, expandedStatus: null } as const;

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
  it("sizes collapsed, outer-expanded, and inner-expanded grouped layouts", () => {
    expect(taskStatusGroupStackSize([entry], collapsedLayout))
      .toEqual({ width: 272, height: 96 });
    expect(taskStatusGroupStackSize(stackEntries, collapsedLayout))
      .toEqual({ width: 272, height: 116 });
    expect(taskStatusGroupStackSize(fourStatusEntries, {
      outerExpanded: true,
      expandedStatus: null,
    })).toEqual({ width: 272, height: 372 });
    expect(taskStatusGroupStackSize([
      withStatus(entry, "input-one", "needsInput", 3),
      withStatus(entry, "input-two", "needsInput", 2),
      withStatus(entry, "input-three", "needsInput", 1),
    ], {
      outerExpanded: true,
      expandedStatus: "needsInput",
    })).toEqual({ width: 272, height: 280 });
  });

  it("expands four status groups upward without moving the anchor card", async () => {
    const fake = adapter({
      readState: vi.fn(async () => ({
        orbPosition: { x: 1_000, y: 1_000 },
        orbSize: { width: 200, height: 200 },
        scaleFactor: 2,
        workArea: { x: 0, y: 0, width: 2_880, height: 1_800 },
      })),
    });
    const controller = createTaskToastWindowController(fake);

    const collapsed = await controller.show({
      entries: fourStatusEntries,
      layout: collapsedLayout,
      language: "zh-CN",
      openAction: "app",
    } as unknown as TaskToastShowRequest);
    const expanded = await controller.show({
      entries: fourStatusEntries,
      layout: { outerExpanded: true, expandedStatus: null },
      language: "zh-CN",
      openAction: "app",
    } as unknown as TaskToastShowRequest);

    expect("anchorPosition" in collapsed).toBe(true);
    expect("anchorPosition" in expanded).toBe(true);
    if (!("anchorPosition" in collapsed) || !("anchorPosition" in expanded)) {
      throw new Error("grouped task placement must expose its anchor position");
    }
    expect(collapsed.anchorPosition).toEqual(expanded.anchorPosition);
    expect(fake.apply).toHaveBeenLastCalledWith({
      physicalPosition: { x: 828, y: 240 },
      logicalSize: { width: 272, height: 372 },
      payload: expect.objectContaining({
        entries: fourStatusEntries,
        layout: { outerExpanded: true, expandedStatus: null },
        growth: "up",
        direction: "top",
      }),
    });
  });

  it("converts native geometry to logical units and positions before showing", async () => {
    const fake = adapter();
    const controller = createTaskToastWindowController(fake);

    const placement = await controller.show({
      entries: [entry],
      layout: collapsedLayout,
      language: "zh-CN",
      openAction: "app",
    });

    expect(placement.direction).toBe("top");
    expect(fake.apply).toHaveBeenCalledWith({
      physicalPosition: { x: 828, y: 392 },
      logicalSize: { width: 272, height: 96 },
      payload: {
        entries: [entry],
        hiddenCount: 0,
        expanded: false,
        visibleCapacity: 1,
        layout: collapsedLayout,
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
      layout: collapsedLayout,
      language: "en",
      openAction: "none",
    })).direction)
      .toBe("top");
    expect((await controller.show({
      entries: [entry],
      layout: collapsedLayout,
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
