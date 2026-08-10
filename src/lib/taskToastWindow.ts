import type { Language } from "../types";
import type { TaskOpenAction } from "../components/TaskToast";
import type { TaskCompanionEntry } from "./taskCompanion";
import {
  planTaskToastPlacement,
  planTaskToastStackPlacement,
  type Point,
  type Rect,
  type Size,
  type TaskToastPlacement,
  type TaskToastStackGrowth,
  type ToastDirection,
} from "./taskToastPlacement";

export const TASK_TOAST_CARD_SIZE: Size = { width: 260, height: 96 };
export const TASK_TOAST_SIZE = TASK_TOAST_CARD_SIZE;
export const TASK_TOAST_GAP = 8;
export const TASK_TOAST_STACK_OFFSET = 11;
export const TASK_TOAST_EXPANDED_GAP = 8;

export function taskToastStackSize(count: number, expanded: boolean): Size {
  const visibleCount = Math.max(1, Math.min(3, Math.floor(count)));
  return {
    width: TASK_TOAST_CARD_SIZE.width,
    height: expanded
      ? visibleCount * TASK_TOAST_CARD_SIZE.height
        + (visibleCount - 1) * TASK_TOAST_EXPANDED_GAP
      : TASK_TOAST_CARD_SIZE.height
        + (visibleCount - 1) * TASK_TOAST_STACK_OFFSET,
  };
}

export interface TaskStatusToastDisplayPayload {
  kind?: "task";
  entries: TaskCompanionEntry[];
  hiddenCount: number;
  expanded: boolean;
  visibleCapacity: number;
  growth: TaskToastStackGrowth;
  direction: ToastDirection;
  language: Language;
  openAction: TaskOpenAction;
}

export interface TaskPermissionToastDisplayPayload {
  kind: "permission";
  direction: ToastDirection;
  language: Language;
}

export type TaskToastDisplayPayload =
  | TaskStatusToastDisplayPayload
  | TaskPermissionToastDisplayPayload;

export type TaskToastActionPayload =
  | {
    type: "open" | "acknowledge" | "postpone";
    threadId: string;
  }
  | {
    type: "setStackExpanded";
    expanded: boolean;
  }
  | {
    type: "enableTaskNotifications" | "dismissTaskNotifications";
  };

export interface TaskStatusToastShowRequest {
  kind?: "task";
  entries: TaskCompanionEntry[];
  hiddenCount: number;
  expanded: boolean;
  language: Language;
  openAction: TaskOpenAction;
}

export interface TaskPermissionToastShowRequest {
  kind: "permission";
  language: Language;
}

export type TaskToastShowRequest =
  | TaskStatusToastShowRequest
  | TaskPermissionToastShowRequest;

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
      const orbFrame = {
        x: toLogical(state.orbPosition.x, scaleFactor),
        y: toLogical(state.orbPosition.y, scaleFactor),
        width: toLogical(state.orbSize.width, scaleFactor),
        height: toLogical(state.orbSize.height, scaleFactor),
      };
      const workArea = {
        x: toLogical(state.workArea.x, scaleFactor),
        y: toLogical(state.workArea.y, scaleFactor),
        width: toLogical(state.workArea.width, scaleFactor),
        height: toLogical(state.workArea.height, scaleFactor),
      };
      const basePlacement = planTaskToastPlacement({
        orbFrame,
        toastSize: TASK_TOAST_CARD_SIZE,
        workArea,
        gap: TASK_TOAST_GAP,
      });

      if (request.kind === "permission") {
        await adapter.apply({
          physicalPosition: {
            x: Math.round(basePlacement.position.x * scaleFactor),
            y: Math.round(basePlacement.position.y * scaleFactor),
          },
          logicalSize: TASK_TOAST_CARD_SIZE,
          payload: { ...request, direction: basePlacement.direction },
        });
        return basePlacement;
      }

      const requestedCount = Math.max(1, Math.min(3, request.entries.length));
      let visibleCapacity = requestedCount;
      let logicalSize = taskToastStackSize(visibleCapacity, request.expanded);
      let placement = planTaskToastStackPlacement({
        orbFrame,
        toastSize: logicalSize,
        anchorSize: TASK_TOAST_CARD_SIZE,
        workArea,
        gap: TASK_TOAST_GAP,
        direction: basePlacement.direction,
      });
      while (!placement.fits && visibleCapacity > 1) {
        visibleCapacity -= 1;
        logicalSize = taskToastStackSize(visibleCapacity, request.expanded);
        placement = planTaskToastStackPlacement({
          orbFrame,
          toastSize: logicalSize,
          anchorSize: TASK_TOAST_CARD_SIZE,
          workArea,
          gap: TASK_TOAST_GAP,
          direction: basePlacement.direction,
        });
      }
      const clippedCount = Math.max(0, request.entries.length - visibleCapacity);
      await adapter.apply({
        physicalPosition: {
          x: Math.round(placement.position.x * scaleFactor),
          y: Math.round(placement.position.y * scaleFactor),
        },
        logicalSize,
        payload: {
          ...request,
          entries: request.entries.slice(0, visibleCapacity),
          hiddenCount: request.hiddenCount + clippedCount,
          visibleCapacity,
          growth: placement.growth,
          direction: placement.direction,
        },
      });
      return placement;
    },
    hide: adapter.hide,
  };
}
