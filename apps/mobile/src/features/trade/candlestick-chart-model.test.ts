import { describe, expect, test } from "bun:test";
import type { Candle } from "@hyper-trader/hyperliquid/public";

import { buildCandlestickChartModel } from "./candlestick-chart-model";
import {
  TRADE_CANDLE_Y_KEYS,
  tradeCandleRange,
  tradeChartCandleCapacity,
  tradeChartSpec,
} from "./market-chart-config";

const candle = (
  openTime: number,
  close: string,
  high = close,
  low = close,
): Candle => ({
  openTime,
  closeTime: openTime + 1,
  symbol: "BTC",
  interval: "15m",
  open: "10",
  close,
  high,
  low,
  volume: "1",
  tradeCount: 1,
});

describe("Trade candlestick chart model", () => {
  test("builds numeric geometry with an exact accessible OHLC summary", () => {
    const model = buildCandlestickChartModel(
      [candle(1, "10", "11", "9"), candle(2, "12", "13", "10")],
      "24 hours",
    );

    expect(model?.data).toEqual([
      { timestamp: 1, open: 10, high: 11, low: 9, close: 10 },
      { timestamp: 2, open: 10, high: 13, low: 10, close: 12 },
    ]);
    expect(model?.summary).toMatchObject({
      sparkline: "▁█",
      open: "10",
      high: "13",
      low: "9",
      close: "12",
    });
    expect(model?.summary.accessibilityLabel).toBe(
      "24 hours candlestick chart with 2 candles. Open 10. High 13. Low 9. Close 12.",
    );
  });

  test("does not infer geometry from missing, malformed, or unordered rows", () => {
    expect(buildCandlestickChartModel([], "24 hours")).toBeNull();
    expect(
      buildCandlestickChartModel([candle(1, "not-a-number")], "24 hours"),
    ).toBeNull();
    expect(
      buildCandlestickChartModel(
        [candle(2, "11", "12", "9"), candle(1, "12", "13", "10")],
        "24 hours",
      ),
    ).toBeNull();
    expect(
      buildCandlestickChartModel([candle(1, "11", "10", "9")], "24 hours"),
    ).toBeNull();
  });

  test("preserves exact source strings in the text alternative", () => {
    const model = buildCandlestickChartModel(
      [
        {
          ...candle(
            1,
            "9007199254740993.00000001",
            "9007199254740993.00000002",
            "9007199254740993.00000000",
          ),
          open: "9007199254740993.00000001",
        },
        {
          ...candle(
            2,
            "9007199254740993.00000002",
            "9007199254740993.00000003",
            "9007199254740993.00000001",
          ),
          open: "9007199254740993.00000001",
        },
      ],
      "24 hours",
    );

    expect(model?.summary.high).toBe("9007199254740993.00000003");
    expect(model?.summary.low).toBe("9007199254740993.00000000");
    expect(model?.summary.close).toBe("9007199254740993.00000002");
  });

  test("maps each interval to a bounded fixed candle window", () => {
    const endTime = 100 * 24 * 60 * 60 * 1_000;
    expect(tradeChartSpec("15m").windowLabel).toBe("24 hours");
    expect(tradeCandleRange("15m", endTime)).toEqual({
      startTime: endTime - 24 * 60 * 60 * 1_000,
      endTime,
    });
    expect(tradeCandleRange("1d", endTime).startTime).toBe(
      endTime - 90 * 24 * 60 * 60 * 1_000,
    );
    expect(tradeChartCandleCapacity("15m")).toBe(97);
    expect(tradeChartCandleCapacity("1d")).toBe(91);
    expect(() => tradeCandleRange("1h", Number.NaN)).toThrow(
      "valid epoch time",
    );
  });

  test("assigns every OHLC series to the Victory candlestick axis", () => {
    expect(TRADE_CANDLE_Y_KEYS).toEqual(["open", "high", "low", "close"]);
  });
});
