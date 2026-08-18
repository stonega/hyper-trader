import { HyperliquidValidationError } from "../errors";
import { type DecimalString, parseDecimalString } from "../numbers/decimal";
import { parseMarketContext } from "./catalog";
import type { MarketContext } from "./types";

export interface MidPrice {
  readonly symbol: string;
  readonly price: DecimalString;
}

export interface Candle {
  readonly openTime: number;
  readonly closeTime: number;
  readonly symbol: string;
  readonly interval: string;
  readonly open: DecimalString;
  readonly close: DecimalString;
  readonly high: DecimalString;
  readonly low: DecimalString;
  readonly volume: DecimalString;
  readonly tradeCount: number;
}

export interface L2Level {
  readonly price: DecimalString;
  readonly size: DecimalString;
  readonly orderCount: number;
}

export interface L2Book {
  readonly coin: string;
  readonly time: number;
  readonly bids: readonly L2Level[];
  readonly asks: readonly L2Level[];
}

export interface RecentTrade {
  readonly coin: string;
  readonly side: string;
  readonly price: DecimalString;
  readonly size: DecimalString;
  readonly time: number;
  readonly hash: string;
  readonly tradeId: number;
}

export interface FundingRecord {
  readonly coin: string;
  readonly fundingRate: DecimalString;
  readonly premium: DecimalString;
  readonly time: number;
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HyperliquidValidationError(path, "expected an object");
  }
  return value as Record<string, unknown>;
}

function list(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new HyperliquidValidationError(path, "expected an array");
  }
  return value;
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new HyperliquidValidationError(path, "expected a non-empty string");
  }
  return value;
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new HyperliquidValidationError(
      path,
      "expected a non-negative integer",
    );
  }
  return value as number;
}

export function parseAllMids(payload: unknown): MidPrice[] {
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    throw new TypeError("Hyperliquid allMids response must be an object.");
  }

  return Object.entries(payload)
    .map(([symbol, price]) => {
      try {
        return {
          symbol,
          price: parseDecimalString(price, `allMids.${symbol}`),
        };
      } catch {
        throw new TypeError(
          `Hyperliquid returned an invalid mid price for ${symbol}.`,
        );
      }
    })
    .sort((left, right) => left.symbol.localeCompare(right.symbol));
}

export function parseCandles(payload: unknown): Candle[] {
  return list(payload, "candleSnapshot").map((value, index) => {
    const candle = object(value, `candleSnapshot[${index}]`);
    return {
      openTime: nonNegativeInteger(candle.t, `candleSnapshot[${index}].t`),
      closeTime: nonNegativeInteger(candle.T, `candleSnapshot[${index}].T`),
      symbol: text(candle.s, `candleSnapshot[${index}].s`),
      interval: text(candle.i, `candleSnapshot[${index}].i`),
      open: parseDecimalString(candle.o, `candleSnapshot[${index}].o`),
      close: parseDecimalString(candle.c, `candleSnapshot[${index}].c`),
      high: parseDecimalString(candle.h, `candleSnapshot[${index}].h`),
      low: parseDecimalString(candle.l, `candleSnapshot[${index}].l`),
      volume: parseDecimalString(candle.v, `candleSnapshot[${index}].v`),
      tradeCount: nonNegativeInteger(candle.n, `candleSnapshot[${index}].n`),
    };
  });
}

function parseL2Levels(value: unknown, path: string): L2Level[] {
  return list(value, path).map((rawLevel, index) => {
    const level = object(rawLevel, `${path}[${index}]`);
    return {
      price: parseDecimalString(level.px, `${path}[${index}].px`),
      size: parseDecimalString(level.sz, `${path}[${index}].sz`),
      orderCount: nonNegativeInteger(level.n, `${path}[${index}].n`),
    };
  });
}

export function parseL2Book(payload: unknown): L2Book {
  const book = object(payload, "l2Book");
  const levels = list(book.levels, "l2Book.levels");
  if (levels.length !== 2) {
    throw new HyperliquidValidationError(
      "l2Book.levels",
      "expected bid and ask levels",
    );
  }
  return {
    coin: text(book.coin, "l2Book.coin"),
    time: nonNegativeInteger(book.time, "l2Book.time"),
    bids: parseL2Levels(levels[0], "l2Book.levels[0]"),
    asks: parseL2Levels(levels[1], "l2Book.levels[1]"),
  };
}

export function parseRecentTrades(payload: unknown): RecentTrade[] {
  return list(payload, "recentTrades").map((value, index) => {
    const trade = object(value, `recentTrades[${index}]`);
    return {
      coin: text(trade.coin, `recentTrades[${index}].coin`),
      side: text(trade.side, `recentTrades[${index}].side`),
      price: parseDecimalString(trade.px, `recentTrades[${index}].px`),
      size: parseDecimalString(trade.sz, `recentTrades[${index}].sz`),
      time: nonNegativeInteger(trade.time, `recentTrades[${index}].time`),
      hash: text(trade.hash, `recentTrades[${index}].hash`),
      tradeId: nonNegativeInteger(trade.tid, `recentTrades[${index}].tid`),
    };
  });
}

export function parseFundingHistory(payload: unknown): FundingRecord[] {
  return list(payload, "fundingHistory").map((value, index) => {
    const funding = object(value, `fundingHistory[${index}]`);
    return {
      coin: text(funding.coin, `fundingHistory[${index}].coin`),
      fundingRate: parseDecimalString(
        funding.fundingRate,
        `fundingHistory[${index}].fundingRate`,
      ),
      premium: parseDecimalString(
        funding.premium,
        `fundingHistory[${index}].premium`,
      ),
      time: nonNegativeInteger(funding.time, `fundingHistory[${index}].time`),
    };
  });
}

export function parseAssetContexts(
  payload: unknown,
  path: string,
): MarketContext[] {
  const tuple = list(payload, path);
  if (tuple.length !== 2) {
    throw new HyperliquidValidationError(
      path,
      "expected metadata and contexts",
    );
  }
  return list(tuple[1], `${path}[1]`).map((value, index) =>
    parseMarketContext(value, `${path}[1][${index}]`),
  );
}
