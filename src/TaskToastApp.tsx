import { useCallback, useEffect, useState } from "react";
import { TaskPermissionToast } from "./components/TaskPermissionToast";
import { TaskStatusGroupStack } from "./components/TaskStatusGroupStack";
import {
  emitTaskToastAction,
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
}

const defaultBridge: TaskToastAppBridge = {
  listen: listenTaskToastSurfaceEvents,
  emitAction: emitTaskToastAction,
};

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

  useEffect(() => {
    let disposed = false;
    let unlisten: () => void = () => undefined;
    void bridge.listen({
      onDisplay: (payload) => {
        setDisplay(payload);
      },
      onHide: () => {
        setDisplay(null);
        setNativePointer(null);
      },
      onNativePointer: setNativePointer,
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });
    return () => {
      disposed = true;
      unlisten();
    };
  }, [bridge]);

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
