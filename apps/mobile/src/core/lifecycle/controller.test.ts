import { describe, expect, test } from "bun:test";

import { createAppLifecycleController } from "./controller";

describe("app lifecycle controller", () => {
  test("locks and tears down immediately on inactive, background, and Android blur", () => {
    const events: string[] = [];
    const controller = createAppLifecycleController({
      setFocused: (focused) => events.push(`focus:${focused}`),
      lockSignerSession: (reason) => events.push(`lock:${reason}`),
      stopStreams: (reason) => events.push(`stop:${reason}`),
    });

    controller.onAppStateChange("inactive");
    controller.onAppStateChange("background");
    controller.onAndroidBlur();

    expect(events).toEqual([
      "focus:false",
      "lock:app_inactive",
      "stop:app_inactive",
      "focus:false",
      "lock:app_background",
      "stop:app_background",
      "focus:false",
      "lock:android_blur",
      "stop:android_blur",
    ]);
  });

  test("starts streams only while active and online", () => {
    const events: string[] = [];
    const controller = createAppLifecycleController({
      setFocused: (focused) => events.push(`focus:${focused}`),
      setOnline: (online) => events.push(`online:${online}`),
      startStreams: () => events.push("start"),
      stopStreams: (reason) => events.push(`stop:${reason}`),
    });

    controller.onNetworkChange(false);
    controller.onAppStateChange("active");
    controller.onNetworkChange(true);

    expect(events).toEqual([
      "online:false",
      "stop:offline",
      "focus:true",
      "online:true",
      "start",
    ]);
  });

  test("ignores duplicate active, network, blur, and focus events", () => {
    const events: string[] = [];
    const controller = createAppLifecycleController({
      setFocused: (focused) => events.push(`focus:${focused}`),
      setOnline: (online) => events.push(`online:${online}`),
      lockSignerSession: (reason) => events.push(`lock:${reason}`),
      startStreams: () => events.push("start"),
      stopStreams: (reason) => events.push(`stop:${reason}`),
    });

    controller.onAppStateChange("active");
    controller.onAppStateChange("active");
    controller.onNetworkChange(true);
    controller.onNetworkChange(true);
    controller.onAndroidBlur();
    controller.onAndroidBlur();
    controller.onAndroidFocus();
    controller.onAndroidFocus();

    expect(events).toEqual([
      "focus:true",
      "start",
      "focus:false",
      "lock:android_blur",
      "stop:android_blur",
      "focus:true",
      "start",
    ]);
  });
});
