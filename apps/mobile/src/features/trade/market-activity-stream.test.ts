import { describe, expect, test } from "bun:test";
import type { L2Book, RecentTrade } from "@hyper-trader/hyperliquid/public";

import {
  bookBaselineFromStream,
  bookFromTradeStreamMessage,
  createTradeBookWire,
  createTradeRecentTradesWire,
  mergeRecentTrade,
  recentTradeFromStreamMessage,
  recentTradesBaselineFromStream,
} from "./market-activity-stream";

const rawBook = {
  coin: "BTC",
  time: 10,
  levels: [[{ px: "100", sz: "2", n: 1 }], [{ px: "101", sz: "3", n: 2 }]],
};

const book: L2Book = {
  coin: "BTC",
  time: 10,
  bids: [{ price: "100", size: "2", orderCount: 1 }],
  asks: [{ price: "101", size: "3", orderCount: 2 }],
};

const rawTrade = (tradeId: number, time: number) => ({
  coin: "BTC",
  side: "B",
  px: "100",
  sz: "1",
  time,
  hash: `hash-${tradeId}`,
  tid: tradeId,
});

const trade = (tradeId: number, time: number): RecentTrade => ({
  coin: "BTC",
  side: "B",
  price: "100",
  size: "1",
  time,
  hash: `hash-${tradeId}`,
  tradeId,
});

describe("Trade market-activity streams", () => {
  test("validates and decodes a selected order-book snapshot", () => {
    const wire = createTradeBookWire("book", "BTC");
    const [message] = wire.decode({ channel: "l2Book", data: rawBook });
    if (!message) throw new Error("Expected an order-book message.");

    expect(wire.subscription).toEqual({ type: "l2Book", coin: "BTC" });
    expect(bookFromTradeStreamMessage(message, "BTC")).toEqual(book);
    expect(bookBaselineFromStream(book, "BTC")).toBe(book);
    expect(() =>
      bookBaselineFromStream({ ...book, coin: "ETH" }, "BTC"),
    ).toThrow("baseline is invalid");
  });

  test("decodes individual trades and ignores another market", () => {
    const wire = createTradeRecentTradesWire("trades", "BTC");
    const [message] = wire.decode({
      channel: "trades",
      data: [rawTrade(1, 20), { ...rawTrade(2, 21), coin: "ETH" }],
    });
    if (!message) throw new Error("Expected a recent-trade message.");

    expect(recentTradeFromStreamMessage(message, "BTC")).toEqual(trade(1, 20));
    expect(recentTradesBaselineFromStream([trade(1, 20)], "BTC")).toEqual([
      trade(1, 20),
    ]);
  });

  test("deduplicates, orders, and bounds recent trades", () => {
    expect(
      mergeRecentTrade([trade(1, 10), trade(2, 20)], trade(3, 30), 2).map(
        ({ tradeId }) => tradeId,
      ),
    ).toEqual([3, 2]);
    expect(
      mergeRecentTrade([trade(1, 10)], { ...trade(1, 10), size: "2" }, 2),
    ).toEqual([{ ...trade(1, 10), size: "2" }]);
    expect(mergeRecentTrade([trade(1, 10)], trade(1, 11), 2)).toHaveLength(2);
  });
});
