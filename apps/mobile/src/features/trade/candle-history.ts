import type { Candle } from "@hyper-trader/hyperliquid/public";

export function previousCandlePageEnd(
  page: readonly Candle[],
): number | undefined {
  const first = page[0];
  if (!first || !Number.isSafeInteger(first.openTime) || first.openTime <= 0) {
    return undefined;
  }
  return first.openTime - 1;
}

export function mergeTradeCandleHistory(
  series: readonly (readonly Candle[])[],
  capacity: number,
): Candle[] {
  if (!Number.isSafeInteger(capacity) || capacity < 1) {
    throw new RangeError("The candle history capacity must be positive.");
  }
  let symbol: string | null = null;
  let interval: string | null = null;
  const byOpenTime = new Map<number, Candle>();
  for (const candles of series) {
    for (const candle of candles) {
      symbol ??= candle.symbol;
      interval ??= candle.interval;
      if (candle.symbol !== symbol || candle.interval !== interval) {
        throw new TypeError("Candle history contains a different series.");
      }
      byOpenTime.set(candle.openTime, candle);
    }
  }
  return [...byOpenTime.values()]
    .sort((left, right) => left.openTime - right.openTime)
    .slice(-capacity);
}
