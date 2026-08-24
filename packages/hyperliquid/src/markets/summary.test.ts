import { describe, expect, test } from "bun:test";
import {
  createMarketSummaryPage,
  MarketSummaryGenerationChangedError,
  parseMarketSummaryPage,
} from "./summary";
import type { PerpMarket } from "./types";

function perp(index: number, volume: string): PerpMarket {
  return {
    family: "perp",
    canonicalId: `perp:0:${index}`,
    displaySymbol: `M${index}`,
    coin: `M${index}`,
    dexIndex: 0,
    dexName: "",
    dexFullName: null,
    universeIndex: index,
    orderAssetId: index,
    sizeDecimals: 2,
    pricePrecision: { maxSignificantFigures: 5, maxDecimalPlaces: 4 },
    maxLeverage: 10,
    onlyIsolated: false,
    marginMode: null,
    marginTableId: null,
    lifecycle: "active",
    orderAvailability: "enabled",
    validationReasons: [],
    dayNtlVlm: volume,
    markPx: "1",
  };
}

const baseQuery = {
  query: "",
  family: null,
  includeHip3: true,
  availability: "enabled" as const,
  lifecycle: "active" as const,
  sort: "volume" as const,
  ids: [],
  cursor: null,
  limit: 2,
};

describe("market summary pages", () => {
  test("excludes only HIP-3 perpetuals when HIP-3 inclusion is disabled", () => {
    const native = perp(0, "10");
    const hip3: PerpMarket = {
      ...perp(1, "30"),
      canonicalId: "perp:3:1",
      coin: "xyz:M1",
      dexIndex: 3,
      dexName: "xyz",
      dexFullName: "XYZ Markets",
    };
    const page = createMarketSummaryPage({
      network: "testnet",
      generation: 4,
      publishedAtMs: 1_800_000_000_000,
      markets: [native, hip3],
      quarantinedCount: 0,
      sourceErrorCount: 0,
      query: { ...baseQuery, includeHip3: false },
    });

    expect(page.items.map(({ canonicalId }) => canonicalId)).toEqual([
      native.canonicalId,
    ]);
    expect(page.total).toBe(1);
  });

  test("filters and pages a generation before removing trading-only fields", () => {
    const first = createMarketSummaryPage({
      network: "testnet",
      generation: 4,
      publishedAtMs: 1_800_000_000_000,
      markets: [perp(0, "10"), perp(1, "30"), perp(2, "20")],
      quarantinedCount: 2,
      sourceErrorCount: 1,
      query: baseQuery,
    });

    expect(first.items.map(({ canonicalId }) => canonicalId)).toEqual([
      "perp:0:1",
      "perp:0:2",
    ]);
    expect(first.nextCursor).toBe("g4o2");
    expect(first.items[0]).not.toHaveProperty("orderAssetId");
    expect(first.items[0]).toMatchObject({
      pricePrecision: { maxSignificantFigures: 5, maxDecimalPlaces: 4 },
      maxLeverage: 10,
    });
    expect(parseMarketSummaryPage(first)).toEqual(first);

    const second = createMarketSummaryPage({
      network: "testnet",
      generation: 4,
      publishedAtMs: 1_800_000_000_000,
      markets: [perp(0, "10"), perp(1, "30"), perp(2, "20")],
      quarantinedCount: 2,
      sourceErrorCount: 1,
      query: { ...baseQuery, cursor: first.nextCursor },
    });
    expect(second.items.map(({ canonicalId }) => canonicalId)).toEqual([
      "perp:0:0",
    ]);
    expect(second.nextCursor).toBeNull();
  });

  test("rejects mixed generations and unknown response fields", () => {
    expect(() =>
      createMarketSummaryPage({
        network: "testnet",
        generation: 5,
        publishedAtMs: 1_800_000_000_000,
        markets: [perp(0, "10")],
        quarantinedCount: 0,
        sourceErrorCount: 0,
        query: { ...baseQuery, cursor: "g4o1" },
      }),
    ).toThrow(MarketSummaryGenerationChangedError);

    expect(() =>
      parseMarketSummaryPage({
        schemaVersion: 1,
        network: "testnet",
        generation: 1,
        publishedAtMs: 1,
        items: [],
        total: 0,
        nextCursor: null,
        quarantinedCount: 0,
        sourceErrorCount: 0,
        unsafe: true,
      }),
    ).toThrow("unknown field");
  });
});
