export interface PricePrecisionInputs {
  readonly maxSignificantFigures: 5;
  readonly maxDecimalPlaces: number;
}

export function pricePrecisionForSizeDecimals(
  family: "perp" | "spot",
  sizeDecimals: number,
): PricePrecisionInputs | null {
  const maximum = family === "perp" ? 6 : 8;
  if (
    !Number.isInteger(sizeDecimals) ||
    sizeDecimals < 0 ||
    sizeDecimals > maximum
  ) {
    return null;
  }
  return {
    maxSignificantFigures: 5,
    maxDecimalPlaces: maximum - sizeDecimals,
  };
}
