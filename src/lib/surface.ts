export type AppSurface = "widget" | "designer" | "taskDesigner" | "taskToast";

export function resolveAppSurface(search: string): AppSurface {
  const params = new URLSearchParams(search);
  const surface = params.get("surface");
  if (surface === "task-toast") return "taskToast";
  if (surface === "task-designer") return "taskDesigner";
  if (params.has("designer")) return "designer";
  return "widget";
}
