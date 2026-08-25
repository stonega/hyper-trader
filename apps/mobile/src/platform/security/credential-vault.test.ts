import { describe, expect, test } from "bun:test";

import {
  MAINNET_TRADING_RELEASE_STAGE,
  type SignerBinding,
} from "@hyper-trader/hyperliquid";

import {
  assessCustodyInstall,
  createCredentialVault,
  type SecureStorePort,
} from "./credential-vault";

const BINDING: SignerBinding = {
  network: "testnet",
  masterAccount: "0x1111111111111111111111111111111111111111",
  targetAccount: "0x2222222222222222222222222222222222222222",
  agentAddress: "0x3333333333333333333333333333333333333333",
  generation: 1,
};

function createStore(
  configuration: { readonly failProtectedSet?: boolean } = {},
) {
  const records = new Map<string, string>();
  const calls: string[] = [];
  const store: SecureStorePort = {
    whenPasscodeSetThisDeviceOnly: 6,
    async setItem(key, value, options) {
      calls.push(
        `set:${options.keychainService}:${String(options.requireAuthentication)}`,
      );
      if (options.requireAuthentication && configuration.failProtectedSet) {
        throw new Error("protected write failed");
      }
      records.set(`${options.keychainService}:${key}`, value);
    },
    async getItem(key, options) {
      calls.push(
        `get:${options.keychainService}:${String(options.requireAuthentication)}`,
      );
      return records.get(`${options.keychainService}:${key}`) ?? null;
    },
    async deleteItem(key, options) {
      calls.push(`delete:${options.keychainService}`);
      records.delete(`${options.keychainService}:${key}`);
    },
  };
  return { calls, records, store };
}

describe("credential vault", () => {
  test("separates authenticated secret and non-secret manifest records", async () => {
    const harness = createStore();
    const vault = createCredentialVault({
      store: harness.store,
      installationEpoch: "install_epoch_test_1",
    });
    const bytes = new Uint8Array(32).fill(7);
    await vault.stage({
      binding: BINDING,
      registrationName: "ht-123456789abcd",
      requestedExpiry: 1_802_592_000_000,
      secret: { bytes, dispose: () => bytes.fill(0) },
    });
    expect(harness.calls.slice(0, 3)).toEqual([
      "get:hypertrader.custody-manifest.v1:undefined",
      "set:hypertrader.custody-manifest.v1:undefined",
      "set:hypertrader.api-wallet.v1:true",
    ]);
    expect(
      [...harness.records.keys()].some((key) =>
        key.startsWith("hypertrader.custody-manifest.v1:"),
      ),
    ).toBe(true);
    expect(
      [...harness.records.keys()].some((key) =>
        key.startsWith("hypertrader.api-wallet.v1:"),
      ),
    ).toBe(true);
    expect(harness.calls).toContain("set:hypertrader.api-wallet.v1:true");

    const protectedSecret = await vault.read(BINDING);
    expect(protectedSecret.bytes).toEqual(new Uint8Array(32).fill(7));
    protectedSecret.dispose();
    expect(protectedSecret.bytes.every((value) => value === 0)).toBe(true);
  });

  test("applies the compile-owned mainnet stage before protected storage", async () => {
    const harness = createStore();
    const vault = createCredentialVault({
      store: harness.store,
      installationEpoch: "install_epoch_test_1",
    });
    const mainnetBinding = { ...BINDING, network: "mainnet" as const };
    if (MAINNET_TRADING_RELEASE_STAGE === "preactivation") {
      await expect(vault.read(mainnetBinding)).rejects.toThrow(
        "mainnet signer access is disabled",
      );
      expect(harness.calls).toEqual([]);
    } else {
      const bytes = new Uint8Array(32).fill(7);
      await vault.stage({
        binding: mainnetBinding,
        registrationName: "ht-123456789abcd",
        requestedExpiry: 1_802_592_000_000,
        secret: { bytes, dispose: () => bytes.fill(0) },
      });
      harness.calls.length = 0;
      const protectedSecret = await vault.read(mainnetBinding);
      expect(harness.calls).toEqual(["get:hypertrader.api-wallet.v1:true"]);
      protectedSecret.dispose();
    }
  });

  test("permits exact mainnet credential deletion while signer access is stopped", async () => {
    const harness = createStore();
    const vault = createCredentialVault({
      store: harness.store,
      installationEpoch: "install_epoch_test_1",
    });

    await expect(
      vault.delete({ ...BINDING, network: "mainnet" }),
    ).resolves.toBeUndefined();
    expect(harness.calls).toEqual([
      "delete:hypertrader.api-wallet.v1",
      "get:hypertrader.custody-manifest.v1:undefined",
    ]);
  });

  test("rolls back a new manifest when protected storage rejects the secret", async () => {
    const harness = createStore({ failProtectedSet: true });
    const vault = createCredentialVault({
      store: harness.store,
      installationEpoch: "install_epoch_test_1",
    });
    const bytes = new Uint8Array(32).fill(7);

    await expect(
      vault.stage({
        binding: BINDING,
        registrationName: "ht-123456789abcd",
        requestedExpiry: 1_802_592_000_000,
        secret: { bytes, dispose: () => bytes.fill(0) },
      }),
    ).rejects.toThrow("protected write failed");

    expect(harness.records.size).toBe(0);
    expect(harness.calls.slice(-2)).toEqual([
      "set:hypertrader.api-wallet.v1:true",
      "delete:hypertrader.custody-manifest.v1",
    ]);
  });

  test("quarantines a surviving manifest when the app sentinel is absent", async () => {
    const harness = createStore();
    const vault = createCredentialVault({
      store: harness.store,
      installationEpoch: "install_epoch_test_1",
    });
    const bytes = new Uint8Array(32).fill(7);
    await vault.stage({
      binding: BINDING,
      registrationName: "ht-123456789abcd",
      requestedExpiry: 1_802_592_000_000,
      secret: { bytes, dispose: () => bytes.fill(0) },
    });
    expect(
      assessCustodyInstall({
        installSentinelPresent: false,
        manifest: await vault.readManifest(),
      }),
    ).toEqual({ status: "quarantine", reason: "surviving_credentials" });
  });
});
