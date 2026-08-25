import { describe, expect, test } from "bun:test";
import { accountFromManualSetup } from "./manual-setup-account";
import type { SetupAttempt } from "./setup-coordinator";
import type { ActivatedSetupRecord } from "./setup-repository";

const ATTEMPT: SetupAttempt = {
  id: `0x${"a".repeat(64)}`,
  network: "testnet",
  connectorSessionId: "manual-session-1",
  masterAccount: "0x1111111111111111111111111111111111111111",
  targetAccount: "0x1111111111111111111111111111111111111111",
  agentAddress: "0x2222222222222222222222222222222222222222",
  registrationName: "Stone API",
  registrationGeneration: 1,
  approvalNonce: 1_800_000_000_000,
  requestedExpiry: 1_802_592_000_000,
  createdAt: 1_800_000_000_000,
  expiresAt: 1_800_086_400_000,
};

const ACTIVATION: ActivatedSetupRecord = {
  attemptId: ATTEMPT.id,
  binding: {
    network: "testnet",
    masterAccount: ATTEMPT.masterAccount,
    targetAccount: ATTEMPT.targetAccount,
    agentAddress: ATTEMPT.agentAddress,
    generation: ATTEMPT.registrationGeneration,
  },
  registrationName: ATTEMPT.registrationName,
  requestedExpiry: ATTEMPT.requestedExpiry,
  effectiveExpiry: ATTEMPT.requestedExpiry - 1_000,
  activatedAt: ATTEMPT.createdAt + 1_000,
};

describe("manual setup account activation", () => {
  test("creates one active testnet master-account summary", () => {
    expect(accountFromManualSetup(ATTEMPT, ACTIVATION)).toMatchObject({
      id: `testnet.${"1".repeat(40)}`,
      network: "testnet",
      target: { kind: "master", address: ATTEMPT.masterAccount },
      authorization: {
        agentAddress: ATTEMPT.agentAddress,
        registrationName: "Stone API",
        registrationState: "active",
        credentialState: "protected",
        effectiveExpiryMs: ACTIVATION.effectiveExpiry,
      },
    });
  });

  test("preserves an activated mainnet API-wallet summary", () => {
    const mainnetAttempt = { ...ATTEMPT, network: "mainnet" as const };
    const mainnetActivation = {
      ...ACTIVATION,
      binding: { ...ACTIVATION.binding, network: "mainnet" as const },
    };

    expect(
      accountFromManualSetup(mainnetAttempt, mainnetActivation),
    ).toMatchObject({
      network: "mainnet",
      authorization: {
        agentAddress: ATTEMPT.agentAddress,
        registrationState: "active",
        credentialState: "protected",
      },
    });
  });

  test("rejects a mismatched activation", () => {
    expect(() =>
      accountFromManualSetup(ATTEMPT, {
        ...ACTIVATION,
        binding: { ...ACTIVATION.binding, generation: 2 },
      }),
    ).toThrow("does not match");
  });
});
