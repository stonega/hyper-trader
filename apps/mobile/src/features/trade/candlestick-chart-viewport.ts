import type { CandlestickDatum } from "./candlestick-chart-model";

export type NumericRange = readonly [number, number];

export interface CandlestickChartDomains {
  readonly x: NumericRange;
  readonly y: NumericRange;
}

export interface CandlestickChartInteraction {
  readonly xWindow: NumericRange;
  readonly yOffset: number;
}

export interface CandlestickChartViewport {
  readonly x: [number, number];
  readonly y: [number, number];
}

export interface HorizontalBounds {
  readonly left: number;
  readonly right: number;
}

export const FULL_CANDLE_WINDOW = [0, 1] as const satisfies NumericRange;

const MAX_PRICE_PAN_RANGES = 4;
const MIN_FLAT_PRICE_SPAN = 1e-8;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizedWindow(window: NumericRange): NumericRange {
  const [rawStart, rawEnd] = window;
  if (
    !Number.isFinite(rawStart) ||
    !Number.isFinite(rawEnd) ||
    rawEnd <= rawStart
  ) {
    return FULL_CANDLE_WINDOW;
  }

  const start = clamp(rawStart, 0, 1);
  const end = clamp(rawEnd, start, 1);
  return end > start ? [start, end] : FULL_CANDLE_WINDOW;
}

export function buildCandlestickChartDomains(
  data: readonly CandlestickDatum[],
): CandlestickChartDomains | null {
  const first = data[0];
  const last = data.at(-1);
  if (!first || !last) return null;

  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (const candle of data) {
    minimum = Math.min(minimum, candle.low);
    maximum = Math.max(maximum, candle.high);
  }
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) return null;

  if (minimum === maximum) {
    const price = minimum;
    const halfSpan = Math.max(Math.abs(price) * 0.005, MIN_FLAT_PRICE_SPAN);
    minimum = price === 0 ? 0 : price - halfSpan;
    maximum = price === 0 ? halfSpan * 2 : price + halfSpan;
  }

  return {
    x: [first.timestamp, last.timestamp],
    y: [minimum, maximum],
  };
}

export function minimumCandleWindowSpan(
  candleCount: number,
  minimumVisibleCandles: number,
): number {
  if (
    !Number.isFinite(candleCount) ||
    !Number.isFinite(minimumVisibleCandles) ||
    candleCount <= 1 ||
    minimumVisibleCandles >= candleCount
  ) {
    return 1;
  }

  return clamp(
    (Math.max(2, minimumVisibleCandles) - 1) / (candleCount - 1),
    Number.EPSILON,
    1,
  );
}

export function horizontalFocalRatio(
  focalX: number,
  bounds: HorizontalBounds,
): number {
  const width = bounds.right - bounds.left;
  if (!Number.isFinite(focalX) || !Number.isFinite(width) || width <= 0) {
    return 0.5;
  }
  return clamp((focalX - bounds.left) / width, 0, 1);
}

export function zoomCandleWindow({
  startWindow,
  scale,
  startFocalRatio,
  currentFocalRatio,
  minimumSpan,
}: {
  readonly startWindow: NumericRange;
  readonly scale: number;
  readonly startFocalRatio: number;
  readonly currentFocalRatio: number;
  readonly minimumSpan: number;
}): NumericRange {
  const [start, end] = normalizedWindow(startWindow);
  if (!Number.isFinite(scale) || scale <= 0) return [start, end];

  const initialSpan = end - start;
  const nextSpan = clamp(
    initialSpan / scale,
    clamp(minimumSpan, Number.EPSILON, 1),
    1,
  );
  if (nextSpan >= 1 - Number.EPSILON) return FULL_CANDLE_WINDOW;

  const anchor = start + clamp(startFocalRatio, 0, 1) * initialSpan;
  const proposedStart = anchor - clamp(currentFocalRatio, 0, 1) * nextSpan;
  const nextStart = clamp(proposedStart, 0, 1 - nextSpan);
  return [nextStart, nextStart + nextSpan];
}

export function pricePanOffset({
  startOffset,
  translationY,
  plotHeight,
}: {
  readonly startOffset: number;
  readonly translationY: number;
  readonly plotHeight: number;
}): number {
  if (
    !Number.isFinite(startOffset) ||
    !Number.isFinite(translationY) ||
    !Number.isFinite(plotHeight) ||
    plotHeight <= 0
  ) {
    return Number.isFinite(startOffset) ? startOffset : 0;
  }

  return clamp(
    startOffset + translationY / plotHeight,
    -MAX_PRICE_PAN_RANGES,
    MAX_PRICE_PAN_RANGES,
  );
}

export function resolveCandlestickChartViewport(
  domains: CandlestickChartDomains,
  interaction: CandlestickChartInteraction,
): CandlestickChartViewport {
  const [windowStart, windowEnd] = normalizedWindow(interaction.xWindow);
  const [firstTimestamp, lastTimestamp] = domains.x;
  const timestampSpan = lastTimestamp - firstTimestamp;
  const [minimumPrice, maximumPrice] = domains.y;
  const priceSpan = maximumPrice - minimumPrice;
  const priceOffset = Number.isFinite(interaction.yOffset)
    ? interaction.yOffset * priceSpan
    : 0;

  return {
    x: [
      firstTimestamp + timestampSpan * windowStart,
      firstTimestamp + timestampSpan * windowEnd,
    ],
    y: [minimumPrice + priceOffset, maximumPrice + priceOffset],
  };
}
