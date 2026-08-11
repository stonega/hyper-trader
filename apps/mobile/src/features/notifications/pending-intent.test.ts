import { describe, expect, test } from "bun:test";

import { createPendingNotificationIntentStore } from "./pending-intent";

describe("pending notification intent storage", () => {
  test("stores and consumes one opaque ID without payload details", async () => {
    const records = new Map<string, string>();
    const store = createPendingNotificationIntentStore({
      async getItem(key) {
        return records.get(key) ?? null;
      },
      async setItem(key, value) {
        records.set(key, value);
      },
      async removeItem(key) {
        records.delete(key);
      },
    });
    const alertId = "11".repeat(16);
    await store.save(alertId);
    expect(JSON.stringify([...records])).toBe(
      JSON.stringify([["hypertrader.notification.pending.v1", alertId]]),
    );
    await expect(store.consume()).resolves.toBe(alertId);
    await expect(store.consume()).resolves.toBeNull();
  });

  test("fails closed and clears a malformed surviving record", async () => {
    let removed = false;
    const store = createPendingNotificationIntentStore({
      async getItem() {
        return "not-an-alert";
      },
      async setItem() {},
      async removeItem() {
        removed = true;
      },
    });
    await expect(store.consume()).resolves.toBeNull();
    expect(removed).toBe(true);
  });
});
