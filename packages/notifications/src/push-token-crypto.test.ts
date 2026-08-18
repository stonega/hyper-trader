import { describe, expect, test } from "bun:test";

import {
  decryptPushToken,
  encryptPushToken,
  PushTokenCryptoError,
  type PushTokenKeyProvider,
} from "./push-token-crypto";

class TestKeyProvider implements PushTokenKeyProvider {
  readonly #keys = new Map<string, Uint8Array>([
    ["dek-v1", new Uint8Array(32).fill(7)],
    ["dek-v2", new Uint8Array(32).fill(9)],
  ]);
  activeVersion = "dek-v1";

  activeKeyVersion(): string {
    return this.activeVersion;
  }

  async wrapKey(
    version: string,
    plaintextKey: Uint8Array,
  ): Promise<Uint8Array> {
    const key = this.#keys.get(version);
    if (!key) throw new PushTokenCryptoError("missing key version");
    return plaintextKey.map((byte, index) => byte ^ (key[index] ?? 0));
  }

  async unwrapKey(
    version: string,
    wrappedKey: Uint8Array,
  ): Promise<Uint8Array> {
    const key = this.#keys.get(version);
    if (!key) throw new PushTokenCryptoError("missing key version");
    if (wrappedKey.byteLength !== 32)
      throw new PushTokenCryptoError("bad wrapped key");
    return wrappedKey.map((byte, index) => byte ^ (key[index] ?? 0));
  }
}

describe("push-token encryption", () => {
  test("uses a stable fingerprint and authenticated scope AAD", async () => {
    const provider = new TestKeyProvider();
    const encrypted = await encryptPushToken(
      {
        installationId: "11".repeat(16),
        provider: "expo",
        token: "ExponentPushToken[synthetic-token]",
      },
      provider,
    );
    expect(encrypted.tokenFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(encrypted.ciphertext).not.toContain("synthetic-token");
    await expect(decryptPushToken(encrypted, provider)).resolves.toBe(
      "ExponentPushToken[synthetic-token]",
    );
    await expect(
      decryptPushToken(
        { ...encrypted, installationId: "22".repeat(16) },
        provider,
      ),
    ).rejects.toThrow(PushTokenCryptoError);
  });

  test("rotates encrypt-active keys while retaining decrypt-only versions", async () => {
    const provider = new TestKeyProvider();
    const oldRow = await encryptPushToken(
      {
        installationId: "11".repeat(16),
        provider: "expo",
        token: "ExponentPushToken[old]",
      },
      provider,
    );
    provider.activeVersion = "dek-v2";
    const newRow = await encryptPushToken(
      {
        installationId: "11".repeat(16),
        provider: "expo",
        token: "ExponentPushToken[new]",
      },
      provider,
    );
    expect(oldRow.keyVersion).toBe("dek-v1");
    expect(newRow.keyVersion).toBe("dek-v2");
    await expect(decryptPushToken(oldRow, provider)).resolves.toContain("old");
  });

  test("uses distinct per-token data keys and fails closed on wrapped-key tampering", async () => {
    const provider = new TestKeyProvider();
    const first = await encryptPushToken(
      {
        installationId: "11".repeat(16),
        provider: "expo",
        token: "ExponentPushToken[first]",
      },
      provider,
    );
    const second = await encryptPushToken(
      {
        installationId: "22".repeat(16),
        provider: "expo",
        token: "ExponentPushToken[second]",
      },
      provider,
    );
    expect(first.wrappedDek).not.toBe(second.wrappedDek);
    await expect(
      decryptPushToken(
        {
          ...first,
          wrappedDek: Buffer.from(new Uint8Array(32).fill(1)).toString(
            "base64",
          ),
        },
        provider,
      ),
    ).rejects.toThrow(PushTokenCryptoError);
    await expect(
      decryptPushToken({ ...first, keyVersion: "missing" }, provider),
    ).rejects.toThrow("unwrap");
  });
});
