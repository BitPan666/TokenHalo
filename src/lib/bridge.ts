import type { ProviderSnapshot, TaskCompanionConnectionStatus, WidgetPreferences } from "../types";
import type { TaskCompanionEvent } from "./taskCompanion";
import type { TaskOpenResult } from "./useTaskCompanion";
import packageInfo from "../../package.json";
import {
  createWidgetWindowController,
  type WidgetDisplayMode,
  type WidgetWindowController,
} from "./widgetWindow";
import {
  createTaskToastWindowController,
  type TaskToastActionPayload,
  type TaskToastDisplayPayload,
  type TaskToastShowRequest,
  type TaskToastWindowController,
} from "./taskToastWindow";

let widgetWindowControllerPromise: Promise<WidgetWindowController> | null = null;
let taskToastWindowControllerPromise: Promise<TaskToastWindowController> | null = null;

const defaultPreferences: WidgetPreferences = { locked: false, alwaysOnTop: true, pinnedProvider: null, autoRotateSeconds: 12, language: "zh-CN", expandedView: "quota", glassTransparency: 40, glassBlurStrength: 40, glassStyle: "regular" };

const mockSnapshot: ProviderSnapshot = {
  provider: "codex",
  displayName: "CODEX",
  plan: "PRO",
  shortWindow: { remainingPercent: 74, resetsAt: new Date(Date.now() + 78 * 60_000).toISOString(), windowSeconds: 18_000 },
  weeklyWindow: { remainingPercent: 42, resetsAt: new Date(Date.now() + 3.2 * 86_400_000).toISOString(), windowSeconds: 604_800 },
  resetCredits: 1,
  resetCreditExpiresAt: [new Date(Date.now() + 9 * 86_400_000).toISOString()],
  updatedAt: new Date().toISOString(),
  status: "ok",
  message: null,
};

export interface UpdateCheckResult {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  releaseUrl: string;
}

export const isTauri = () => "__TAURI_INTERNALS__" in window;

export async function fetchSnapshots(force = false): Promise<ProviderSnapshot[]> {
  if (!isTauri()) return [mockSnapshot];
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<ProviderSnapshot[]>(force ? "refresh_snapshots" : "get_snapshots");
}

export async function getPreferences(): Promise<WidgetPreferences> {
  if (!isTauri()) return defaultPreferences;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<WidgetPreferences>("get_preferences");
}

export async function getWidgetPointerInside(): Promise<boolean> {
  if (!isTauri()) return false;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<boolean>("get_widget_pointer_inside");
}

export async function updatePreferences(value: WidgetPreferences): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("set_preferences", { preferences: value });
}

