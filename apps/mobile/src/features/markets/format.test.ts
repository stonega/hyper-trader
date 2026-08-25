import { describe, expect, test } from "bun:test";

import { NATIVE_DUPLICATE, SPOT_DUPLICATE } from "./fixture";
import { formatFundingRate, formatMarketPrice } from "./format";

describe("market formatting", () => {
  test("uses validated market precision instead of magnitude buckets", () => {
    expect(
      formatMarketPrice({
        ...NATIVE_DUPLICATE,
        markPx: "4000.5",
        pricePrecision: {
          maxSignificantFigures: 5,
          maxDecimalPlaces: 1,
        },
      }),
    ).toBe("$4,000.5");
    expect(formatMarketPrice({ ...NATIVE_DUPLICATE, markPx: "12.345" })).toBe(
      "$12.345",
    );
  });

  test("keeps valid small-price decimals for spot markets", () => {
    expect(
      formatMarketPrice({
        ...SPOT_DUPLICATE,
        markPx: "0.00001234",
        pricePrecision: {
          maxSignificantFigures: 5,
          maxDecimalPlaces: 8,
        },
      }),
    ).toBe("$0.00001234");
  });

  test("presents Hyperliquid funding decimals as precise percentages", () => {
    expect(formatFundingRate("0.0000125")).toBe("0.00125%");
    expect(formatFundingRate("-0.0000125")).toBe("-0.00125%");
    expect(formatFundingRate("0.0")).toBe("0.0000%");
  });

  test("does not round small non-zero mainnet funding rates to zero", () => {
    expect(formatFundingRate("0.0000000001")).toBe("0.00000001%");
  });

  test("keeps unavailable and malformed values distinguishable", () => {
    expect(formatFundingRate(undefined)).toBe("Unavailable");
    expect(formatFundingRate(null)).toBe("Unavailable");
    expect(formatFundingRate("invalid")).toBe("invalid");
  });
});
