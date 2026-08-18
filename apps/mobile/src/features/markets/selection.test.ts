import { describe, expect, test } from "bun:test";

import { HIP3_DUPLICATE, MARKET_FIXTURE, NATIVE_DUPLICATE } from "./fixture";
import {
  isUsableTradeSelection,
  normalizeMarketRouteParam,
  resolveMarketSelection,
} from "./selection";

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

  test("replaces a delisted or prior-invalid last market with dynamic volume fallback", () => {
    expect(
      resolveMarketSelection(MARKET_FIXTURE, null, "perp:2:1"),
    ).toMatchObject({ market: HIP3_DUPLICATE, source: "volume_fallback" });
    expect(resolveMarketSelection([], null, "perp:0:0")).toBeNull();
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
