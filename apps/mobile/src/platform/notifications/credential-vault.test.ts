import { describe, expect, test } from "bun:test";

import { createNotificationCredentialVault } from "./credential-vault";

describe("notification installation credential vault", () => {
  test("uses a dedicated device-only service and stores only exact bearer authority", async () => {
    const records = new Map<string, string>();
    const calls: string[] = [];
    const vault = createNotificationCredentialVault({
      store: {
        whenPasscodeSetThisDeviceOnly: 6,
        async setItem(key, value, options) {
          calls.push(
            `set:${options.keychainService}:${String(options.requireAuthentication)}`,
          );
          records.set(key, value);
        },
        async getItem(key, options) {
          calls.push(
            `get:${options.keychainService}:${String(options.requireAuthentication)}`,
          );
          return records.get(key) ?? null;
        },
        async deleteItem(key, options) {
          calls.push(`delete:${options.keychainService}`);
          records.delete(key);
        },
      },
    });
    const installationId = "11".repeat(16);
    const credential = "22".repeat(32);
    await vault.write({ installationId, credential });
    await expect(vault.read(installationId)).resolves.toBe(credential);
    expect(calls).toEqual([
      "set:hypertrader.notification-installation.v1:false",
      "get:hypertrader.notification-installation.v1:false",
    ]);
    expect(JSON.stringify([...records])).not.toContain("pushToken");
    await vault.remove(installationId);
    await expect(vault.read(installationId)).resolves.toBeNull();
  });

  test("rejects malformed identifiers and surviving malformed records", async () => {
    const vault = createNotificationCredentialVault({
      store: {
        async setItem() {},
        async getItem() {
          return "not-a-credential";
        },
        async deleteItem() {},
      },
    });
    await expect(vault.read("11".repeat(16))).rejects.toThrow("malformed");
    await expect(
      vault.write({ installationId: "bad", credential: "22".repeat(32) }),
    ).rejects.toThrow("malformed");
  });
});
