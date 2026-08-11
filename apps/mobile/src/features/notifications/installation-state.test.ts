import { describe, expect, test } from "bun:test";

import { createNotificationInstallationStateStore } from "./installation-state";

describe("notification installation state", () => {
  test("persists only opaque installation and revocation identifiers", async () => {
    let value: string | null = null;
    const store = createNotificationInstallationStateStore({
      async getItem() {
        return value;
      },
      async setItem(_key, next) {
        value = next;
      },
      async removeItem() {
        value = null;
      },
    });
    const installationId = "11".repeat(16);
    await store.write(installationId);
    expect(value as unknown).toBe(
      JSON.stringify({
        version: 2,
        installationId,
        pendingRevocationOperationId: null,
      }),
    );
    expect(value as unknown).not.toContain("credential");
    await expect(store.read()).resolves.toEqual({
      installationId,
      pendingRevocationOperationId: null,
    });
    const operationId = "12".repeat(16);
    await store.setPendingRevocationOperation(operationId);
    await expect(store.read()).resolves.toEqual({
      installationId,
      pendingRevocationOperationId: operationId,
    });
    await store.clear();
    await expect(store.read()).resolves.toBeNull();
  });

  test("reads the legacy opaque installation checkpoint without inventing a revoke", async () => {
    const installationId = "13".repeat(16);
    const store = createNotificationInstallationStateStore({
      async getItem() {
        return JSON.stringify({ version: 1, installationId });
      },
      async setItem() {},
      async removeItem() {},
    });
    await expect(store.read()).resolves.toEqual({
      installationId,
      pendingRevocationOperationId: null,
    });
  });

  test("clears malformed surviving state", async () => {
    let value: string | null = "{}";
    const store = createNotificationInstallationStateStore({
      async getItem() {
        return value;
      },
      async setItem() {},
      async removeItem() {
        value = null;
      },
    });
    await expect(store.read()).resolves.toBeNull();
    expect(value).toBeNull();
  });
});
