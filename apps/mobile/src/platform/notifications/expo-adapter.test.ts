import { describe, expect, test } from "bun:test";

import {
  classifyExpoPermission,
  createExpoNotificationAdapter,
} from "./expo-adapter";

describe("Expo notification adapter", () => {
  test("creates the Android channel before a contextual permission request and token", async () => {
    const calls: string[] = [];
    const adapter = createExpoNotificationAdapter({
      platform: "android",
      projectId: "project-1",
      notifications: {
        async setChannel() {
          calls.push("channel");
        },
        async getPermissions() {
          calls.push("permissions:get");
          return { granted: false, canAskAgain: true, status: "undetermined" };
        },
        async requestPermissions() {
          calls.push("permissions:request");
          return { granted: true, canAskAgain: true, status: "granted" };
        },
        async getPushToken() {
          calls.push("token");
          return "ExponentPushToken[synthetic]";
        },
      },
    });
    await expect(adapter.requestAccessAndToken()).resolves.toMatchObject({
      permission: "authorized",
      pushToken: "ExponentPushToken[synthetic]",
    });
    expect(calls).toEqual([
      "channel",
      "permissions:get",
      "permissions:request",
      "token",
    ]);
  });

  test("reports denied truthfully and never requests again or obtains a token", async () => {
    const calls: string[] = [];
    const adapter = createExpoNotificationAdapter({
      platform: "ios",
      projectId: "project-1",
      notifications: {
        async setChannel() {},
        async getPermissions() {
          return { granted: false, canAskAgain: false, status: "denied" };
        },
        async requestPermissions() {
          calls.push("request");
          throw new Error("must not prompt");
        },
        async getPushToken() {
          calls.push("token");
          throw new Error("must not fetch token");
        },
      },
    });
    await expect(adapter.requestAccessAndToken()).resolves.toEqual({
      permission: "denied",
      pushToken: null,
    });
    expect(calls).toEqual([]);
  });

  test("reads existing Android permission without creating a channel or prompting", async () => {
    const calls: string[] = [];
    const adapter = createExpoNotificationAdapter({
      platform: "android",
      projectId: "project-1",
      notifications: {
        async setChannel() {
          calls.push("channel");
        },
        async getPermissions() {
          calls.push("permissions:get");
          return { granted: false, canAskAgain: true, status: "undetermined" };
        },
        async requestPermissions() {
          calls.push("permissions:request");
          return { granted: true, canAskAgain: true, status: "granted" };
        },
        async getPushToken() {
          calls.push("token");
          return "ExponentPushToken[synthetic]";
        },
      },
    });

    await expect(adapter.permission()).resolves.toBe("undetermined");
    expect(calls).toEqual(["permissions:get"]);
  });

  test("classifies iOS provisional and ephemeral access as usable, not fully granted", () => {
    expect(
      classifyExpoPermission({
        granted: false,
        canAskAgain: true,
        status: "undetermined",
        iosStatus: "provisional",
      }),
    ).toBe("provisional");
    expect(
      classifyExpoPermission({
        granted: false,
        canAskAgain: true,
        status: "undetermined",
        iosStatus: "ephemeral",
      }),
    ).toBe("ephemeral");
  });

  test("initializes the Android channel once across concurrent adapter operations", async () => {
    let channelCalls = 0;
    const adapter = createExpoNotificationAdapter({
      platform: "android",
      projectId: "project-1",
      notifications: {
        async setChannel() {
          channelCalls += 1;
          await Promise.resolve();
        },
        async getPermissions() {
          return { granted: true, canAskAgain: true, status: "granted" };
        },
        async requestPermissions() {
          throw new Error("must not prompt");
        },
        async getPushToken() {
          return "ExponentPushToken[synthetic]";
        },
      },
    });

    await Promise.all([
      adapter.permission(),
      adapter.requestAccessAndToken(),
      adapter.reacquireToken(),
    ]);
    expect(channelCalls).toBe(1);
  });
});
