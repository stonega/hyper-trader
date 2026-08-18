import { describe, expect, test } from "bun:test";

import {
  CONTRACT_LIMITS,
  ContractError,
  parseCreateRuleRequest,
  parseIssueChallengeRequest,
  parseLostInstallationRevokeRequest,
  parsePushTokenRebindRequest,
  parsePutRuleRequest,
  parseRegisterInstallationRequest,
  parseRotateInstallationCredentialRequest,
  parseVerifyAccountLinkRequest,
} from "./contracts";

describe("notification request contracts", () => {
  test("accepts bounded canonical installation registration", () => {
    expect(
      parseRegisterInstallationRequest({
        installationId: "11".repeat(16),
        credential: "22".repeat(32),
        provider: "expo",
        pushToken: "ExponentPushToken[synthetic-token]",
      }),
    ).toEqual({
      installationId: "11".repeat(16),
      credential: "22".repeat(32),
      provider: "expo",
      pushToken: "ExponentPushToken[synthetic-token]",
    });
    expect(CONTRACT_LIMITS.maxBodyBytes).toBe(65_536);
    expect(CONTRACT_LIMITS.maxLinkedAccounts).toBe(10);
    expect(CONTRACT_LIMITS.maxActiveRules).toBe(100);
  });

  test("rejects unknown and signing-capable fields at any depth", () => {
    expect(() =>
      parseRegisterInstallationRequest({
        installationId: "11".repeat(16),
        credential: "22".repeat(32),
        provider: "expo",
        pushToken: "ExponentPushToken[synthetic-token]",
        seedPhrase: "never accepted",
      }),
    ).toThrow(ContractError);
    expect(() =>
      parseCreateRuleRequest({
        ruleId: "33".repeat(16),
        scope: "price",
        network: "testnet",
        marketId: "perp:BTC",
        eventType: "price_above",
        threshold: "100000",
        metadata: { signedAction: {} },
      }),
    ).toThrow("forbidden field");
    for (const key of ["PrivateKey", "private_key", "private-key"]) {
      expect(() =>
        parseRegisterInstallationRequest({
          installationId: "11".repeat(16),
          credential: "22".repeat(32),
          provider: "expo",
          pushToken: "ExponentPushToken[synthetic-token]",
          [key]: "never accepted",
        }),
      ).toThrow("forbidden field");
    }
  });

  test("fails closed on invalid decimals, identifiers, and oversized input", () => {
    expect(() =>
      parseCreateRuleRequest({
        ruleId: "33".repeat(16),
        scope: "price",
        network: "testnet",
        marketId: "perp:BTC",
        eventType: "price_above",
        threshold: "NaN",
      }),
    ).toThrow("threshold");
    expect(() =>
      parseRegisterInstallationRequest({
        installationId: "not-hex",
        credential: "22".repeat(32),
        provider: "expo",
        pushToken: "x".repeat(CONTRACT_LIMITS.maxPushTokenChars + 1),
      }),
    ).toThrow(ContractError);
  });

  test("strictly parses proof endpoints and sorted lost-device scope", () => {
    const challenge = parseIssueChallengeRequest({
      installationId: "11".repeat(16),
      network: "testnet",
      masterAccount: `0x${"22".repeat(20)}`,
      targetAccount: `0x${"33".repeat(20)}`,
      purpose: "notification-account-link",
      operationDigest: "44".repeat(32),
    });
    expect(challenge.purpose).toBe("notification-account-link");
    expect(
      parseVerifyAccountLinkRequest({
        installationId: "11".repeat(16),
        accountLinkId: "55".repeat(16),
        challenge: "66".repeat(32),
        message: "canonical-message",
        signature: `0x${"77".repeat(65)}`,
      }).accountLinkId,
    ).toBe("55".repeat(16));
    expect(
      parseLostInstallationRevokeRequest({
        requestingInstallationId: "11".repeat(16),
        operationId: "12".repeat(16),
        network: "testnet",
        masterAccount: `0x${"22".repeat(20)}`,
        targetAccount: `0x${"33".repeat(20)}`,
        selectedInstallationIds: ["44".repeat(16), "55".repeat(16)],
        challenge: "66".repeat(32),
        message: "canonical-message",
        signature: `0x${"77".repeat(65)}`,
      }).selectedInstallationIds,
    ).toEqual(["44".repeat(16), "55".repeat(16)]);
    expect(() =>
      parseLostInstallationRevokeRequest({
        requestingInstallationId: "11".repeat(16),
        operationId: "12".repeat(16),
        network: "testnet",
        masterAccount: `0x${"22".repeat(20)}`,
        targetAccount: `0x${"33".repeat(20)}`,
        selectedInstallationIds: ["55".repeat(16), "44".repeat(16)],
        challenge: "66".repeat(32),
        message: "canonical-message",
        signature: `0x${"77".repeat(65)}`,
      }),
    ).toThrow("sorted");
  });

  test("rejects forged discriminators, case variants, unknown proof fields, and mismatched rule proof shape", () => {
    expect(() =>
      parseIssueChallengeRequest({
        installationId: "11".repeat(16),
        network: "Testnet",
        masterAccount: `0x${"22".repeat(20)}`,
        targetAccount: `0x${"33".repeat(20)}`,
        purpose: "notification-account-link",
        operationDigest: "44".repeat(32),
      }),
    ).toThrow("network");
    expect(
      parseIssueChallengeRequest({
        installationId: "11".repeat(16),
        network: "testnet",
        masterAccount: `0x${"22".repeat(20)}`,
        targetAccount: `0x${"33".repeat(20)}`,
        purpose: "notification-push-token-rebind",
        operationDigest: "44".repeat(32),
      }).purpose,
    ).toBe("notification-push-token-rebind");
    expect(() =>
      parseVerifyAccountLinkRequest({
        installationId: "11".repeat(16),
        accountLinkId: "55".repeat(16),
        challenge: "66".repeat(32),
        message: "canonical-message",
        signature: `0x${"77".repeat(65)}`,
        role: "admin",
      }),
    ).toThrow("unknown field");
    expect(() =>
      parsePutRuleRequest({
        ruleId: "33".repeat(16),
        scope: "price",
        network: "testnet",
        marketId: "perp:BTC",
        eventType: "price_above",
        threshold: "100000",
        proof: {
          challenge: "66".repeat(32),
          message: "canonical-message",
          signature: `0x${"77".repeat(65)}`,
        },
      }),
    ).toThrow("price rule");
  });

  test("strictly parses credential rotation and proof-bound push-token rebind", () => {
    expect(
      parseRotateInstallationCredentialRequest({
        installationId: "11".repeat(16),
        newCredential: "88".repeat(32),
      }),
    ).toEqual({
      installationId: "11".repeat(16),
      newCredential: "88".repeat(32),
    });
    const rebind = {
      installationId: "11".repeat(16),
      accountLinkId: "55".repeat(16),
      provider: "expo",
      pushToken: "ExponentPushToken[replacement]",
      proof: {
        challenge: "66".repeat(32),
        message: "canonical-message",
        signature: `0x${"77".repeat(65)}`,
      },
    };
    expect(parsePushTokenRebindRequest(rebind)).toEqual(rebind);
    expect(() =>
      parsePushTokenRebindRequest({
        ...rebind,
        proof: { ...rebind.proof, accountLinkId: "99".repeat(16) },
      }),
    ).toThrow("unknown field");
    expect(() =>
      parseRotateInstallationCredentialRequest({
        installationId: "11".repeat(16),
        newCredential: "88".repeat(32),
        credentialGeneration: 2,
      }),
    ).toThrow("unknown field");
  });
});
