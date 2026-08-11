import { describe, expect, test } from "bun:test";
import type { MobileAlertResponse } from "@hyper-trader/notifications/mobile";

import { refreshAuthoritativeNotificationTarget } from "./authoritative-refresh";

const alert: MobileAlertResponse = {
  alertId: "11".repeat(16),
  state: "active",
  category: "price",
  network: "testnet",
  routeHint: "trade",
  createdAtMs: 1_800_000_000_000,
  deliveryState: "provider_accepted",
  rule: {
    ruleId: "22".repeat(16),
    scope: "price",
    marketId: "perp:BTC",
    eventType: "price_above",
  },
  account: null,
};

describe("authoritative notification refresh", () => {
  test("requires the exact active canonical market before returning current state", async () => {
    const calls: string[] = [];
    await expect(
      refreshAuthoritativeNotificationTarget(alert, {
        now: () => 1_800_000_000_100,
        client: {
          async getMarketCatalog() {
            calls.push("catalog");
            return {
              markets: [{ canonicalId: "perp:BTC", lifecycle: "active" }],
            };
          },
          async getNotificationAccountGlobalSnapshot() {
            calls.push("account");
          },
        },
      }),
    ).resolves.toEqual({ observedAtMs: 1_800_000_000_100 });
    expect(calls).toEqual(["catalog"]);
  });

  test("refreshes account state only after market validation and rejects delisted targets", async () => {
    const calls: string[] = [];
    const accountAlert: MobileAlertResponse = {
      ...alert,
      category: "execution",
      routeHint: "portfolio",
      rule: {
        ruleId: "22".repeat(16),
        scope: "account",
        marketId: "perp:BTC",
        eventType: "fill",
      },
      account: {
        accountLinkId: "33".repeat(16),
        masterAccount: `0x${"44".repeat(20)}`,
        targetAccount: `0x${"55".repeat(20)}`,
      },
    };
    await refreshAuthoritativeNotificationTarget(accountAlert, {
      now: () => 1,
      client: {
        async getMarketCatalog() {
          calls.push("catalog");
          return {
            markets: [{ canonicalId: "perp:BTC", lifecycle: "active" }],
          };
        },
        async getNotificationAccountGlobalSnapshot(input) {
          calls.push(`account:${input.user}`);
        },
      },
    });
    expect(calls).toEqual([
      "catalog",
      `account:${accountAlert.account?.targetAccount}`,
    ]);

    await expect(
      refreshAuthoritativeNotificationTarget(alert, {
        now: () => 1,
        client: {
          async getMarketCatalog() {
            return {
              markets: [{ canonicalId: "perp:BTC", lifecycle: "delisted" }],
            };
          },
          async getNotificationAccountGlobalSnapshot() {},
        },
      }),
    ).rejects.toThrow("unavailable");
  });
});
