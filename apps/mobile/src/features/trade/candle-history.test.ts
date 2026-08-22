import { describe, expect, test } from "bun:test";
import type { Candle } from "@hyper-trader/hyperliquid/public";

import {
  mergeTradeCandleHistory,
  previousCandlePageEnd,
} from "./candle-history";

const candle = (openTime: number, close: string): Candle => ({
  openTime,
  closeTime: openTime + 899_999,
  symbol: "BTC",
  interval: "15m",
  open: "10",
  close,
  high: close,
  low: "9",
  volume: "2",
  tradeCount: 1,
});

describe("trade candle history", () => {
  test("merges pages chronologically and lets the live head replace overlap", () => {
    expect(
      mergeTradeCandleHistory(
        [
          [candle(1, "10"), candle(2, "11")],
          [candle(2, "12"), candle(3, "13")],
        ],
        10,
      ),
    ).toEqual([candle(1, "10"), candle(2, "12"), candle(3, "13")]);
  });

  test("bounds resident candles and rejects mixed series", () => {
    expect(
      mergeTradeCandleHistory(
        [[candle(1, "10"), candle(2, "11"), candle(3, "12")]],
        2,
      ).map(({ openTime }) => openTime),
    ).toEqual([2, 3]);
    expect(() =>
      mergeTradeCandleHistory(
        [[candle(1, "10"), { ...candle(2, "11"), symbol: "ETH" }]],
        10,
      ),
    ).toThrow("different series");
  });

  test("derives the next exclusive history endpoint", () => {
    expect(previousCandlePageEnd([candle(10, "10")])).toBe(9);
    expect(previousCandlePageEnd([])).toBeUndefined();
    expect(previousCandlePageEnd([candle(0, "10")])).toBeUndefined();
  });
});
