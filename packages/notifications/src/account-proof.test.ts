import { describe, expect, test } from "bun:test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import {
  buildAccountProofMessage,
  createChallengeRecord,
  operationDigest,
  verifyAccountProof,
} from "./account-proof";

const account = privateKeyToAccount(generatePrivateKey());
const installationId = "11".repeat(16);
const targetAccount = `0x${"22".repeat(20)}`;
const challenge = "33".repeat(32);
const issuedAt = 1_800_000_000_000;

describe("account-scope proof v1", () => {
  test("verifies the exact canonical one-time operation binding", async () => {
    const digest = await operationDigest("account-link/v1", {
      installationId,
      network: "testnet",
      masterAccount: account.address.toLowerCase(),
      targetAccount,
    });
    const record = await createChallengeRecord({
      challenge,
      credentialHash: "44".repeat(32),
      installationId,
      network: "testnet",
      masterAccount: account.address.toLowerCase(),
      targetAccount,
      purpose: "notification-account-link",
      operationDigest: digest,
      serviceOrigin: "https://notify.example.com",
      issuedAt,
    });
    const message = buildAccountProofMessage(record, challenge);
    const signature = await account.signMessage({ message });

    await expect(
      verifyAccountProof({
        record,
        challenge,
        message,
        signature,
        now: issuedAt + 1,
      }),
    ).resolves.toEqual({ masterAccount: account.address.toLowerCase() });
  });

  test("rejects replay state, expiry, noncanonical bytes, and wrong binding", async () => {
    const digest = await operationDigest("account-link/v1", {
      installationId,
      network: "testnet",
    });
    const record = await createChallengeRecord({
      challenge,
      credentialHash: "44".repeat(32),
      installationId,
      network: "testnet",
      masterAccount: account.address.toLowerCase(),
      targetAccount,
      purpose: "notification-account-link",
      operationDigest: digest,
      serviceOrigin: "https://notify.example.com",
      issuedAt,
    });
    const message = buildAccountProofMessage(record, challenge);
    const signature = await account.signMessage({ message });

    await expect(
      verifyAccountProof({
        record: { ...record, state: "consumed" },
        challenge,
        message,
        signature,
        now: issuedAt + 1,
      }),
    ).rejects.toThrow("pending");
    await expect(
      verifyAccountProof({
        record,
        challenge,
        message,
        signature,
        now: issuedAt + 300_001,
      }),
    ).rejects.toThrow("expired");
    await expect(
      verifyAccountProof({
        record,
        challenge,
        message: `${message}\n`,
        signature,
        now: issuedAt + 1,
      }),
    ).rejects.toThrow("canonical");
    await expect(
      verifyAccountProof({
        record: { ...record, network: "mainnet" },
        challenge,
        message,
        signature,
        now: issuedAt + 1,
      }),
    ).rejects.toThrow("canonical");
  });
});
