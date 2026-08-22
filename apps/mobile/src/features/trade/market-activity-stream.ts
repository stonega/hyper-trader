import {
  type HyperliquidNetwork,
  type L2Book,
  type PublicWebSocketEnvelope,
  parseL2Book,
  parseRecentTrades,
  type RecentTrade,
} from "@hyper-trader/hyperliquid/public";

import type { ManagedStreamMessage } from "../../core/streams/manager";
import type { DeclarativeStreamWire } from "../../core/streams/native-websocket";

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function isNormalizedBook(value: unknown, coin: string): value is L2Book {
  const book = record(value);
  return (
    book?.coin === coin &&
    Number.isSafeInteger(book.time) &&
    Array.isArray(book.bids) &&
    Array.isArray(book.asks)
  );
}

function isNormalizedTrade(value: unknown, coin: string): value is RecentTrade {
  const trade = record(value);
  return (
    trade?.coin === coin &&
    typeof trade.side === "string" &&
    typeof trade.price === "string" &&
    typeof trade.size === "string" &&
    Number.isSafeInteger(trade.time) &&
    typeof trade.hash === "string" &&
    Number.isSafeInteger(trade.tradeId)
  );
}

function bookStableId(book: L2Book): string {
  return JSON.stringify([book.coin, book.time, book.bids, book.asks]);
}

function tradeStableId(trade: RecentTrade): string {
  return JSON.stringify([
    trade.coin,
    trade.tradeId,
    trade.time,
    trade.hash,
    trade.side,
    trade.price,
    trade.size,
  ]);
}

export function tradeBookStreamKey(
  network: HyperliquidNetwork,
  canonicalId: string,
): string {
  return JSON.stringify(["trade-book", network, canonicalId]);
}

export function tradeRecentTradesStreamKey(
  network: HyperliquidNetwork,
  canonicalId: string,
): string {
  return JSON.stringify(["trade-recent-trades", network, canonicalId]);
}

export function createTradeBookWire(
  key: string,
  coin: string,
): DeclarativeStreamWire {
  return {
    key,
    subscription: { type: "l2Book", coin },
    decode(envelope: PublicWebSocketEnvelope) {
      if (envelope.channel !== "l2Book") return [];
      const book = parseL2Book(envelope.data);
      if (book.coin !== coin) return [];
      return [{ key, stableId: bookStableId(book), data: envelope.data }];
    },
  };
}

export function bookFromTradeStreamMessage(
  message: ManagedStreamMessage,
  coin: string,
): L2Book {
  const book = parseL2Book(message.data);
  if (book.coin !== coin) {
    throw new TypeError("The order-book stream message changed market.");
  }
  return book;
}

export function bookBaselineFromStream(value: unknown, coin: string): L2Book {
  if (!isNormalizedBook(value, coin)) {
    throw new TypeError("The order-book stream baseline is invalid.");
  }
  return value;
}

export function createTradeRecentTradesWire(
  key: string,
  coin: string,
): DeclarativeStreamWire {
  return {
    key,
    subscription: { type: "trades", coin },
    decode(envelope: PublicWebSocketEnvelope) {
      if (envelope.channel !== "trades") return [];
      if (!Array.isArray(envelope.data)) {
        parseRecentTrades(envelope.data);
        return [];
      }
      const rawTrades = envelope.data;
      const parsed = parseRecentTrades(rawTrades);
      return parsed.flatMap((trade, index) =>
        trade.coin === coin
          ? [
              {
                key,
                stableId: tradeStableId(trade),
                data: rawTrades[index],
              },
            ]
          : [],
      );
    },
  };
}

export function recentTradeFromStreamMessage(
  message: ManagedStreamMessage,
  coin: string,
): RecentTrade {
  const trade = parseRecentTrades([message.data])[0];
  if (!trade || trade.coin !== coin) {
    throw new TypeError("The recent-trade stream message changed market.");
  }
  return trade;
}

export function recentTradesBaselineFromStream(
  value: unknown,
  coin: string,
): readonly RecentTrade[] {
  if (
    !Array.isArray(value) ||
    !value.every((trade) => isNormalizedTrade(trade, coin))
  ) {
    throw new TypeError("The recent-trade stream baseline is invalid.");
  }
  return value;
}

export function mergeRecentTrade(
  current: readonly RecentTrade[] | undefined,
  incoming: RecentTrade,
  capacity: number,
): RecentTrade[] {
  if (!Number.isSafeInteger(capacity) || capacity < 1) {
    throw new RangeError("The recent-trade capacity must be positive.");
  }
  const byId = new Map<string, RecentTrade>();
  for (const trade of current ?? []) {
    if (trade.coin !== incoming.coin) {
      throw new TypeError("The recent-trade cache contains another market.");
    }
    byId.set(`${trade.time}:${trade.coin}:${trade.tradeId}`, trade);
  }
  byId.set(`${incoming.time}:${incoming.coin}:${incoming.tradeId}`, incoming);
  return [...byId.values()]
    .sort(
      (left, right) => right.time - left.time || right.tradeId - left.tradeId,
    )
    .slice(0, capacity);
}
