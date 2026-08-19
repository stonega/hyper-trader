import {
  type Candle,
  type HyperliquidNetwork,
  type PublicWebSocketEnvelope,
  parseCandles,
} from "@hyper-trader/hyperliquid/public";

import type { ManagedStreamMessage } from "../../core/streams/manager";
import type { DeclarativeStreamWire } from "../../core/streams/native-websocket";
import type { TradeChartInterval } from "./market-chart-config";

interface TradeCandleSeries {
  readonly coin: string;
  readonly interval: TradeChartInterval;
}

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function candleStableId(candle: Candle): string {
  return JSON.stringify([
    candle.openTime,
    candle.closeTime,
    candle.symbol,
    candle.interval,
    candle.open,
    candle.close,
    candle.high,
    candle.low,
    candle.volume,
    candle.tradeCount,
  ]);
}

function isNormalizedCandle(
  value: unknown,
  expected: TradeCandleSeries,
): value is Candle {
  const candle = record(value);
  return (
    candle !== null &&
    Number.isSafeInteger(candle.openTime) &&
    Number.isSafeInteger(candle.closeTime) &&
    candle.symbol === expected.coin &&
    candle.interval === expected.interval &&
    typeof candle.open === "string" &&
    typeof candle.close === "string" &&
    typeof candle.high === "string" &&
    typeof candle.low === "string" &&
    typeof candle.volume === "string" &&
    Number.isSafeInteger(candle.tradeCount)
  );
}

export function tradeCandleStreamKey(
  network: HyperliquidNetwork,
  canonicalId: string,
  interval: TradeChartInterval,
): string {
  return JSON.stringify(["trade-candles", network, canonicalId, interval]);
}

export function createTradeCandleWire(
  key: string,
  expected: TradeCandleSeries,
): DeclarativeStreamWire {
  return {
    key,
    subscription: {
      type: "candle",
      coin: expected.coin,
      interval: expected.interval,
    },
    decode(envelope: PublicWebSocketEnvelope) {
      if (envelope.channel !== "candle") return [];
      const source = record(envelope.data);
      if (source === null) {
        parseCandles([envelope.data], expected);
        return [];
      }
      if (typeof source.s !== "string" || typeof source.i !== "string") {
        parseCandles([envelope.data], expected);
        return [];
      }
      if (source.s !== expected.coin || source.i !== expected.interval) {
        return [];
      }
      const candle = parseCandles([envelope.data], expected)[0];
      if (!candle) return [];
      return [
        {
          key,
          stableId: candleStableId(candle),
          data: envelope.data,
        },
      ];
    },
  };
}

export function candleFromTradeStreamMessage(
  message: ManagedStreamMessage,
  expected: TradeCandleSeries,
): Candle {
  const candle = parseCandles([message.data], expected)[0];
  if (!candle) {
    throw new TypeError("The candle stream message contained no candle.");
  }
  return candle;
}

export function candleBaselineFromStream(
  value: unknown,
  expected: TradeCandleSeries,
): readonly Candle[] {
  if (
    !Array.isArray(value) ||
    !value.every((candle) => isNormalizedCandle(candle, expected))
  ) {
    throw new TypeError("The candle stream baseline is invalid.");
  }
  return value;
}

export function mergeTradeCandle(
  current: readonly Candle[] | undefined,
  incoming: Candle,
  capacity: number,
): Candle[] {
  if (!Number.isSafeInteger(capacity) || capacity < 1) {
    throw new RangeError(
      "The candle cache capacity must be a positive integer.",
    );
  }
  const candles = current ?? [];
  for (const candle of candles) {
    if (
      candle.symbol !== incoming.symbol ||
      candle.interval !== incoming.interval
    ) {
      throw new TypeError("The candle cache contains a different series.");
    }
  }
  const byOpenTime = new Map<number, Candle>();
  for (const candle of candles) byOpenTime.set(candle.openTime, candle);
  byOpenTime.set(incoming.openTime, incoming);
  return [...byOpenTime.values()]
    .sort((left, right) => left.openTime - right.openTime)
    .slice(-capacity);
}
