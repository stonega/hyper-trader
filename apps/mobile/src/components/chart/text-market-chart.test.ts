import { describe, expect, test } from "bun:test";
import type { Candle } from "@hyper-trader/hyperliquid/public";

import { summarizeCandles } from "./text-chart-model";

const candle = (close: string, high = close, low = close): Candle => ({
  openTime: 1,
  closeTime: 2,
  symbol: "BTC",
  interval: "15m",
  open: "10",
  close,
  high,
  low,
  volume: "1",
  tradeCount: 1,
});

describe("text chart alternative", () => {
  test("summarizes the visible series with an accessible OHLC sentence", () => {
    const summary = summarizeCandles([
      candle("10", "11", "9"),
      candle("12", "13", "10"),
    ]);
    expect(summary?.sparkline).toBe("▁█");
    expect(summary).toMatchObject({
      open: "10",
      high: "13",
      low: "9",
      close: "12",
    });
    expect(summary?.accessibilityLabel).toBe(
      "24 hour price chart. Open 10. High 13. Low 9. Close 12.",
    );
  });

  test("does not infer a path from malformed or missing points", () => {
    expect(summarizeCandles([])).toBeNull();
    expect(summarizeCandles([candle("not-a-number")])).toBeNull();
    expect(summarizeCandles([candle("1", "bad", "0")])).toBeNull();
    expect(summarizeCandles([candle("1", "2", "bad")])).toBeNull();
    expect(summarizeCandles([{ ...candle("1"), open: "bad" }])).toBeNull();
  });

  test("ranks mixed scales, equal values, and flat series deterministically", () => {
    expect(
      summarizeCandles([candle("1"), candle("1.0"), candle("2.00")])?.sparkline,
    ).toBe("▁▁█");
    expect(
      summarizeCandles([candle("7.00"), candle("7"), candle("7.0")])?.sparkline,
    ).toBe("▄▄▄");
  });

  test("preserves exact high-precision decimal source strings", () => {
    const summary = summarizeCandles([
      candle(
        "9007199254740993.00000001",
        "9007199254740993.00000002",
        "9007199254740993.00000000",
      ),
      candle(
        "9007199254740993.00000002",
        "9007199254740993.00000003",
        "9007199254740993.00000001",
      ),
    ]);
    expect(summary?.high).toBe("9007199254740993.00000003");
    expect(summary?.low).toBe("9007199254740993.00000000");
    expect(summary?.close).toBe("9007199254740993.00000002");
  });
});
