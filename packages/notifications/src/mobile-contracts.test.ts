import { describe, expect, test } from "bun:test";
import { parsePushTokenRebindRequest } from "./contracts";
import {
  parseDeletePriceRuleRequest,
  parseMobileAlertResponse,
  parseMobileInstallationSnapshotResponse,
} from "./mobile-contracts";

const installationId = "11".repeat(16);

describe("mobile notification contracts", () => {
  test("accepts a bounded installation snapshot and rejects extra response fields", () => {
    const snapshot = {
      installationId,
      state: "active",
      tokenState: "active",
      deliveryHealth: "pending",
      pendingDeliveryCount: 2,
      unknownDeliveryCount: 0,
      accountLinks: [
        {
          accountLinkId: "22".repeat(16),
          network: "testnet",
          masterAccount: `0x${"33".repeat(20)}`,
          targetAccount: `0x${"44".repeat(20)}`,
        },
      ],
      rules: [
        {
          ruleId: "55".repeat(16),
          scope: "account",
          network: "testnet",
          marketId: "perp:BTC",
          eventType: "fill",
          threshold: "0",
          accountLinkId: "22".repeat(16),
        },
      ],
    } as const;
    expect(parseMobileInstallationSnapshotResponse(snapshot)).toEqual(snapshot);
    expect(() =>
      parseMobileInstallationSnapshotResponse({
        ...snapshot,
        pushToken: "ExponentPushToken[forbidden]",
      }),
    ).toThrow("response");
  });

  test("parses an opaque alert lookup without accepting locked-screen payload detail", () => {
    const alert = {
      alertId: "66".repeat(16),
      state: "active",
      category: "execution",
      network: "testnet",
      routeHint: "portfolio",
      createdAtMs: 1_800_000_000_000,
      deliveryState: "provider_accepted",
      rule: {
        ruleId: "55".repeat(16),
        scope: "account",
        marketId: "perp:BTC",
        eventType: "fill",
      },
      account: {
        accountLinkId: "22".repeat(16),
        masterAccount: `0x${"33".repeat(20)}`,
        targetAccount: `0x${"44".repeat(20)}`,
      },
    } as const;
    expect(parseMobileAlertResponse(alert)).toEqual(alert);
    expect(() =>
      parseMobileAlertResponse({
        ...alert,
        balance: "999",
        position: { size: "1" },
      }),
    ).toThrow("response");
  });

  test("permits bearer-only token rotation and deletion only for price-rule request shapes", () => {
    expect(
      parsePushTokenRebindRequest({
        installationId,
        provider: "expo",
        pushToken: "ExponentPushToken[replacement]",
      }),
    ).toEqual({
      installationId,
      provider: "expo",
      pushToken: "ExponentPushToken[replacement]",
    });
    expect(
      parseDeletePriceRuleRequest({
        installationId,
        ruleId: "77".repeat(16),
      }),
    ).toEqual({ installationId, ruleId: "77".repeat(16) });
    expect(() =>
      parseDeletePriceRuleRequest({
        installationId,
        ruleId: "77".repeat(16),
        accountLinkId: "22".repeat(16),
      }),
    ).toThrow("unknown field");
  });
});
