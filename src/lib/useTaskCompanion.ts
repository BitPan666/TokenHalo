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
  TaskToastGroupLayout,
  TaskToastShowRequest,
} from "./taskToastWindow";
import { useTaskToastTimers } from "./useTaskToastTimers";

export type TaskOpenResult = "openedTask" | "openedApp" | "unavailable";

const COLLAPSED_GROUP_LAYOUT: TaskToastGroupLayout = {
  outerExpanded: false,
  expandedStatus: null,
};

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
  bridge = defaultBridge,
}: UseTaskCompanionOptions) {
  const [state, dispatch] = useReducer(taskCompanionReducer, undefined, createTaskCompanionState);
  const [clock, setClock] = useState(() => Date.now());
  const [groupLayout, setGroupLayout] = useState<TaskToastGroupLayout>(COLLAPSED_GROUP_LAYOUT);
  const stateRef = useRef(state);
  stateRef.current = state;
  const display = useMemo(
    () => selectTaskCompanionDisplay(state, clock),
    [clock, state],
  );
  const toastEntries = useMemo(() => display.visible.filter((entry) => {
    if (entry.event.source === "simulator") return true;
    return compact;
  }), [compact, display.visible]);

  useEffect(() => {
    if (bridge === defaultBridge && !("__TAURI_INTERNALS__" in window)) return;
    let disposed = false;
    const unlisteners: Array<() => void> = [];
    void Promise.all([
      bridge.listenEvents((event) => dispatch({ type: "event", event, nowMs: Date.now() })),
      bridge.listenActions((action) => {
        if (action.type === "setGroupLayout") {
          setGroupLayout(action.layout);
          return;
        }
        if (action.type === "setStackExpanded") {
          setGroupLayout({ outerExpanded: action.expanded, expandedStatus: null });
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
    entries: toastEntries,
    paused: groupLayout.outerExpanded || groupLayout.expandedStatus !== null,
    onExpire: (threadId) => {
      dispatch({ type: "expireToast", threadId, nowMs: Date.now() });
    },
  });

  useEffect(() => {
    if (bridge === defaultBridge && !("__TAURI_INTERNALS__" in window)) return;
    const selected = toastEntries[0] ?? null;
    if (!selected) {
      if (groupLayout.outerExpanded || groupLayout.expandedStatus !== null) {
        setGroupLayout(COLLAPSED_GROUP_LAYOUT);
      }
      void bridge.hide();
      return;
    }

    void bridge.show({
      entries: toastEntries,
      layout: groupLayout,
      language,
      openAction: "app",
    });
  }, [bridge, groupLayout, language, toastEntries]);

  return {
    taskStatus: display.ring ? {
      status: display.ring.event.status,
      attentionCount: display.unresolvedCount,
    } : null,
    activeEntry: display.selected,
    ingest: (event: TaskCompanionEvent) => dispatch({ type: "event", event, nowMs: Date.now() }),
  };
}
