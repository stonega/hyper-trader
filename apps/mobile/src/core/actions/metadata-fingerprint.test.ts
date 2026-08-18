import { describe, expect, test } from "bun:test";

import { marketMetadataFingerprint } from "./metadata-fingerprint";

describe("market metadata fingerprint", () => {
  test("serializes every safety field into an inspectable versioned tuple", () => {
    expect(
      marketMetadataFingerprint({
        canonicalId: "perp:1:2",
        orderAssetId: 110_002,
        family: "perp",
        pricePrecision: {
          maxSignificantFigures: 5,
          maxDecimalPlaces: 4,
        },
        sizeDecimals: 2,
        maxLeverage: 20,
        onlyIsolated: true,
        marginMode: "isolated",
        marginTableId: 7,
        lifecycle: "active",
        orderAvailability: "enabled",
      }),
    ).toBe(
      '["hyper-trader-market-safety-v1","perp:1:2",110002,"perp",[5,4],2,20,true,"isolated",7,"active","enabled"]',
    );
  });

  test("is stable when source object and precision key order changes", () => {
    const first = marketMetadataFingerprint({
      family: "spot",
      canonicalId: "spot:4",
      orderAssetId: 10_004,
      pricePrecision: { maxSignificantFigures: 5, maxDecimalPlaces: 6 },
      sizeDecimals: 2,
      lifecycle: "active",
      orderAvailability: "enabled",
    });
    const second = marketMetadataFingerprint({
      orderAvailability: "enabled",
      lifecycle: "active",
      sizeDecimals: 2,
      pricePrecision: { maxDecimalPlaces: 6, maxSignificantFigures: 5 },
      orderAssetId: 10_004,
      canonicalId: "spot:4",
      family: "spot",
    });

    expect(second).toBe(first);
  });

  test("changes when any trading-safety constraint changes", () => {
    const base = {
      canonicalId: "perp:0:0",
      orderAssetId: 0,
      family: "perp" as const,
      pricePrecision: {
        maxSignificantFigures: 5 as const,
        maxDecimalPlaces: 4,
      },
      sizeDecimals: 2,
      maxLeverage: 50,
      onlyIsolated: false,
      marginMode: null,
      marginTableId: 1,
      lifecycle: "active" as const,
      orderAvailability: "enabled" as const,
    };
    const original = marketMetadataFingerprint(base);

    expect(
      [
        { ...base, orderAssetId: 1 },
        {
          ...base,
          pricePrecision: { ...base.pricePrecision, maxDecimalPlaces: 3 },
        },
        { ...base, sizeDecimals: 3 },
        { ...base, maxLeverage: 20 },
        { ...base, onlyIsolated: true },
        { ...base, marginMode: "isolated" },
        { ...base, marginTableId: 2 },
        { ...base, lifecycle: "delisted" as const },
        { ...base, orderAvailability: "browse_only" as const },
      ].every((changed) => marketMetadataFingerprint(changed) !== original),
    ).toBe(true);
  });
});
