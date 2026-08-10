import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { Language } from "../types";
import {
  hideTaskToast,
  listenTaskCompanionEvents,
  listenTaskToastActions,
  openCodexTask,
  showTaskToast,
} from "./bridge";
import {
  createTaskCompanionState,
  selectTaskCompanionDisplay,
  taskCompanionReducer,
  type TaskCompanionEvent,
} from "./taskCompanion";
import type {
  TaskToastActionPayload,
  TaskToastShowRequest,
} from "./taskToastWindow";
import { useTaskToastTimers } from "./useTaskToastTimers";

export type TaskOpenResult = "openedTask" | "openedApp" | "unavailable";

export interface TaskCompanionBridge {
  listenEvents: (handler: (event: TaskCompanionEvent) => void) => Promise<() => void>;
  listenActions: (handler: (action: TaskToastActionPayload) => void) => Promise<() => void>;
  show: (request: TaskToastShowRequest) => Promise<unknown>;
  hide: () => Promise<void>;
  open: (threadId: string) => Promise<TaskOpenResult>;
}

const defaultBridge: TaskCompanionBridge = {
  listenEvents: listenTaskCompanionEvents,
  listenActions: listenTaskToastActions,
  show: showTaskToast,
  hide: hideTaskToast,
  open: openCodexTask,
};

interface UseTaskCompanionOptions {
  compact: boolean;
  language: Language;
  codexForeground: boolean;
  bridge?: TaskCompanionBridge;
}

export function useTaskCompanion({
  compact,
  language,
  codexForeground,
  bridge = defaultBridge,
}: UseTaskCompanionOptions) {
  const [state, dispatch] = useReducer(taskCompanionReducer, undefined, createTaskCompanionState);
  const [clock, setClock] = useState(() => Date.now());
  const [stackExpanded, setStackExpanded] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  const display = useMemo(
    () => selectTaskCompanionDisplay(state, clock),
    [clock, state],
  );

  useEffect(() => {
    if (bridge === defaultBridge && !("__TAURI_INTERNALS__" in window)) return;
    let disposed = false;
    const unlisteners: Array<() => void> = [];
    void Promise.all([
      bridge.listenEvents((event) => dispatch({ type: "event", event, nowMs: Date.now() })),
      bridge.listenActions((action) => {
        if (action.type === "setStackExpanded") {
          setStackExpanded(action.expanded);
          return;
        }
        if (
          action.type === "enableTaskNotifications"
          || action.type === "dismissTaskNotifications"
        ) return;
        if (!("threadId" in action)) return;
        const nowMs = Date.now();
        if (action.type === "postpone") {
          dispatch({ type: "postpone", threadId: action.threadId, nowMs });
          return;
        }
        if (action.type === "acknowledge") {
          dispatch({ type: "acknowledge", threadId: action.threadId, nowMs });
          return;
        }
        void bridge.open(action.threadId).then((result) => {
          const active = stateRef.current.entries[action.threadId];
          if (result !== "unavailable" && active?.event.status === "failed") {
            dispatch({ type: "acknowledge", threadId: action.threadId, nowMs: Date.now() });
          }
        });
      }),
    ]).then((values) => {
      if (disposed) values.forEach((unlisten) => unlisten());
      else unlisteners.push(...values);
    });
    return () => {
      disposed = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [bridge]);

  useEffect(() => {
    const postponedUntil = Object.values(state.entries)
      .map((entry) => entry.postponedUntil)
      .filter((value): value is number => value !== null && value > clock)
      .sort((left, right) => left - right)[0];
    if (postponedUntil === undefined) return;
    const timer = window.setTimeout(() => setClock(Date.now()), postponedUntil - clock);
    return () => window.clearTimeout(timer);
  }, [clock, state.entries]);

  useTaskToastTimers({
    entries: display.visible,
    paused: stackExpanded,
    onExpire: (threadId) => {
      dispatch({ type: "expireToast", threadId, nowMs: Date.now() });
    },
  });

  useEffect(() => {
    if (bridge === defaultBridge && !("__TAURI_INTERNALS__" in window)) return;
    const selected = display.selected;
    if (!selected) {
      if (stackExpanded) setStackExpanded(false);
      void bridge.hide();
      return;
    }

    const ordinary = selected.event.status === "working" || selected.event.status === "completed";
    const preview = selected.event.source === "simulator";
    const visible = preview || (compact && !(codexForeground && ordinary));
    if (visible) {
      void bridge.show({ entry: selected, language, openAction: "app" });
    } else {
      void bridge.hide();
    }

  }, [bridge, codexForeground, compact, display.selected, language, stackExpanded]);

  useEffect(() => {
    if (compact) return;
    const selected = display.selected;
    if (selected && (selected.event.status === "working" || selected.event.status === "completed")) {
      dispatch({ type: "expireToast", threadId: selected.event.threadId, nowMs: Date.now() });
    }
  }, [compact, display.selected]);

  return {
    taskStatus: display.ring ? {
      status: display.ring.event.status,
      attentionCount: display.unresolvedCount,
    } : null,
    activeEntry: display.selected,
    ingest: (event: TaskCompanionEvent) => dispatch({ type: "event", event, nowMs: Date.now() }),
  };
}
