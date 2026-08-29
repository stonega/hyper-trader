import { describe, expect, test } from "bun:test";

import {
  parsePublicPortfolioHistorySnapshot,
  parsePublicPortfolioLiveSnapshot,
} from "./portfolio-snapshot";

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

describe("public Portfolio snapshot contracts", () => {
  test("validates and normalizes a live aggregate", () => {
    const result = parsePublicPortfolioLiveSnapshot(
      {
        schemaVersion: 1,
        network: "testnet",
        user: USER,
        generatedAtMs: 20,
        dexes: [
          {
            dex: "",
            clearinghouse,
            openOrders: [
              {
                coin: "BTC",
                limitPx: "104.5",
                oid: 77,
                side: "A",
                sz: "1",
                timestamp: 19,
                origSz: "1",
                triggerCondition: "Price above 110",
                isTrigger: true,
                triggerPx: "110",
                isPositionTpsl: true,
                reduceOnly: true,
                orderType: "Take Profit Market",
              },
            ],
          },
        ],
        spot: { balances: [] },
        sourceGaps: [],
      },
      { network: "testnet", user: USER },
    );

    expect(result.dexes[0]?.clearinghouse.positions).toEqual([]);
    expect(result.dexes[0]?.openOrders[0]).toMatchObject({
      isPositionTpsl: true,
      triggerPrice: "110",
    });
    expect(result.spot.balances).toEqual([]);
  });

  test("rejects identity changes and unknown response fields", () => {
    const live = {
      schemaVersion: 1,
      network: "testnet",
      user: USER,
      generatedAtMs: 20,
      dexes: [],
      spot: { balances: [] },
      sourceGaps: [],
    } as const;
    expect(() =>
      parsePublicPortfolioLiveSnapshot(live, {
        network: "mainnet",
        user: USER,
      }),
    ).toThrow("identity did not match");
    expect(() =>
      parsePublicPortfolioLiveSnapshot({ ...live, privateKey: "never" }),
    ).toThrow("unknown field");
  });

  test("validates a history aggregate without inventing missing rows", () => {
    const result = parsePublicPortfolioHistorySnapshot({
      schemaVersion: 1,
      network: "testnet",
      user: USER,
      generatedAtMs: 20,
      fills: [],
      funding: [],
      periods: [],
      sourceGaps: ["Funding history was unavailable."],
    });
    expect(result.funding).toEqual([]);
    expect(result.sourceGaps).toEqual(["Funding history was unavailable."]);
  });
});
