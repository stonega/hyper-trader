import type { CandleInterval } from "@hyper-trader/hyperliquid/public";

const HOUR_MS = 60 * 60 * 1_000;
const DAY_MS = 24 * HOUR_MS;

export const TRADE_CHART_INTERVALS = [
  {
    interval: "15m",
    label: "15m",
    windowLabel: "24 hours",
    windowMs: DAY_MS,
  },
  {
    interval: "1h",
    label: "1H",
    windowLabel: "4 days",
    windowMs: 4 * DAY_MS,
  },
  {
    interval: "4h",
    label: "4H",
    windowLabel: "16 days",
    windowMs: 16 * DAY_MS,
  },
  {
    interval: "1d",
    label: "1D",
    windowLabel: "3 months",
    windowMs: 90 * DAY_MS,
  },
] as const satisfies readonly {
  readonly interval: CandleInterval;
  readonly label: string;
  readonly windowLabel: string;
  readonly windowMs: number;
}[];

export type TradeChartInterval =
  (typeof TRADE_CHART_INTERVALS)[number]["interval"];

// Victory builds point arrays only for the keys assigned to an axis. A
// candlestick needs all four arrays even though low/high alone define its
// numeric domain.
export const TRADE_CANDLE_Y_KEYS = ["open", "high", "low", "close"] as const;

export function tradeChartSpec(interval: TradeChartInterval) {
  const spec = TRADE_CHART_INTERVALS.find(
    (candidate) => candidate.interval === interval,
  );
  if (spec === undefined) {
    throw new Error(`Unsupported Trade chart interval: ${interval}`);
  }
  return spec;
}

export function tradeCandleRange(
  interval: TradeChartInterval,
  endTime: number,
): { readonly startTime: number; readonly endTime: number } {
  if (!Number.isSafeInteger(endTime) || endTime < 0) {
    throw new Error("Trade candle range requires a valid epoch time.");
  }
  return {
    startTime: Math.max(0, endTime - tradeChartSpec(interval).windowMs),
    endTime,
  };
}

export function tradeChartCandleCapacity(interval: TradeChartInterval): number {
  const intervalMs =
    interval === "15m"
      ? 15 * 60 * 1_000
      : interval === "1h"
        ? HOUR_MS
        : interval === "4h"
          ? 4 * HOUR_MS
          : DAY_MS;
  return Math.ceil(tradeChartSpec(interval).windowMs / intervalMs) + 1;
}
