import { describe, expect, test } from "bun:test";

import {
  positionTpslPercentageFromPrice,
  positionTpslPriceFromPercentage,
} from "./position-tpsl-percentage";

const precision = {
  maxSignificantFigures: 5 as const,
  maxDecimalPlaces: 4,
};

describe("position TP/SL percentage inputs", () => {
  test("derives long gain and loss trigger prices from entry", () => {
    expect(
      positionTpslPriceFromPercentage({
        entryPrice: "10",
        kind: "take_profit",
        percentage: "25",
        precision,
        side: "long",
      }),
    ).toBe("12.5");
    expect(
      positionTpslPriceFromPercentage({
        entryPrice: "10",
        kind: "stop_loss",
        percentage: "12.5",
        precision,
        side: "long",
      }),
    ).toBe("8.75");
    expect(
      positionTpslPriceFromPercentage({
        entryPrice: "10",
        kind: "take_profit",
        percentage: ".5",
        precision,
        side: "long",
      }),
    ).toBe("10.05");
  });

  test("reverses percentage price direction for a short position", () => {
    expect(
      positionTpslPriceFromPercentage({
        entryPrice: "10",
        kind: "take_profit",
        percentage: "25",
        precision,
        side: "short",
      }),
    ).toBe("7.5");
    expect(
      positionTpslPriceFromPercentage({
        entryPrice: "10",
        kind: "stop_loss",
        percentage: "12.5",
        precision,
        side: "short",
      }),
    ).toBe("11.25");
  });

  test("derives concise gain and loss percentages from trigger prices", () => {
    expect(
      positionTpslPercentageFromPrice({
        entryPrice: "10",
        kind: "take_profit",
        side: "long",
        triggerPrice: "12",
      }),
    ).toBe("20");
    expect(
      positionTpslPercentageFromPrice({
        entryPrice: "10",
        kind: "stop_loss",
        side: "long",
        triggerPrice: "9",
      }),
    ).toBe("10");
  });

  test("rejects zero moves and percentages that produce non-positive prices", () => {
    expect(
      positionTpslPriceFromPercentage({
        entryPrice: "10",
        kind: "stop_loss",
        percentage: "100",
        precision,
        side: "long",
      }),
    ).toBeNull();
    expect(
      positionTpslPriceFromPercentage({
        entryPrice: "100000",
        kind: "take_profit",
        percentage: "0.00001",
        precision: { maxSignificantFigures: 5, maxDecimalPlaces: 2 },
        side: "long",
      }),
    ).toBeNull();
    expect(
      positionTpslPercentageFromPrice({
        entryPrice: "10",
        kind: "take_profit",
        side: "long",
        triggerPrice: "10",
      }),
    ).toBeNull();
  });
});
