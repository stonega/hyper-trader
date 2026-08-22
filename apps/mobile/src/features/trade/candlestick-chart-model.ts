import { type Candle, isDecimalString } from "@hyper-trader/hyperliquid/public";

const BLOCKS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"] as const;

export interface CandlestickDatum {
  readonly [key: string]: number | null;
  readonly timestamp: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number | null;
  readonly positiveVolume: number | null;
  readonly negativeVolume: number | null;
  readonly neutralVolume: number | null;
}

export interface CandleInspectionDatum {
  readonly timestamp: number;
  readonly open: string;
  readonly high: string;
  readonly low: string;
  readonly close: string;
  readonly volume: string;
  readonly tradeCount: number;
  readonly direction: "up" | "down" | "flat";
}

export interface CandleChartSummary {
  readonly sparkline: string;
  readonly open: string;
  readonly high: string;
  readonly low: string;
  readonly close: string;
  readonly accessibilityLabel: string;
}

export interface CandlestickChartModel {
  readonly data: CandlestickDatum[];
  readonly inspection: CandleInspectionDatum[];
  readonly summary: CandleChartSummary;
  readonly firstTimestamp: number;
  readonly lastTimestamp: number;
  readonly maximumVolume: number | null;
}

interface ParsedDecimal {
  readonly source: string;
  readonly coefficient: bigint;
  readonly scale: number;
}

function decimalParts(value: string): ParsedDecimal | null {
  if (!isDecimalString(value)) return null;
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  const coefficient = BigInt(`${whole}${fraction}`);
  return {
    source: value,
    coefficient: negative ? -coefficient : coefficient,
    scale: fraction.length,
  };
}

function parseSeries(
  values: readonly string[],
): readonly ParsedDecimal[] | null {
  const parsed = values.map(decimalParts);
  return parsed.some((value) => value === null)
    ? null
    : (parsed as readonly ParsedDecimal[]);
}

function normalizeSeries(values: readonly ParsedDecimal[]): readonly bigint[] {
  const scale = values.reduce(
    (maximum, value) => Math.max(maximum, value.scale),
    0,
  );
  return values.map(
    (value) => value.coefficient * 10n ** BigInt(scale - value.scale),
  );
}

function compareDecimal(left: ParsedDecimal, right: ParsedDecimal): number {
  const scale = Math.max(left.scale, right.scale);
  const normalizedLeft = left.coefficient * 10n ** BigInt(scale - left.scale);
  const normalizedRight =
    right.coefficient * 10n ** BigInt(scale - right.scale);
  return normalizedLeft < normalizedRight
    ? -1
    : normalizedLeft > normalizedRight
      ? 1
      : 0;
}

function summarizeCandles(
  candles: readonly Candle[],
  windowLabel: string,
): CandleChartSummary | null {
  const first = candles[0];
  const last = candles.at(-1);
  if (!first || !last) return null;
  const opens = parseSeries(candles.map((candle) => candle.open));
  const closes = parseSeries(candles.map((candle) => candle.close));
  const highs = parseSeries(candles.map((candle) => candle.high));
  const lows = parseSeries(candles.map((candle) => candle.low));
  if (opens === null || closes === null || highs === null || lows === null) {
    return null;
  }

  const normalizedCloses = normalizeSeries(closes);
  const normalizedHighs = normalizeSeries(highs);
  const normalizedLows = normalizeSeries(lows);
  const ordered = [...normalizedCloses].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  const minimum = ordered[0];
  const maximum = ordered.at(-1);
  if (minimum === undefined || maximum === undefined) return null;
  const firstRank = new Map<bigint, number>();
  ordered.forEach((value, index) => {
    if (!firstRank.has(value)) firstRank.set(value, index);
  });
  const sparkline = normalizedCloses
    .map((value) => {
      if (minimum === maximum) return BLOCKS[3];
      const rank = firstRank.get(value) ?? 0;
      const index = Math.floor(
        (rank * (BLOCKS.length - 1)) / Math.max(1, ordered.length - 1),
      );
      return BLOCKS[index];
    })
    .join("");
  let highIndex = 0;
  let lowIndex = 0;
  for (let index = 1; index < candles.length; index += 1) {
    if (normalizedHighs[index] > normalizedHighs[highIndex]) highIndex = index;
    if (normalizedLows[index] < normalizedLows[lowIndex]) lowIndex = index;
  }
  const high = highs[highIndex]?.source;
  const low = lows[lowIndex]?.source;
  if (high === undefined || low === undefined) return null;
  return {
    sparkline,
    open: opens[0]?.source ?? first.open,
    high,
    low,
    close: closes.at(-1)?.source ?? last.close,
    accessibilityLabel: `${windowLabel} candlestick chart with ${candles.length} candles. Open ${first.open}. High ${high}. Low ${low}. Close ${last.close}.`,
  };
}

