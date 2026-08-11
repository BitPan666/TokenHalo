import type { Language } from "../types";
import type { TaskOpenAction } from "../components/TaskToast";
import type { TaskCompanionEntry, TaskCompanionStatus } from "./taskCompanion";
import { groupTaskEntries } from "./taskStatusGroups";
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
export const TASK_STATUS_GROUP_SURFACE_WIDTH = 272;
export const TASK_STATUS_GROUP_TOP_INSET = 12;
export const TASK_STATUS_GROUP_CARD_HEIGHT = 84;
export const TASK_STATUS_GROUP_COMPACT_HEIGHT = 40;
export const TASK_STATUS_GROUP_GAP = 8;
export const TASK_STATUS_GROUP_LIST_MAX_HEIGHT = 360;

export interface TaskToastGroupLayout {
  outerExpanded: boolean;
  expandedStatus: TaskCompanionStatus | null;
}

function backOffset(count: number, compact: boolean) {
  if (count <= 1) return 0;
  if (count === 2) return compact ? 6 : 12;
  return compact ? 12 : 20;
}

function expandedEntryListHeight(entryCount: number) {
  return Math.min(
    TASK_STATUS_GROUP_LIST_MAX_HEIGHT,
    entryCount * TASK_STATUS_GROUP_CARD_HEIGHT
      + Math.max(0, entryCount - 1) * TASK_STATUS_GROUP_GAP,
  );
}

export function taskStatusGroupStackSize(
  entries: TaskCompanionEntry[],
  layout: TaskToastGroupLayout,
): Size {
  const groups = groupTaskEntries(entries);
  if (!groups.length) {
    return { width: TASK_STATUS_GROUP_SURFACE_WIDTH, height: TASK_TOAST_CARD_SIZE.height };
  }

  if (!layout.outerExpanded) {
    const backCount = Math.min(2, Math.max(0, entries.length - 1));
    return {
      width: TASK_STATUS_GROUP_SURFACE_WIDTH,
      height: TASK_STATUS_GROUP_TOP_INSET
        + TASK_STATUS_GROUP_CARD_HEIGHT
        + backOffset(backCount + 1, false),
    };
  }

  const contentHeight = groups.reduce((total, group) => {
    if (layout.expandedStatus === group.status) {
      return total + expandedEntryListHeight(group.entries.length);
    }
    const compact = layout.expandedStatus !== null;
    const cardHeight = compact
      ? TASK_STATUS_GROUP_COMPACT_HEIGHT
      : TASK_STATUS_GROUP_CARD_HEIGHT;
    return total + cardHeight + backOffset(group.entries.length, compact);
  }, 0);

  return {
    width: TASK_STATUS_GROUP_SURFACE_WIDTH,
    height: TASK_STATUS_GROUP_TOP_INSET
      + contentHeight
      + Math.max(0, groups.length - 1) * TASK_STATUS_GROUP_GAP,
  };
}

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
  layout?: TaskToastGroupLayout;
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
  hiddenCount?: number;
  expanded?: boolean;
  layout?: TaskToastGroupLayout;
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
      if (request.kind === "permission") {
        const basePlacement = planTaskToastPlacement({
          orbFrame,
          toastSize: TASK_TOAST_CARD_SIZE,
          workArea,
          gap: TASK_TOAST_GAP,
        });
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

      const layout = request.layout ?? {
        outerExpanded: Boolean(request.expanded),
        expandedStatus: null,
      };
      const collapsedSize = taskStatusGroupStackSize(request.entries, {
        outerExpanded: false,
        expandedStatus: null,
      });
      const candidateLayouts: TaskToastGroupLayout[] = [
        { outerExpanded: true, expandedStatus: null },
        ...groupTaskEntries(request.entries).map((group) => ({
          outerExpanded: true,
          expandedStatus: group.status,
        })),
      ];
      const largestSize = candidateLayouts
        .map((candidate) => taskStatusGroupStackSize(request.entries, candidate))
        .reduce((largest, candidate) => (
          candidate.height > largest.height ? candidate : largest
        ), collapsedSize);
      const preferredPlacement = planTaskToastPlacement({
        orbFrame,
        toastSize: largestSize,
        workArea,
        gap: TASK_TOAST_GAP,
      });
      const logicalSize = taskStatusGroupStackSize(request.entries, layout);
      const placement = planTaskToastStackPlacement({
        orbFrame,
        toastSize: logicalSize,
        anchorSize: collapsedSize,
        workArea,
        gap: TASK_TOAST_GAP,
        direction: preferredPlacement.direction,
      });
      await adapter.apply({
        physicalPosition: {
          x: Math.round(placement.position.x * scaleFactor),
          y: Math.round(placement.position.y * scaleFactor),
        },
        logicalSize,
        payload: {
          ...request,
          entries: request.entries,
          hiddenCount: request.hiddenCount ?? 0,
          expanded: layout.outerExpanded || layout.expandedStatus !== null,
          visibleCapacity: request.entries.length,
          layout,
          growth: placement.growth,
          direction: placement.direction,
        },
      });
      return placement;
    },
    hide: adapter.hide,
  };
}
