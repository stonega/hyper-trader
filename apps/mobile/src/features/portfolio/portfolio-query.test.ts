import { describe, expect, test } from "bun:test";
import type { AccountTarget } from "@hyper-trader/hyperliquid";

import { NATIVE_DUPLICATE } from "../markets/fixture";
import {
  portfolioCatalogCacheKey,
  portfolioQueryKey,
} from "./portfolio-query-key";
import {
  portfolioManualRefreshPlan,
  runPortfolioRefreshPlan,
} from "./portfolio-refresh";

const context = {
  network: "testnet" as const,
  masterAccount: "0x1111111111111111111111111111111111111111",
  targetAccount: "0x1111111111111111111111111111111111111111",
  signer: null,
};

describe("portfolio query isolation", () => {
  test("reuses the portfolio cache across price-only catalog updates", () => {
    const original = portfolioCatalogCacheKey([NATIVE_DUPLICATE]);
    const repriced = portfolioCatalogCacheKey([
      {
        ...NATIVE_DUPLICATE,
        markPx: "102",
        midPx: "101",
      },
    ]);

    expect(repriced).toBe(original);
  });

  test("starts a new portfolio cache entry when trading safety changes", () => {
    const original = portfolioCatalogCacheKey([NATIVE_DUPLICATE]);
    const browseOnly = portfolioCatalogCacheKey([
      { ...NATIVE_DUPLICATE, orderAvailability: "browse_only" },
    ]);

    expect(browseOnly).not.toBe(original);
  });

  test("keys exact target kinds independently even at the same address", () => {
    const targets: readonly AccountTarget[] = [
      { kind: "master", address: context.targetAccount },
      {
        kind: "subaccount",
        address: context.targetAccount,
        masterAddress: context.masterAccount,
      },
      {
        kind: "vault",
        address: context.targetAccount,
        masterAddress: context.masterAccount,
      },
    ];
    const keys = targets.map((target) =>
      portfolioQueryKey(context, target, "catalog-a"),
    );

    expect(new Set(keys.map((key) => JSON.stringify(key))).size).toBe(3);
    const master = targets[0];
    if (!master) throw new Error("master target missing");
    expect(
      portfolioQueryKey(
        { ...context, network: "mainnet" },
        master,
        "catalog-a",
      ),
    ).not.toEqual(keys[0]);
  });
});

describe("portfolio manual refresh planning", () => {
  test("refreshes only account data while the catalog is healthy", () => {
    expect(
      portfolioManualRefreshPlan({
        hasExactTarget: true,
        hasCatalog: true,
        catalogFresh: true,
        catalogFailed: false,
        catalogRefreshing: false,
      }),
    ).toEqual({ account: true, catalog: false });
  });

  test("includes catalog recovery only when metadata needs it", () => {
    expect(
      portfolioManualRefreshPlan({
        hasExactTarget: true,
        hasCatalog: true,
        catalogFresh: false,
        catalogFailed: false,
        catalogRefreshing: false,
      }),
    ).toEqual({ account: true, catalog: true });
    expect(
      portfolioManualRefreshPlan({
        hasExactTarget: true,
        hasCatalog: false,
        catalogFresh: false,
        catalogFailed: true,
        catalogRefreshing: false,
      }),
    ).toEqual({ account: false, catalog: true });
  });

  test("does not restart a catalog refresh already in flight", () => {
    expect(
      portfolioManualRefreshPlan({
        hasExactTarget: true,
        hasCatalog: true,
        catalogFresh: false,
        catalogFailed: false,
        catalogRefreshing: true,
      }),
    ).toEqual({ account: true, catalog: false });
  });

  test("finishes the gesture after live data and refreshes history afterward", async () => {
    let finishAccount!: () => void;
    let historyCalls = 0;
    const account = new Promise<void>((resolve) => {
      finishAccount = resolve;
    });
    const refresh = runPortfolioRefreshPlan(
      { account: true, catalog: false },
      {
        account: () => account,
        catalog: async () => undefined,
        history: () => {
          historyCalls += 1;
          return new Promise(() => undefined);
        },
      },
    );

    expect(historyCalls).toBe(0);
    finishAccount();
    await refresh;
    expect(historyCalls).toBe(1);
  });
});
