import { useEffect, useState } from "react";
import { TaskPermissionToast } from "./components/TaskPermissionToast";
import { TaskToastStack } from "./components/TaskToastStack";
import {
  emitTaskToastAction,
  listenTaskToastSurfaceEvents,
} from "./lib/bridge";
import type {
  TaskToastActionPayload,
  TaskToastDisplayPayload,
} from "./lib/taskToastWindow";

export interface TaskToastAppBridge {
  listen: (handlers: {
    onDisplay: (payload: TaskToastDisplayPayload) => void;
    onHide: () => void;
  }) => Promise<() => void>;
  emitAction: (payload: TaskToastActionPayload) => Promise<void>;
}

const defaultBridge: TaskToastAppBridge = {
  listen: listenTaskToastSurfaceEvents,
  emitAction: emitTaskToastAction,
};

export function TaskToastApp({ bridge = defaultBridge }: { bridge?: TaskToastAppBridge }) {
  const [display, setDisplay] = useState<TaskToastDisplayPayload | null>(null);
  const [stackExpanded, setStackExpanded] = useState(false);

  useEffect(() => {
    let disposed = false;
    let unlisten: () => void = () => undefined;
    void bridge.listen({
      onDisplay: (payload) => {
        setDisplay(payload);
        if (payload.kind !== "permission") setStackExpanded(payload.expanded);
      },
      onHide: () => {
        setDisplay(null);
        setStackExpanded(false);
      },
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
    <TaskToastStack
      {...display}
      expanded={stackExpanded}
      onExpandedChange={(expanded) => {
        setStackExpanded(expanded);
        void bridge.emitAction({ type: "setStackExpanded", expanded });
      }}
      onOpen={(threadId) => void bridge.emitAction({ type: "open", threadId })}
      onAcknowledge={(threadId) => void bridge.emitAction({ type: "acknowledge", threadId })}
      onPostpone={(threadId) => void bridge.emitAction({ type: "postpone", threadId })}
    />
  );
}
