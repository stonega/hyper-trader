import type { CandleInterval } from "@hyper-trader/hyperliquid/public";

const MINUTE_MS = 60 * 1_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export const TRADE_CHART_FRAME_HEIGHT = {
  compact: 210,
  standard: 260,
} as const;

const TRADE_AXIS_PRICE_FORMATTER = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 8,
  notation: "standard",
  useGrouping: true,
});

export const TRADE_CHART_INTERVALS = [
  {
    interval: "1m",
    intervalMs: MINUTE_MS,
    label: "1m",
    windowLabel: "90 minutes",
    windowMs: 90 * MINUTE_MS,
  },
  {
    interval: "15m",
    intervalMs: 15 * MINUTE_MS,
    label: "15m",
    windowLabel: "24 hours",
    windowMs: DAY_MS,
  },
  {
    interval: "1h",
    intervalMs: HOUR_MS,
    label: "1H",
    windowLabel: "4 days",
    windowMs: 4 * DAY_MS,
  },
  {
    interval: "4h",
    intervalMs: 4 * HOUR_MS,
    label: "4H",
    windowLabel: "16 days",
    windowMs: 16 * DAY_MS,
  },
  {
    interval: "1d",
    intervalMs: DAY_MS,
    label: "1D",
    windowLabel: "3 months",
    windowMs: 90 * DAY_MS,
  },
] as const satisfies readonly {
  readonly interval: CandleInterval;
  readonly intervalMs: number;
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
export const TRADE_VOLUME_Y_KEYS = [
  "positiveVolume",
  "negativeVolume",
  "neutralVolume",
] as const;

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
  const spec = tradeChartSpec(interval);
  return Math.ceil(spec.windowMs / spec.intervalMs) + 1;
}

export function formatTradeChartAxisPrice(value: number): string {
  return Number.isFinite(value)
    ? TRADE_AXIS_PRICE_FORMATTER.format(value)
    : "—";
}
