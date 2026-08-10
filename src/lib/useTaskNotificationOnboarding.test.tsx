// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskToastActionPayload } from "./taskToastWindow";
import {
  TASK_NOTIFICATION_ONBOARDING_KEY,
  useTaskNotificationOnboarding,
  type TaskNotificationOnboardingBridge,
} from "./useTaskNotificationOnboarding";

function fakeBridge(state: "disconnected" | "needsTrust" | "connected" = "disconnected") {
  let onAction = (_action: TaskToastActionPayload) => undefined;
  const bridge: TaskNotificationOnboardingBridge = {
    getConnection: vi.fn(async () => ({ state })),
    connect: vi.fn(async () => ({ state: "needsTrust" as const })),
    listenActions: vi.fn(async (handler) => {
      onAction = handler;
      return () => undefined;
    }),
    show: vi.fn(async () => null),
    hide: vi.fn(async () => undefined),
  };
  return { bridge, action: (value: TaskToastActionPayload) => onAction(value) };
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("useTaskNotificationOnboarding", () => {
  it("shows the first-use question once beside the compact orb", async () => {
    const fake = fakeBridge();
    renderHook(() => useTaskNotificationOnboarding({
      compact: true,
      language: "zh-CN",
      onEnable: vi.fn(),
      bridge: fake.bridge,
    }));

    await waitFor(() => expect(fake.bridge.show).toHaveBeenCalledWith({
      kind: "permission",
      language: "zh-CN",
    }));
    expect(localStorage.getItem(TASK_NOTIFICATION_ONBOARDING_KEY)).toBeNull();
  });

  it("connects and opens setup after Enable, then remembers the choice", async () => {
    const fake = fakeBridge();
    const onEnable = vi.fn();
    renderHook(() => useTaskNotificationOnboarding({
      compact: true,
      language: "zh-CN",
      onEnable,
      bridge: fake.bridge,
    }));
    await waitFor(() => expect(fake.bridge.show).toHaveBeenCalledOnce());

    act(() => fake.action({ type: "enableTaskNotifications" }));

    await waitFor(() => expect(fake.bridge.connect).toHaveBeenCalledOnce());
    await waitFor(() => expect(onEnable).toHaveBeenCalledOnce());
    expect(fake.bridge.hide).toHaveBeenCalled();
    expect(localStorage.getItem(TASK_NOTIFICATION_ONBOARDING_KEY)).toBe("enabled");
  });

  it("remembers Not now without connecting or prompting again", async () => {
    const fake = fakeBridge();
    const onEnable = vi.fn();
    const { unmount } = renderHook(() => useTaskNotificationOnboarding({
      compact: true,
      language: "zh-CN",
      onEnable,
      bridge: fake.bridge,
    }));
    await waitFor(() => expect(fake.bridge.show).toHaveBeenCalledOnce());

    act(() => fake.action({ type: "dismissTaskNotifications" }));
    expect(localStorage.getItem(TASK_NOTIFICATION_ONBOARDING_KEY)).toBe("dismissed");
    expect(fake.bridge.connect).not.toHaveBeenCalled();
    expect(onEnable).not.toHaveBeenCalled();
    unmount();

    const next = fakeBridge();
    renderHook(() => useTaskNotificationOnboarding({
      compact: true,
      language: "zh-CN",
      onEnable,
      bridge: next.bridge,
    }));
    await act(async () => undefined);
    expect(next.bridge.show).not.toHaveBeenCalled();
  });

  it("does not ask users who already connected task reminders", async () => {
    const fake = fakeBridge("connected");
    renderHook(() => useTaskNotificationOnboarding({
      compact: true,
      language: "zh-CN",
      onEnable: vi.fn(),
      bridge: fake.bridge,
    }));

    await waitFor(() => expect(fake.bridge.getConnection).toHaveBeenCalledOnce());
    expect(fake.bridge.show).not.toHaveBeenCalled();
    expect(localStorage.getItem(TASK_NOTIFICATION_ONBOARDING_KEY)).toBe("enabled");
  });
});
