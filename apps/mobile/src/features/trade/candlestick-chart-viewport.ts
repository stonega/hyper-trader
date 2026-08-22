import type { CandlestickDatum } from "./candlestick-chart-model";

export type NumericRange = readonly [number, number];

export interface CandlestickChartDomains {
  readonly x: NumericRange;
  readonly y: NumericRange;
}

export interface CandlestickChartInteraction {
  readonly xRange: NumericRange;
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

const MAX_PRICE_PAN_RANGES = 4;
const MIN_FLAT_PRICE_SPAN = 1e-8;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function boundedRange(range: NumericRange, bounds: NumericRange): NumericRange {
  const [domainStart, domainEnd] = bounds;
  const [rawStart, rawEnd] = range;
  if (
    !Number.isFinite(domainStart) ||
    !Number.isFinite(domainEnd) ||
    domainEnd < domainStart ||
    !Number.isFinite(rawStart) ||
    !Number.isFinite(rawEnd) ||
    rawEnd <= rawStart
  ) {
    return bounds;
  }
  const domainSpan = domainEnd - domainStart;
  if (domainSpan <= 0) return bounds;
  const span = clamp(rawEnd - rawStart, Number.EPSILON, domainSpan);
  const start = clamp(rawStart, domainStart, domainEnd - span);
  return [start, start + span];
}

export function buildCandlestickChartDomains(
  data: readonly CandlestickDatum[],
): CandlestickChartDomains | null {
  const first = data[0];
  const last = data.at(-1);
  if (!first || !last) return null;

  const y = buildCandlestickPriceDomain(data, [
    first.timestamp,
    last.timestamp,
  ]);
  if (y === null) return null;

  return {
    x: [first.timestamp, last.timestamp],
    y,
  };
}

export function buildCandlestickPriceDomain(
  data: readonly CandlestickDatum[],
  xRange: NumericRange,
): NumericRange | null {
  const [start, end] = xRange;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return null;
  }

  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (const candle of data) {
    if (candle.timestamp < start || candle.timestamp > end) continue;
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

  return [minimum, maximum];
}

export function minimumCandleRangeSpan(
  data: readonly CandlestickDatum[],
  minimumVisibleCandles: number,
): number {
  const candleCount = data.length;
  if (
    !Number.isFinite(minimumVisibleCandles) ||
    candleCount <= 1 ||
    minimumVisibleCandles >= candleCount
  ) {
    const first = data[0];
    const last = data.at(-1);
    return first && last ? Math.max(1, last.timestamp - first.timestamp) : 1;
  }
  const first = data[0];
  const minimumLast = data[Math.max(1, Math.floor(minimumVisibleCandles)) - 1];
  if (!first || !minimumLast) return 1;
  return Math.max(1, minimumLast.timestamp - first.timestamp);
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

export function zoomCandleRange({
  startRange,
  bounds,
  scale,
  startFocalRatio,
  currentFocalRatio,
  minimumSpan,
}: {
  readonly startRange: NumericRange;
  readonly bounds: NumericRange;
  readonly scale: number;
  readonly startFocalRatio: number;
  readonly currentFocalRatio: number;
  readonly minimumSpan: number;
}): NumericRange {
  const [domainStart, domainEnd] = bounds;
  const [start, end] = boundedRange(startRange, bounds);
  if (!Number.isFinite(scale) || scale <= 0) return [start, end];
  const domainSpan = domainEnd - domainStart;
  if (!Number.isFinite(domainSpan) || domainSpan <= 0) return bounds;
  const initialSpan = end - start;
  const nextSpan = clamp(
    initialSpan / scale,
    clamp(minimumSpan, Number.EPSILON, domainSpan),
    domainSpan,
  );
  if (nextSpan >= domainSpan - Number.EPSILON) return bounds;

  const anchor = start + clamp(startFocalRatio, 0, 1) * initialSpan;
  const proposedStart = anchor - clamp(currentFocalRatio, 0, 1) * nextSpan;
  const nextStart = clamp(proposedStart, domainStart, domainEnd - nextSpan);
  return [nextStart, nextStart + nextSpan];
}

export function panCandleRange({
  startRange,
  bounds,
  translationX,
  plotWidth,
}: {
  readonly startRange: NumericRange;
  readonly bounds: NumericRange;
  readonly translationX: number;
  readonly plotWidth: number;
}): NumericRange {
  const [start, end] = boundedRange(startRange, bounds);
  if (
    !Number.isFinite(translationX) ||
    !Number.isFinite(plotWidth) ||
    plotWidth <= 0
  ) {
    return [start, end];
  }
  const span = end - start;
  const offset = -(translationX / plotWidth) * span;
  return boundedRange([start + offset, end + offset], bounds);
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
  const [windowStart, windowEnd] = boundedRange(interaction.xRange, domains.x);
  const [minimumPrice, maximumPrice] = domains.y;
  const priceSpan = maximumPrice - minimumPrice;
  const priceOffset = Number.isFinite(interaction.yOffset)
    ? interaction.yOffset * priceSpan
    : 0;

  return {
    x: [windowStart, windowEnd],
    y: [minimumPrice + priceOffset, maximumPrice + priceOffset],
  };
}
