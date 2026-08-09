import { type Candle, isDecimalString } from "@hyper-trader/hyperliquid/public";

const BLOCKS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"] as const;

export interface TextChartSummary {
  readonly sparkline: string;
  readonly open: string;
  readonly high: string;
  readonly low: string;
  readonly close: string;
  readonly accessibilityLabel: string;
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

export function summarizeCandles(
  candles: readonly Candle[],
): TextChartSummary | null {
  if (candles.length === 0) return null;
  const first = candles[0];
  const last = candles.at(-1);
  if (!first || !last) return null;
  const closes = parseSeries(candles.map((candle) => candle.close));
  const highs = parseSeries(candles.map((candle) => candle.high));
  const lows = parseSeries(candles.map((candle) => candle.low));
  if (closes === null || highs === null || lows === null) return null;
  if (decimalParts(first.open) === null) return null;

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
    open: first.open,
    high,
    low,
    close: last.close,
    accessibilityLabel: `24 hour price chart. Open ${first.open}. High ${high}. Low ${low}. Close ${last.close}.`,
  };
}
