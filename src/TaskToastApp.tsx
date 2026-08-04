import { useEffect, useState } from "react";
import { TaskToast } from "./components/TaskToast";
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

  useEffect(() => {
    let disposed = false;
    let unlisten: () => void = () => undefined;
    void bridge.listen({
      onDisplay: (payload) => setDisplay(payload),
      onHide: () => setDisplay(null),
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
  const threadId = display.entry.event.threadId;
  return (
    <TaskToast
      {...display}
      onOpen={() => void bridge.emitAction({ type: "open", threadId })}
      onAcknowledge={() => void bridge.emitAction({ type: "acknowledge", threadId })}
      onPostpone={() => void bridge.emitAction({ type: "postpone", threadId })}
    />
  );
}