export function buildCandlestickChartModel(
  candles: readonly Candle[],
  windowLabel: string,
): CandlestickChartModel | null {
  const summary = summarizeCandles(candles, windowLabel);
  if (summary === null) return null;

  let previousTimestamp = -1;
  const data: CandlestickDatum[] = [];
  const inspection: CandleInspectionDatum[] = [];
  let maximumVolume: number | null = null;
  for (const candle of candles) {
    const sourceValues = [candle.open, candle.high, candle.low, candle.close];
    const exactValues = sourceValues.map(decimalParts);
    if (exactValues.some((value) => value === null)) return null;
    const [exactOpen, exactHigh, exactLow, exactClose] =
      exactValues as readonly ParsedDecimal[];
    if (
      exactOpen === undefined ||
      exactHigh === undefined ||
      exactLow === undefined ||
      exactClose === undefined ||
      compareDecimal(exactHigh, exactOpen) < 0 ||
      compareDecimal(exactHigh, exactClose) < 0 ||
      compareDecimal(exactHigh, exactLow) < 0 ||
      compareDecimal(exactLow, exactOpen) > 0 ||
      compareDecimal(exactLow, exactClose) > 0
    ) {
      return null;
    }
    const values = sourceValues.map(Number);
    const [open, high, low, close] = values;
    if (
      open === undefined ||
      high === undefined ||
      low === undefined ||
      close === undefined ||
      values.some((value) => !Number.isFinite(value)) ||
      candle.openTime <= previousTimestamp
    ) {
      return null;
    }
    const parsedVolume = decimalParts(candle.volume);
    const numericVolume = Number(candle.volume);
    const volume =
      parsedVolume !== null &&
      parsedVolume.coefficient >= 0n &&
      Number.isFinite(numericVolume) &&
      numericVolume >= 0
        ? numericVolume
        : null;
    const direction =
      compareDecimal(exactClose, exactOpen) > 0
        ? "up"
        : compareDecimal(exactClose, exactOpen) < 0
          ? "down"
          : "flat";
    data.push({
      timestamp: candle.openTime,
      open,
      high,
      low,
      close,
      volume,
      positiveVolume: direction === "up" ? volume : null,
      negativeVolume: direction === "down" ? volume : null,
      neutralVolume: direction === "flat" ? volume : null,
    });
    inspection.push({
      timestamp: candle.openTime,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
      tradeCount: candle.tradeCount,
      direction,
    });
    if (volume !== null) {
      maximumVolume = Math.max(maximumVolume ?? 0, volume);
    }
    previousTimestamp = candle.openTime;
  }

  const first = data[0];
  const last = data.at(-1);
  if (!first || !last) return null;
  return {
    data,
    inspection,
    summary,
    firstTimestamp: first.timestamp,
    lastTimestamp: last.timestamp,
    maximumVolume,
  };
}

export function nearestCandleIndex(
  data: readonly CandleInspectionDatum[],
  timestamp: number,
): number | null {
  if (data.length === 0 || !Number.isFinite(timestamp)) return null;
  let low = 0;
  let high = data.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = data[middle];
    if (!candidate) return null;
    if (candidate.timestamp === timestamp) return middle;
    if (candidate.timestamp < timestamp) low = middle + 1;
    else high = middle - 1;
  }
  if (low <= 0) return 0;
  if (low >= data.length) return data.length - 1;
  const before = data[low - 1];
  const after = data[low];
  if (!before || !after) return null;
  return timestamp - before.timestamp <= after.timestamp - timestamp
    ? low - 1
    : low;
}
