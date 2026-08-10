import { useEffect, useRef } from "react";
import type { Language, TaskCompanionConnectionStatus } from "../types";
import {
  connectTaskCompanion,
  getTaskCompanionConnection,
  hideTaskToast,
  listenTaskToastActions,
  showTaskToast,
} from "./bridge";
import type { TaskToastActionPayload, TaskToastShowRequest } from "./taskToastWindow";

export const TASK_NOTIFICATION_ONBOARDING_KEY = "tokenhalo.task-reminder-onboarding.v1";

export interface TaskNotificationOnboardingBridge {
  getConnection: () => Promise<TaskCompanionConnectionStatus>;
  connect: () => Promise<TaskCompanionConnectionStatus>;
  listenActions: (handler: (action: TaskToastActionPayload) => void) => Promise<() => void>;
  show: (request: TaskToastShowRequest) => Promise<unknown>;
  hide: () => Promise<void>;
}

const defaultBridge: TaskNotificationOnboardingBridge = {
  getConnection: getTaskCompanionConnection,
  connect: connectTaskCompanion,
  listenActions: listenTaskToastActions,
  show: showTaskToast,
  hide: hideTaskToast,
};

interface Options {
  compact: boolean;
  language: Language;
  onEnable: () => void;
  bridge?: TaskNotificationOnboardingBridge;
}

function rememberedChoice() {
  try {
    return window.localStorage.getItem(TASK_NOTIFICATION_ONBOARDING_KEY);
  } catch {
    return null;
  }
}

function remember(choice: "enabled" | "dismissed") {
  try {
    window.localStorage.setItem(TASK_NOTIFICATION_ONBOARDING_KEY, choice);
  } catch {
    // A blocked storage API should not prevent the user from continuing setup.
  }
}

export function useTaskNotificationOnboarding({
  compact,
  language,
  onEnable,
  bridge = defaultBridge,
}: Options) {
  const visibleRef = useRef(false);
  const compactRef = useRef(compact);
  const languageRef = useRef(language);
  const onEnableRef = useRef(onEnable);
  compactRef.current = compact;
  languageRef.current = language;
  onEnableRef.current = onEnable;

  useEffect(() => {
    let disposed = false;
    let unlisten: () => void = () => undefined;
    void bridge.listenActions((action) => {
      if (action.type === "dismissTaskNotifications") {
        visibleRef.current = false;
        remember("dismissed");
        void bridge.hide();
        return;
      }
      if (action.type !== "enableTaskNotifications") return;

      visibleRef.current = false;
      remember("enabled");
      void bridge.hide();
      void bridge.connect()
        .catch(() => undefined)
        .finally(() => onEnableRef.current());
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });
    return () => {
      disposed = true;
      unlisten();
    };
  }, [bridge]);

  useEffect(() => {
    if (!compact || rememberedChoice()) return;
    let disposed = false;
    void bridge.getConnection().then((status) => {
      if (disposed) return;
      if (status.state !== "disconnected") {
        remember("enabled");
        return;
      }
      visibleRef.current = true;
      return bridge.show({ kind: "permission", language });
    }).catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, [bridge, compact, language]);

  useEffect(() => {
    if (!visibleRef.current) return;
    if (compact) {
      void bridge.show({ kind: "permission", language });
    } else {
      void bridge.hide();
    }
  }, [bridge, compact, language]);
}
