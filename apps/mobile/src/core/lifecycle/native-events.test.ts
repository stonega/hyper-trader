import { describe, expect, test } from "bun:test";

import { createAppLifecycleController } from "./controller";
import {
  installNativeLifecycleBindings,
  isNetworkOnline,
  type NetworkStateLike,
} from "./native-events";

describe("native lifecycle event bindings", () => {
  test("cleans up listeners and ignores a late initial network result", async () => {
    const events: string[] = [];
    const listeners = new Map<string, Set<(value?: unknown) => void>>();
    const add = (event: string, listener: (value?: unknown) => void) => {
      const group = listeners.get(event) ?? new Set();
      group.add(listener);
      listeners.set(event, group);
      return { remove: () => group.delete(listener) };
    };
    let resolveInitial: (state: NetworkStateLike) => void = () => undefined;
    const controller = createAppLifecycleController({
      initialOnline: false,
      setFocused: (focused) => events.push(`focus:${focused}`),
      setOnline: (online) => events.push(`online:${online}`),
      lockSignerSession: (reason) => events.push(`lock:${reason}`),
      startStreams: () => events.push("start"),
      stopStreams: (reason) => events.push(`stop:${reason}`),
    });
    const binding = installNativeLifecycleBindings({
      appState: {
        currentState: "active",
        addEventListener: (event, listener) =>
          add(event, listener as unknown as (value?: unknown) => void),
      },
      network: {
        getNetworkStateAsync: () =>
          new Promise((resolve) => {
            resolveInitial = resolve;
          }),
        addNetworkStateListener: (listener) =>
          add("network", listener as unknown as (value?: unknown) => void),
      },
      controller,
      platform: "android",
    });

    for (const listener of listeners.get("network") ?? []) {
      listener({ isConnected: true, isInternetReachable: true });
    }
    resolveInitial({ isConnected: false, isInternetReachable: false });
    await binding.initialNetworkReady;
    for (const listener of listeners.get("blur") ?? []) {
      listener();
    }
    binding.dispose();

    expect(events).toEqual([
      "focus:true",
      "online:true",
      "start",
      "focus:false",
      "lock:android_blur",
      "stop:android_blur",
    ]);
    expect([...listeners.values()].every((group) => group.size === 0)).toBe(
      true,
    );
  });

  test("fails closed on unknown or rejected initial network state", async () => {
    const online: boolean[] = [];
    const controller = createAppLifecycleController({
      initialOnline: true,
      setFocused: () => undefined,
      setOnline: (value) => online.push(value),
    });
    const binding = installNativeLifecycleBindings({
      appState: {
        currentState: null,
        addEventListener: () => ({ remove: () => undefined }),
      },
      network: {
        getNetworkStateAsync: async () => {
          throw new Error("native network unavailable");
        },
        addNetworkStateListener: () => ({ remove: () => undefined }),
      },
      controller,
      platform: "ios",
    });

    await binding.initialNetworkReady;

    expect(online).toEqual([false]);
  });

  test("requires a non-contradictory explicit online signal", () => {
    expect(isNetworkOnline({})).toBe(false);
    expect(
      isNetworkOnline({ isConnected: false, isInternetReachable: true }),
    ).toBe(false);
    expect(isNetworkOnline({ isConnected: true })).toBe(true);
  });
});
