import { describe, expect, test } from "bun:test";
import type { Candle } from "@hyper-trader/hyperliquid/public";

import {
  candleBaselineFromStream,
  candleFromTradeStreamMessage,
  createTradeCandleWire,
  mergeTradeCandle,
  tradeCandleStreamKey,
} from "./candle-stream";

const rawCandle = (openTime: number, close: string, tradeCount = 1) => ({
  t: openTime,
  T: openTime + 899_999,
  s: "BTC",
  i: "15m",
  o: "10",
  c: close,
  h: close,
  l: "9",
  v: "2",
  n: tradeCount,
});

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

describe("Trade candle stream", () => {
  test("decodes exact candle updates and changes identity as the open candle advances", () => {
    const key = tradeCandleStreamKey("testnet", "perp:BTC", "15m");
    const wire = createTradeCandleWire(key, {
      coin: "BTC",
      interval: "15m",
    });
    const first = wire.decode({ channel: "candle", data: rawCandle(1, "11") });
    const update = wire.decode({
      channel: "candle",
      data: rawCandle(1, "12", 2),
    });

    expect(wire.subscription).toEqual({
      type: "candle",
      coin: "BTC",
      interval: "15m",
    });
    expect(first).toHaveLength(1);
    expect(first[0]?.stableId).not.toBe(update[0]?.stableId);
    const firstMessage = first[0];
    if (!firstMessage) throw new Error("Expected a decoded candle message.");
    expect(
      candleFromTradeStreamMessage(firstMessage, {
        coin: "BTC",
        interval: "15m",
      }).close,
    ).toBe("11");
  });

  test("ignores other feeds and rejects malformed data for the selected series", () => {
    const wire = createTradeCandleWire("candles", {
      coin: "BTC",
      interval: "15m",
    });
    expect(
      wire.decode({
        channel: "candle",
        data: { ...rawCandle(1, "11"), s: "ETH" },
      }),
    ).toEqual([]);
    expect(wire.decode({ channel: "subscriptionResponse", data: {} })).toEqual(
      [],
    );
    expect(() =>
      wire.decode({
        channel: "candle",
        data: { ...rawCandle(1, "11"), c: null },
      }),
    ).toThrow("expected a decimal string");
  });

  test("replaces an active candle, appends a new candle, and bounds the window", () => {
    expect(mergeTradeCandle([candle(1, "11")], candle(1, "12"), 2)).toEqual([
      candle(1, "12"),
    ]);
    expect(
      mergeTradeCandle(
        [candle(1, "11"), candle(2, "12")],
        candle(3, "13"),
        2,
      ).map(({ openTime }) => openTime),
    ).toEqual([2, 3]);
    expect(() =>
      mergeTradeCandle(
        [candle(1, "11")],
        { ...candle(2, "12"), symbol: "ETH" },
        2,
      ),
    ).toThrow("different series");
  });

  test("accepts only normalized REST baselines for the selected series", () => {
    const baseline = [candle(1, "11")];
    expect(
      candleBaselineFromStream(baseline, { coin: "BTC", interval: "15m" }),
    ).toBe(baseline);
    expect(() =>
      candleBaselineFromStream([{ ...candle(1, "11"), interval: "1h" }], {
        coin: "BTC",
        interval: "15m",
      }),
    ).toThrow("baseline is invalid");
  });
});
