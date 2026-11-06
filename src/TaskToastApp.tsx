import { useCallback, useEffect, useState } from "react";
import { TaskPermissionToast } from "./components/TaskPermissionToast";
import { TaskStatusGroupStack } from "./components/TaskStatusGroupStack";
import {
  emitTaskToastAction,
  getTaskToastPointer,
  listenTaskToastSurfaceEvents,
  type TaskToastNativePointer,
} from "./lib/bridge";
import type {
  TaskToastActionPayload,
  TaskToastDisplayPayload,
} from "./lib/taskToastWindow";
import { groupTaskEntries } from "./lib/taskStatusGroups";

export interface TaskToastAppBridge {
  listen: (handlers: {
    onDisplay: (payload: TaskToastDisplayPayload) => void;
    onHide: () => void;
    onNativePointer?: (payload: TaskToastNativePointer) => void;
  }) => Promise<() => void>;
  emitAction: (payload: TaskToastActionPayload) => Promise<void>;
  readPointer?: () => Promise<TaskToastNativePointer>;
}

const defaultBridge: TaskToastAppBridge = {
  listen: listenTaskToastSurfaceEvents,
  emitAction: emitTaskToastAction,
  readPointer: getTaskToastPointer,
};

function samePointer(
  previous: TaskToastNativePointer | null,
  next: TaskToastNativePointer,
) {
  return previous?.inside === next.inside
    && previous?.x === next.x
    && previous?.y === next.y;
}

export function TaskToastApp({ bridge = defaultBridge }: { bridge?: TaskToastAppBridge }) {
  const [display, setDisplay] = useState<TaskToastDisplayPayload | null>(null);
  const [nativePointer, setNativePointer] = useState<TaskToastNativePointer | null>(null);
  const emitLayout = useCallback((layout: NonNullable<Extract<
    TaskToastActionPayload,
    { type: "setGroupLayout" }
  >["layout"]>) => {
    void bridge.emitAction({ type: "setGroupLayout", layout });
  }, [bridge]);
  const openTask = useCallback((threadId: string) => {
    void bridge.emitAction({ type: "open", threadId });
  }, [bridge]);
  const dismissTask = useCallback((threadId: string) => {
    void bridge.emitAction({ type: "acknowledge", threadId });
  }, [bridge]);
  const postponeTask = useCallback((threadId: string) => {
    void bridge.emitAction({ type: "postpone", threadId });
  }, [bridge]);
  const updateNativePointer = useCallback((pointer: TaskToastNativePointer) => {
    setNativePointer((previous) => samePointer(previous, pointer) ? previous : pointer);
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: () => void = () => undefined;
    void bridge.listen({
      onDisplay: (payload) => {
        setNativePointer(null);
        setDisplay(payload);
      },
      onHide: () => {
        setDisplay(null);
        setNativePointer(null);
      },
      onNativePointer: updateNativePointer,
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });
    return () => {
      disposed = true;
      unlisten();
    };
  }, [bridge, updateNativePointer]);

  useEffect(() => {
    if (!display || display.kind === "permission" || !bridge.readPointer) return;
    let cancelled = false;
    let pending = false;
    const readPointer = async () => {
      if (pending) return;
      pending = true;
      try {
        const pointer = await bridge.readPointer!();
        if (cancelled) return;
        setNativePointer((previous) => samePointer(previous, pointer) ? previous : pointer);
      } catch {
        // Native enter/exit events remain available if a pointer read briefly fails.
      } finally {
        pending = false;
      }
    };
    void readPointer();
    const interval = window.setInterval(() => void readPointer(), 120);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [bridge, display]);

  if (!display) return null;
  if (display.kind === "permission") {
    return (
      <TaskPermissionToast
        direction={display.direction}
        language={display.language}
        onEnable={() => void bridge.emitAction({ type: "enableTaskNotifications" })}
        onDismiss={() => void bridge.emitAction({ type: "dismissTaskNotifications" })}
      />
    );
  }
  return (
    <main className="task-toast-group-surface">
      <TaskStatusGroupStack
        groups={groupTaskEntries(display.entries)}
        direction={display.direction}
        growth={display.growth}
        language={display.language}
        nativePointer={nativePointer}
        onLayoutChange={emitLayout}
        onOpen={openTask}
        onDismiss={dismissTask}
        onPostpone={postponeTask}
      />
    </main>
  );
}
