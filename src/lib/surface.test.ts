import { describe, expect, it } from "vitest";
import { resolveAppSurface } from "./surface";

describe("resolveAppSurface", () => {
  it("routes native toast, task simulator, legacy designer, and widget surfaces", () => {
    expect(resolveAppSurface("?surface=task-toast")).toBe("taskToast");
    expect(resolveAppSurface("?surface=task-designer")).toBe("taskDesigner");
    expect(resolveAppSurface("?designer&mode=orb")).toBe("designer");
    expect(resolveAppSurface("")).toBe("widget");
  });
});
