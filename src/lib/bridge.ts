import type { ProviderSnapshot, WidgetPreferences } from "../types";
import {
  createWidgetWindowController,
  type WidgetDisplayMode,
  type WidgetWindowController,
} from "./widgetWindow";

let widgetWindowControllerPromise: Promise<WidgetWindowController> | null = null;

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

export async function updatePreferences(value: WidgetPreferences): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("set_preferences", { preferences: value });
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
}): Promise<() => void> {
  if (!isTauri()) return () => undefined;
  const { listen } = await import("@tauri-apps/api/event");
  const unlistenPreferences = await listen<WidgetPreferences>("preferences-changed", (event) => handlers.onPreferences(event.payload));
  const unlistenRefresh = await listen("refresh-requested", handlers.onRefresh);
  return () => { unlistenPreferences(); unlistenRefresh(); };
}
