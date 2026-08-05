import type { Language } from "../types";
import type { TaskOpenAction } from "../components/TaskToast";
import type { TaskCompanionEntry } from "./taskCompanion";
import {
  planTaskToastPlacement,
  type Point,
  type Rect,
  type Size,
  type TaskToastPlacement,
  type ToastDirection,
} from "./taskToastPlacement";

export const TASK_TOAST_SIZE: Size = { width: 260, height: 96 };
export const TASK_TOAST_GAP = 8;

export interface TaskToastDisplayPayload {
  entry: TaskCompanionEntry;
  direction: ToastDirection;
  language: Language;
  openAction: TaskOpenAction;
}

export type TaskToastActionPayload = {
  type: "open" | "acknowledge" | "postpone";
  threadId: string;
};

export interface TaskToastShowRequest {
  entry: TaskCompanionEntry;
  language: Language;
  openAction: TaskOpenAction;
}

export interface TaskToastNativeState {
  orbPosition: Point;
  orbSize: Size;
  scaleFactor: number;
  workArea: Rect;
}

export interface TaskToastApplyRequest {
  physicalPosition: Point;
  logicalSize: Size;
  payload: TaskToastDisplayPayload;
}

export interface TaskToastWindowAdapter {
  readState: () => Promise<TaskToastNativeState>;
  apply: (request: TaskToastApplyRequest) => Promise<void>;
  hide: () => Promise<void>;
}

export interface TaskToastWindowController {
  show: (request: TaskToastShowRequest) => Promise<TaskToastPlacement>;
  hide: () => Promise<void>;
}

function toLogical(value: number, scaleFactor: number) {
  return value / scaleFactor;
}

export function createTaskToastWindowController(
  adapter: TaskToastWindowAdapter,
): TaskToastWindowController {
  return {
    async show(request) {
      const state = await adapter.readState();
      const scaleFactor = state.scaleFactor > 0 ? state.scaleFactor : 1;
      const placement = planTaskToastPlacement({
        orbFrame: {
          x: toLogical(state.orbPosition.x, scaleFactor),
          y: toLogical(state.orbPosition.y, scaleFactor),
          width: toLogical(state.orbSize.width, scaleFactor),
          height: toLogical(state.orbSize.height, scaleFactor),
        },
        toastSize: TASK_TOAST_SIZE,
        workArea: {
          x: toLogical(state.workArea.x, scaleFactor),
          y: toLogical(state.workArea.y, scaleFactor),
          width: toLogical(state.workArea.width, scaleFactor),
          height: toLogical(state.workArea.height, scaleFactor),
        },
        gap: TASK_TOAST_GAP,
      });
      await adapter.apply({
        physicalPosition: {
          x: Math.round(placement.position.x * scaleFactor),
          y: Math.round(placement.position.y * scaleFactor),
        },
        logicalSize: TASK_TOAST_SIZE,
        payload: { ...request, direction: placement.direction },
      });
      return placement;
    },
    hide: adapter.hide,
  };
}
