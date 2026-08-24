import { describe, expect, test } from "bun:test";
import type { Market } from "@hyper-trader/hyperliquid/public";

import { HIP3_DUPLICATE, MARKET_FIXTURE, NATIVE_DUPLICATE } from "./fixture";
import {
  isUsableTradeSelection,
  normalizeMarketRouteParam,
  resolveMarketSelection,
} from "./selection";

const DEFAULT_BTC_MARKET = {
  ...NATIVE_DUPLICATE,
  canonicalId: "perp:0:0",
  displaySymbol: "BTC",
  coin: "BTC",
  universeIndex: 0,
  orderAssetId: 0,
  dayNtlVlm: "1",
} satisfies Market;

describe("Trade market selection", () => {
  test("prefers a valid route selection, then a still-valid last market", () => {
    expect(
      resolveMarketSelection(
        MARKET_FIXTURE,
        NATIVE_DUPLICATE.canonicalId,
        HIP3_DUPLICATE.canonicalId,
      ),
    ).toMatchObject({ market: NATIVE_DUPLICATE, source: "route" });
    expect(
      resolveMarketSelection(
        MARKET_FIXTURE,
        "perp:99:99",
        NATIVE_DUPLICATE.canonicalId,
      ),
    ).toMatchObject({ market: NATIVE_DUPLICATE, source: "last_used" });
  });

  test("uses native BTC-USDC when there is no valid requested or saved market", () => {
    expect(
      resolveMarketSelection([HIP3_DUPLICATE, DEFAULT_BTC_MARKET], null, null),
    ).toMatchObject({
      market: DEFAULT_BTC_MARKET,
      source: "default_market",
    });
  });

  test("uses dynamic volume fallback when BTC-USDC is unavailable", () => {
    expect(
      resolveMarketSelection(MARKET_FIXTURE, null, "perp:2:1"),
    ).toMatchObject({ market: HIP3_DUPLICATE, source: "volume_fallback" });
    expect(resolveMarketSelection([], null, "perp:0:0")).toBeNull();
  });

  test("can defer fallback while a partial catalog is still loading", () => {
    expect(
      resolveMarketSelection(MARKET_FIXTURE, "spot:404", null, {
        allowVolumeFallback: false,
      }),
    ).toBeNull();
    expect(
      resolveMarketSelection(
        MARKET_FIXTURE,
        NATIVE_DUPLICATE.canonicalId,
        null,
        { allowVolumeFallback: false },
      ),
    ).toMatchObject({ market: NATIVE_DUPLICATE, source: "route" });
  });

  test("normalizes route params without inventing an identity", () => {
    expect(normalizeMarketRouteParam([" spot:7 ", "perp:0:4"])).toBe("spot:7");
    expect(normalizeMarketRouteParam(" ")).toBeNull();
  });

  test("becomes usable only after a current valid selection and navigation are ready", () => {
    expect(
      isUsableTradeSelection(MARKET_FIXTURE, HIP3_DUPLICATE.canonicalId, false),
    ).toBe(false);
    expect(isUsableTradeSelection(MARKET_FIXTURE, "perp:2:1", true)).toBe(
      false,
    );
    expect(
      isUsableTradeSelection(MARKET_FIXTURE, HIP3_DUPLICATE.canonicalId, true),
    ).toBe(true);
  });
});