export async function checkForUpdates(): Promise<UpdateCheckResult> {
  if (!isTauri()) {
    return {
      currentVersion: packageInfo.version,
      latestVersion: packageInfo.version,
      updateAvailable: false,
      releaseUrl: "https://github.com/BitPan666/TokenHalo/releases/latest",
    };
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<UpdateCheckResult>("check_for_updates");
}

export async function openReleasePage(releaseUrl: string): Promise<void> {
  if (!isTauri()) {
    window.open(releaseUrl, "_blank", "noopener,noreferrer");
    return;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("open_release_page");
}

export async function setClickThrough(locked: boolean): Promise<WidgetPreferences> {
  if (!isTauri()) return { ...defaultPreferences, locked };
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<WidgetPreferences>("set_widget_locked", { locked });
}

export async function setAlwaysOnTop(alwaysOnTop: boolean): Promise<WidgetPreferences> {
  if (!isTauri()) return { ...defaultPreferences, alwaysOnTop };
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<WidgetPreferences>("set_widget_always_on_top", { alwaysOnTop });
}

export async function startDragging(): Promise<void> {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().startDragging();
}

async function getWidgetWindowController(): Promise<WidgetWindowController> {
  if (!widgetWindowControllerPromise) {
    widgetWindowControllerPromise = import("@tauri-apps/api/window").then((api) => {
      const currentWindow = api.getCurrentWindow();
      return createWidgetWindowController({
        async readState() {
          const [position, scaleFactor, monitor] = await Promise.all([
            currentWindow.outerPosition(),
            currentWindow.scaleFactor(),
            api.currentMonitor(),
          ]);
          return {
            position: { x: position.x, y: position.y },
            scaleFactor,
            workArea: monitor ? {
              x: monitor.workArea.position.x,
              y: monitor.workArea.position.y,
              width: monitor.workArea.size.width,
              height: monitor.workArea.size.height,
            } : null,
          };
        },
        async applyFrame(logicalSide, physicalPosition, mode) {
          await currentWindow.setSize(new api.LogicalSize(logicalSide, logicalSide));
          if (physicalPosition) {
            await currentWindow.setPosition(new api.PhysicalPosition(
              Math.round(physicalPosition.x),
              Math.round(physicalPosition.y),
            ));
          }
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("set_native_glass_mode", { mode });
        },
      });
    });
  }
  return widgetWindowControllerPromise;
}

export async function setWidgetMode(mode: WidgetDisplayMode): Promise<void> {
  if (!isTauri()) return;
  const controller = await getWidgetWindowController();
  await controller.setMode(mode);
}

/** @deprecated Temporary compatibility wrapper until the UI selects display modes. */
export async function setWidgetExpanded(expanded: boolean): Promise<void> {
  await setWidgetMode(expanded ? "quota" : "compact");
}

export async function listenDesktopEvents(handlers: {
  onPreferences: (value: WidgetPreferences) => void;
  onRefresh: () => void;
  onNativePointer?: (payload: TaskToastNativePointer) => void;
}): Promise<() => void> {
  if (!isTauri()) return () => undefined;
  const { listen } = await import("@tauri-apps/api/event");
  const unlistenPreferences = await listen<WidgetPreferences>("preferences-changed", (event) => handlers.onPreferences(event.payload));
  const unlistenRefresh = await listen("refresh-requested", handlers.onRefresh);
  const unlistenNativePointer = await listen<TaskToastNativePointer>(
    "task-toast-native-pointer",
    (event) => handlers.onNativePointer?.(event.payload),
  );
  return () => {
    unlistenPreferences();
    unlistenRefresh();
    unlistenNativePointer();
  };
}

async function getTaskToastWindowController(): Promise<TaskToastWindowController> {
  if (!taskToastWindowControllerPromise) {
    taskToastWindowControllerPromise = Promise.all([
      import("@tauri-apps/api/window"),
      import("@tauri-apps/api/event"),
      import("@tauri-apps/api/core"),
    ]).then(async ([api, eventApi, coreApi]) => {
      const widget = await api.Window.getByLabel("widget");
      const toast = await api.Window.getByLabel("task-toast");
      if (!widget || !toast) throw new Error("task toast windows unavailable");
      return createTaskToastWindowController({
        async readState() {
          const [orbPosition, orbSize, scaleFactor] = await Promise.all([
            widget.outerPosition(),
            widget.outerSize(),
            widget.scaleFactor(),
          ]);
          const monitor = await api.monitorFromPoint(
            orbPosition.x + orbSize.width / 2,
            orbPosition.y + orbSize.height / 2,
          ) ?? await api.currentMonitor();
          if (!monitor) throw new Error("widget monitor unavailable");
          return {
            orbPosition: { x: orbPosition.x, y: orbPosition.y },
            orbSize: { width: orbSize.width, height: orbSize.height },
            scaleFactor,
            workArea: {
              x: monitor.workArea.position.x,
              y: monitor.workArea.position.y,
              width: monitor.workArea.size.width,
              height: monitor.workArea.size.height,
            },
          };
        },
        async apply(request) {
          await coreApi.invoke("set_task_toast_frame", {
            x: request.physicalPosition.x,
            y: request.physicalPosition.y,
            width: request.logicalSize.width,
            height: request.logicalSize.height,
          });
          await eventApi.emitTo("task-toast", "task-toast-display", request.payload);
          await coreApi.invoke("show_task_toast_without_focus");
        },
        async hide() {
          await eventApi.emitTo("task-toast", "task-toast-hide");
          await toast.hide();
        },
      });
    });
  }
  return taskToastWindowControllerPromise;
}

export async function showTaskToast(request: TaskToastShowRequest) {
  if (!isTauri()) return null;
  return (await getTaskToastWindowController()).show(request);
}

export async function hideTaskToast() {
  if (!isTauri()) return;
  await (await getTaskToastWindowController()).hide();
}

export interface TaskToastNativePointer {
  inside: boolean;
  x?: number;
  y?: number;
}

export async function listenTaskToastSurfaceEvents(handlers: {
  onDisplay: (payload: TaskToastDisplayPayload) => void;
  onHide: () => void;
  onNativePointer?: (payload: TaskToastNativePointer) => void;
}): Promise<() => void> {
  if (!isTauri()) return () => undefined;
  const { listen } = await import("@tauri-apps/api/event");
  const unlistenDisplay = await listen<TaskToastDisplayPayload>(
    "task-toast-display",
    (event) => handlers.onDisplay(event.payload),
  );
  const unlistenHide = await listen("task-toast-hide", handlers.onHide);
  const unlistenNativePointer = await listen<TaskToastNativePointer>(
    "task-toast-native-pointer",
    (event) => handlers.onNativePointer?.(event.payload),
  );
  return () => {
    unlistenDisplay();
    unlistenHide();
    unlistenNativePointer();
  };
}

export async function emitTaskToastAction(payload: TaskToastActionPayload) {
  if (!isTauri()) return;
  const { emitTo } = await import("@tauri-apps/api/event");
  await emitTo("widget", "task-toast-action", payload);
}

export async function listenTaskToastActions(
  handler: (payload: TaskToastActionPayload) => void,
): Promise<() => void> {
  if (!isTauri()) return () => undefined;
  const { listen } = await import("@tauri-apps/api/event");
  return listen<TaskToastActionPayload>("task-toast-action", (event) => handler(event.payload));
}

export async function listenTaskCompanionEvents(
  handler: (payload: TaskCompanionEvent) => void,
): Promise<() => void> {
  if (!isTauri()) return () => undefined;
  const { listen } = await import("@tauri-apps/api/event");
  return listen<TaskCompanionEvent>("task-companion-event", (event) => handler(event.payload));
}

export async function getCodexForeground(): Promise<boolean | null> {
  if (!isTauri()) return false;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<boolean | null>("get_codex_foreground");
}

export async function openCodexTask(threadId: string): Promise<TaskOpenResult> {
  if (!isTauri()) return "unavailable";
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<TaskOpenResult>("open_codex_task", { threadId });
}

export async function getTaskCompanionConnection(): Promise<TaskCompanionConnectionStatus> {
  if (!isTauri()) return { state: "disconnected" };
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<TaskCompanionConnectionStatus>("get_task_companion_connection");
}

export async function connectTaskCompanion(): Promise<TaskCompanionConnectionStatus> {
  if (!isTauri()) return { state: "needsTrust" };
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<TaskCompanionConnectionStatus>("connect_task_companion");
}

export async function disconnectTaskCompanion(): Promise<TaskCompanionConnectionStatus> {
  if (!isTauri()) return { state: "disconnected" };
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<TaskCompanionConnectionStatus>("disconnect_task_companion");
}

export async function testTaskCompanionNotification(): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("emit_test_task_companion_event");
}
