import { describe, expect, test } from "bun:test";
import type {
  MarketCatalog,
  PerpMarket,
} from "@hyper-trader/hyperliquid/public";

import {
  catalogFromPayload,
  emptyCatalogPayload,
  mergeBuilderCatalog,
  mergeCoreCatalog,
  pruneBuilderCatalog,
  retainedBuilderTotal,
} from "./catalog-payload";

describe("Cloudflare market catalog payload", () => {
  test("replaces successful core sources while retaining a failed source", () => {
    const original = mergeCoreCatalog(emptyCatalogPayload(), {
      markets: [perp(0, 0, "BTC"), spot()],
      quarantined: [],
      sourceErrors: [],
    }).payload;
    const merged = mergeCoreCatalog(original, {
      markets: [perp(0, 0, "ETH")],
      quarantined: [],
      sourceErrors: [
        { source: "spotMetaAndAssetCtxs", message: "temporarily unavailable" },
      ],
    });

    expect(merged.errors).toHaveLength(1);
    expect(catalogFromPayload(merged.payload).markets).toEqual([
      perp(0, 0, "ETH"),
      spot(),
    ]);
  });

  test("merges builder pages and prunes retired builder sources", () => {
    const first = mergeBuilderCatalog(emptyCatalogPayload(), {
      markets: [perp(1, 0, "ABC"), perp(2, 0, "DEF")],
      quarantined: [],
      sourceErrors: [],
      builderPage: {
        offset: 0,
        limit: 37,
        total: 2,
        dexes: [
          { index: 1, name: "a", fullName: "A" },
          { index: 2, name: "b", fullName: "B" },
        ],
      },
    });

    expect(retainedBuilderTotal(first.payload)).toBe(2);
    expect(
      catalogFromPayload(pruneBuilderCatalog(first.payload, 1)).markets,
    ).toEqual([perp(1, 0, "ABC")]);
  });
});

function perp(
  dexIndex: number,
  universeIndex: number,
  coin: string,
): PerpMarket {
  return {
    family: "perp",
    canonicalId: `perp:${dexIndex}:${universeIndex}`,
    displaySymbol: coin,
    coin,
    dexIndex,
    dexName: dexIndex === 0 ? "" : `dex-${dexIndex}`,
    dexFullName: null,
    universeIndex,
    orderAssetId:
      dexIndex === 0
        ? universeIndex
        : 100_000 + dexIndex * 10_000 + universeIndex,
    sizeDecimals: 3,
    pricePrecision: { maxSignificantFigures: 5, maxDecimalPlaces: 3 },
    maxLeverage: 20,
    onlyIsolated: false,
    marginMode: null,
    marginTableId: null,
    lifecycle: "active",
    orderAvailability: "enabled",
    validationReasons: [],
  };
}

function spot(): MarketCatalog["markets"][number] {
  return {
    family: "spot",
    canonicalId: "spot:0",
    displaySymbol: "PURR",
    coin: "@0",
    dexIndex: null,
    dexName: null,
    universeIndex: 0,
    orderAssetId: 10_000,
    sizeDecimals: 2,
    pricePrecision: { maxSignificantFigures: 5, maxDecimalPlaces: 6 },
    baseToken: {
      index: 0,
      tokenId: "0x0",
      name: "PURR",
      fullName: null,
      sizeDecimals: 2,
      weiDecimals: 5,
      isCanonical: true,
      evmContract: null,
    },
    quoteToken: {
      index: 1,
      tokenId: "0x1",
      name: "USDC",
      fullName: null,
      sizeDecimals: 2,
      weiDecimals: 6,
      isCanonical: true,
      evmContract: null,
    },
    isCanonical: true,
    lifecycle: "active",
    orderAvailability: "enabled",
    validationReasons: [],
  };
}
