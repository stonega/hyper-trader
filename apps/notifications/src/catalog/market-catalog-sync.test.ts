import { describe, expect, test } from "bun:test";
import type {
  HyperliquidNetwork,
  MarketCatalog,
  PublicHyperliquidClient,
} from "@hyper-trader/hyperliquid/public";
import type { MarketCatalogSyncLease } from "./market-catalog-store";
import {
  MarketCatalogSynchronizer,
  type MarketCatalogSyncStore,
} from "./market-catalog-sync";

function lease(
  input: Partial<MarketCatalogSyncLease> = {},
): MarketCatalogSyncLease {
  return {
    network: "testnet",
    ownerId: "catalog-a",
    leaseGeneration: 1,
    buildingGeneration: 1,
    publishedGeneration: null,
    coreReady: false,
    nextBuilderOffset: 0,
    builderTotal: null,
    pageFailures: 0,
    ...input,
  };
}

function catalog(input: Partial<MarketCatalog> = {}): MarketCatalog {
  return { markets: [], quarantined: [], sourceErrors: [], ...input };
}

describe("market catalog synchronizer", () => {
  test("syncs core before a bounded builder page and throttles lease checks", async () => {
    let now = 1_000;
    const calls: string[] = [];
    const leases = [lease(), lease({ coreReady: true, nextBuilderOffset: 37 })];
    const store: MarketCatalogSyncStore = {
      claimDueSync: async () => leases.shift() ?? null,
      completeCore: async () => {
        calls.push("stored:core");
      },
      completeBuilderPage: async () => {
        calls.push("stored:builder");
        return { published: false };
      },
      recordFailure: async () => {
        calls.push("failed");
      },
    };
    const clients = clientsFor(async (options) => {
      calls.push(
        options?.scope === "incremental"
          ? `request:builder:${options.builderDexOffset}:${options.builderDexLimit}`
          : "request:core",
      );
      return catalog({
        ...(options?.scope === "incremental"
          ? {
              builderPage: {
                offset: options.builderDexOffset,
                limit: options.builderDexLimit,
                total: 74,
                dexes: [],
              },
            }
          : {}),
      });
    });
    const sync = new MarketCatalogSynchronizer({
      ownerId: "catalog-a",
      store,
      clients,
      now: () => now,
    });

    expect(await sync.runOnce()).toBe(true);
    expect(await sync.runOnce()).toBe(false);
    now += 30_000;
    expect(await sync.runOnce()).toBe(true);
    expect(calls).toEqual([
      "request:core",
      "stored:core",
      "request:builder:37:37",
      "stored:builder",
    ]);
  });

  test("records a failed request without publishing partial state", async () => {
    const calls: string[] = [];
    const store: MarketCatalogSyncStore = {
      claimDueSync: async () => lease({ coreReady: true }),
      completeCore: async () => {
        calls.push("core");
      },
      completeBuilderPage: async () => {
        calls.push("builder");
        return { published: true };
      },
      recordFailure: async () => {
        calls.push("failed");
      },
    };
    const sync = new MarketCatalogSynchronizer({
      ownerId: "catalog-a",
      store,
      clients: clientsFor(async () => {
        throw new Error("upstream unavailable");
      }),
    });

    expect(await sync.runOnce()).toBe(true);
    expect(calls).toEqual(["failed"]);
  });
});

function clientsFor(
  getMarketCatalog: PublicHyperliquidClient["getMarketCatalog"],
): Readonly<Record<HyperliquidNetwork, PublicHyperliquidClient>> {
  const client = {
    network: "testnet",
    getMarketCatalog,
  } as PublicHyperliquidClient;
  return { testnet: client, mainnet: client };
}
