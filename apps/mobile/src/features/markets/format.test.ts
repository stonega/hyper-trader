import { describe, expect, test } from "bun:test";

import { NATIVE_DUPLICATE, SPOT_DUPLICATE } from "./fixture";
import { formatMarketPrice } from "./format";

describe("market price formatting", () => {
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
});
