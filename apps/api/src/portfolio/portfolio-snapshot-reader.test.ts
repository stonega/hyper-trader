import { describe, expect, test } from "bun:test";
import type {
  HyperliquidNetwork,
  InfoHttpTransport,
} from "@hyper-trader/hyperliquid/public";

import { HyperliquidPortfolioSnapshotReader } from "./portfolio-snapshot-reader";

const USER = `0x${"1".repeat(40)}`;
const summary = {
  accountValue: "10",
  totalNtlPos: "0",
  totalRawUsd: "10",
  totalMarginUsed: "0",
};
const clearinghouse = {
  assetPositions: [],
  crossMaintenanceMarginUsed: "0",
  crossMarginSummary: summary,
  marginSummary: summary,
  time: 10,
  withdrawable: "10",
};

function transport(calls: string[]): InfoHttpTransport {
  return {
    network: "testnet",
    endpoint: "https://example.com/info",
    budgetFor: () => ({ requestType: "test", baseWeight: 1, totalWeight: 1 }),
    async request(body) {
      calls.push(body.type);
      if (body.type === "clearinghouseState") return clearinghouse;
      if (body.type === "spotClearinghouseState") {
        return {
          balances: [
            {
              coin: "retired-token",
              hold: "0.0",
              total: "0.0",
              entryNtl: "0.0",
            },
          ],
        };
      }
      if (body.type === "historicalOrders") {
        return [{ order: { coin: "builder:COIN" } }];
      }
      return [];
    },
  };
}

describe("backend Portfolio snapshot reader", () => {
  test("aggregates DEX, spot, and history requests and reuses short cache entries", async () => {
    const calls: string[] = [];
    const source = transport(calls);
    const reader = new HyperliquidPortfolioSnapshotReader({
      transports: {
        testnet: source,
        mainnet: { ...source, network: "mainnet" as HyperliquidNetwork },
      },
      catalog: {
        readPublished: async (network) => ({
          network,
          generation: 1,
          publishedAtMs: 1,
          catalog: {
            markets: [
              {
                family: "perp",
                dexName: "",
              } as never,
              {
                family: "perp",
                dexName: "builder",
              } as never,
            ],
            quarantined: [],
            sourceErrors: [],
          },
        }),
      },
      now: () => 1_800_000_000_000,
    });

    const live = await reader.readLive({ network: "testnet", user: USER });
    await reader.readLive({ network: "testnet", user: USER });
    const history = await reader.readHistory({
      network: "testnet",
      user: USER,
    });

    expect(live.dexes.map(({ dex }) => dex)).toEqual(["", "builder"]);
    expect(live.spot.balances).toEqual([]);
    expect(history.fills).toEqual([]);
    expect(calls.filter((type) => type === "clearinghouseState")).toHaveLength(
      2,
    );
    expect(calls.filter((type) => type === "frontendOpenOrders")).toHaveLength(
      2,
    );
    expect(calls).toContain("portfolio");
  });

  test("rejects a mixed-case request before upstream work", async () => {
    const calls: string[] = [];
    const source = transport(calls);
    const reader = new HyperliquidPortfolioSnapshotReader({
      transports: { testnet: source, mainnet: source },
      catalog: { readPublished: async () => null },
    });

    await expect(
      reader.readLive({ network: "testnet", user: USER.toUpperCase() }),
    ).rejects.toThrow("lowercase address");
    expect(calls).toEqual([]);
  });

  test("bounds platform DEX coverage and concurrent requests", async () => {
    let active = 0;
    let maximum = 0;
    const source: InfoHttpTransport = {
      network: "testnet",
      endpoint: "https://example.com/info",
      budgetFor: () => ({ requestType: "test", baseWeight: 1, totalWeight: 1 }),
      async request(body) {
        if (
          body.type === "clearinghouseState" ||
          body.type === "frontendOpenOrders"
        ) {
          active += 1;
          maximum = Math.max(maximum, active);
          await new Promise((resolve) => setTimeout(resolve, 1));
          active -= 1;
        }
        if (body.type === "clearinghouseState") return clearinghouse;
        if (body.type === "spotClearinghouseState") return { balances: [] };
        if (body.type === "historicalOrders") {
          return Array.from({ length: 5 }, (_, index) => ({
            order: { coin: `builder-${index}:COIN` },
          }));
        }
        return [];
      },
    };
    const reader = new HyperliquidPortfolioSnapshotReader({
      transports: { testnet: source, mainnet: source },
      catalog: {
        readPublished: async (network) => ({
          network,
          generation: 1,
          publishedAtMs: 1,
          catalog: {
            markets: Array.from({ length: 5 }, (_, index) => ({
              family: "perp",
              dexName: `builder-${index}`,
            })) as never,
            quarantined: [],
            sourceErrors: [],
          },
        }),
      },
      dexBatchSize: 2,
      maxDexes: 2,
    });

    const live = await reader.readLive({ network: "testnet", user: USER });

    expect(maximum).toBe(4);
    expect(live.dexes).toHaveLength(2);
    expect(live.sourceGaps).toEqual([
      "Active perpetual DEX coverage exceeded the bounded response window.",
    ]);
  });
});
