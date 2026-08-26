import { describe, expect, test } from "bun:test";

import { roundedPriceInputValue } from "./aggressive-order-price";

const PERP_PRICE_PRECISION = {
  maxSignificantFigures: 5,
  maxDecimalPlaces: 4,
} as const;

describe("editable midpoint price", () => {
  test("rounds the midpoint to the nearest valid significant figure", () => {
    expect(
      roundedPriceInputValue({
        price: "79112.5",
        precision: PERP_PRICE_PRECISION,
      }),
    ).toBe("79113");
    expect(
      roundedPriceInputValue({
        price: "79112.4",
        precision: PERP_PRICE_PRECISION,
      }),
    ).toBe("79112");
  });

  test("uses decimal-place and significant-figure limits for small prices", () => {
    expect(
      roundedPriceInputValue({
        price: "0.00123456",
        precision: { maxSignificantFigures: 5, maxDecimalPlaces: 6 },
      }),
    ).toBe("0.001235");
  });

  test("stays unavailable without a positive validated midpoint", () => {
    expect(
      roundedPriceInputValue({
        price: null,
        precision: PERP_PRICE_PRECISION,
      }),
    ).toBeNull();
    expect(
      roundedPriceInputValue({
        price: "0",
        precision: PERP_PRICE_PRECISION,
      }),
    ).toBeNull();
  });
});
