import { describe, expect, test } from "bun:test";

import { extractAlertIdFromNotificationTask } from "./background-payload";

const payload = {
  alertId: "11".repeat(16),
  category: "price",
  network: "testnet",
  routeHint: "trade",
};

describe("background notification payload", () => {
  test("accepts minimal visible-response and headless data shapes", () => {
    expect(
      extractAlertIdFromNotificationTask({
        actionIdentifier: "expo.modules.notifications.actions.DEFAULT",
        notification: { request: { content: { data: payload } } },
      }),
    ).toBe(payload.alertId);
    expect(
      extractAlertIdFromNotificationTask({
        notification: null,
        data: { dataString: JSON.stringify(payload) },
      }),
    ).toBe(payload.alertId);
  });

  test("rejects account detail, invalid JSON, and unrelated payloads", () => {
    expect(
      extractAlertIdFromNotificationTask({
        notification: null,
        data: {
          dataString: JSON.stringify({ ...payload, targetAccount: "0xsecret" }),
        },
      }),
    ).toBeNull();
    expect(
      extractAlertIdFromNotificationTask({
        notification: null,
        data: { dataString: "{" },
      }),
    ).toBeNull();
    expect(extractAlertIdFromNotificationTask({ data: {} })).toBeNull();
  });
});
