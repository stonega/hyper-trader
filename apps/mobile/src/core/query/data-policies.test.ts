import { describe, expect, test } from "bun:test";

import { mobileDataPolicies } from "./data-policies";

describe("mobile data policies", () => {
  test("persists only public or local presentation data", () => {
    const persisted = Object.entries(mobileDataPolicies)
      .filter(([, policy]) => policy.persistence === "public-device")
      .map(([name]) => name);

    expect(persisted).toEqual(["marketSummaries", "localPreferences"]);
    expect(mobileDataPolicies.candles.persistence).toBe("memory");
    expect(mobileDataPolicies.marketContext.persistence).toBe("memory");
    expect(mobileDataPolicies.tradeAccount.persistence).toBe("memory");
    expect(mobileDataPolicies.portfolioLive.persistence).toBe("memory");
  });

  test("allows only secure signing state to authorize an action", () => {
    const authorities = Object.entries(mobileDataPolicies)
      .filter(([, policy]) => policy.mayAuthorizeAction)
      .map(([name]) => name);

    expect(authorities).toEqual(["signingState"]);
  });

  test("does not schedule interval reconciliation for realtime market feeds", () => {
    expect(mobileDataPolicies.candles.reconcileIntervalMs).toBe(false);
    expect(mobileDataPolicies.orderBook.reconcileIntervalMs).toBe(false);
    expect(mobileDataPolicies.recentTrades.reconcileIntervalMs).toBe(false);
  });

  test("reconciles polled baselines before their freshness window expires", () => {
    expect(mobileDataPolicies.marketCatalog.reconcileIntervalMs).toBeLessThan(
      mobileDataPolicies.marketCatalog.staleTimeMs,
    );
    expect(mobileDataPolicies.marketSummaries.reconcileIntervalMs).toBeLessThan(
      mobileDataPolicies.marketSummaries.staleTimeMs,
    );
    expect(mobileDataPolicies.portfolioLive.reconcileIntervalMs).toBeLessThan(
      mobileDataPolicies.portfolioLive.staleTimeMs,
    );
    expect(mobileDataPolicies.tradeAccount.reconcileIntervalMs).toBeLessThan(
      mobileDataPolicies.tradeAccount.staleTimeMs,
    );
  });
});
