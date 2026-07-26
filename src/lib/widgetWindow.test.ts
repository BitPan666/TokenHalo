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

    await controller.setMode("quota");
    await controller.setMode("compact");

    expect(fake.frames).toEqual([
      { logicalSide: 320, position: { x: 1120, y: 580 } },
      { logicalSide: 100, position: { x: 1340, y: 800 } },
    ]);
  });

  it("collapses to the selected anchor after the expanded card is dragged", async () => {
    const fake = fakeAdapter({ position: { x: 1340, y: 800 }, scaleFactor: 1, workArea });
    const controller = createWidgetWindowController(fake.adapter);

    await controller.setMode("quota");
    fake.moveTo({ x: 700, y: 400 });
    await controller.setMode("compact");

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

    const expanding = controller.setMode("quota");
    const collapsing = controller.setMode("compact");
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
      controller.setMode("quota"),
      controller.setMode("compact"),
      controller.setMode("quota"),
    ]);

    expect(fake.frames.map((frame) => frame.logicalSide)).toEqual([320, 100, 320]);
  });

  it("continues processing after an adapter failure", async () => {
    const fake = fakeAdapter({ position: { x: 400, y: 300 }, scaleFactor: 1, workArea });
    vi.mocked(fake.adapter.applyFrame).mockRejectedValueOnce(new Error("resize failed"));
    const controller = createWidgetWindowController(fake.adapter);

    await expect(controller.setMode("quota")).rejects.toThrow("resize failed");
    await expect(controller.setMode("quota")).resolves.toBeUndefined();
    expect(fake.adapter.applyFrame).toHaveBeenCalledTimes(2);
  });

  it("reasserts the expanded size after a partial collapse failure", async () => {
    const fake = fakeAdapter({ position: { x: 1340, y: 800 }, scaleFactor: 1, workArea });
    const controller = createWidgetWindowController(fake.adapter);
    await controller.setMode("quota");
    vi.mocked(fake.adapter.applyFrame).mockImplementationOnce(async (logicalSide, position) => {
      fake.frames.push({ logicalSide, position });
      throw new Error("position failed after resize");
    });

    await expect(controller.setMode("compact")).rejects.toThrow("position failed after resize");
    await expect(controller.setMode("quota")).resolves.toBeUndefined();

    expect(fake.frames.map((frame) => frame.logicalSide)).toEqual([320, 100, 320]);
    expect(fake.frames.at(-1)?.position).toBeNull();
  });

  it("switches quota to stats and keeps a bottom-right anchor", async () => {
    const fake = fakeAdapter({ position: { x: 1340, y: 800 }, scaleFactor: 1, workArea });
    const controller = createWidgetWindowController(fake.adapter);

    await controller.setMode("quota");
    await controller.setMode("stats");

    expect(fake.frames).toEqual([
      { logicalSide: 320, position: { x: 1120, y: 580 } },
      { logicalSide: 400, position: { x: 1040, y: 500 } },
    ]);
  });

  it("switches stats back to quota at logical side 320 with the same anchor", async () => {
    const fake = fakeAdapter({ position: { x: 1340, y: 800 }, scaleFactor: 1, workArea });
    const controller = createWidgetWindowController(fake.adapter);

    await controller.setMode("stats");
    await controller.setMode("quota");

    expect(fake.frames).toEqual([
      { logicalSide: 400, position: { x: 1040, y: 500 } },
      { logicalSide: 320, position: { x: 1120, y: 580 } },
    ]);
  });

  it("passes every requested mode to the frame adapter including repeated modes", async () => {
    const fake = fakeAdapter({ position: { x: 400, y: 300 }, scaleFactor: 1, workArea });
    const controller = createWidgetWindowController(fake.adapter);

    await controller.setMode("compact");
    await controller.setMode("quota");
    await controller.setMode("quota");
    await controller.setMode("stats");

    expect(vi.mocked(fake.adapter.applyFrame).mock.calls.map((call) => call[2]))
      .toEqual(["compact", "quota", "quota", "stats"]);
  });
});
