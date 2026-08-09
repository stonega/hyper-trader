import {
  type DecimalString,
  isDecimalString,
} from "@hyper-trader/hyperliquid/public";

const BLOCKS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"] as const;

interface ParsedDecimal {
  readonly source: DecimalString;
  readonly coefficient: bigint;
  readonly scale: number;
}

export interface PerformanceSummary {
  readonly sparkline: string;
  readonly start: DecimalString;
  readonly end: DecimalString;
  readonly high: DecimalString;
  readonly low: DecimalString;
  readonly absoluteChange: DecimalString;
  readonly percentChange: DecimalString | null;
  readonly gapCount: number;
  readonly accessibilityLabel: string;
}

function decimal(value: unknown): ParsedDecimal {
  if (!isDecimalString(value)) {
    throw new Error("Performance history must contain a valid decimal value.");
  }
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

function powerOfTen(scale: number): bigint {
  return 10n ** BigInt(scale);
}

function normalized(values: readonly ParsedDecimal[]): readonly bigint[] {
  const scale = values.reduce(
    (maximum, value) => Math.max(maximum, value.scale),
    0,
  );
  return values.map(
    (value) => value.coefficient * powerOfTen(scale - value.scale),
  );
}

function format(coefficient: bigint, scale: number): DecimalString {
  if (coefficient === 0n) return "0";
  const negative = coefficient < 0n;
  const digits = (negative ? -coefficient : coefficient).toString();
  if (scale === 0) return `${negative ? "-" : ""}${digits}`;
  const padded = digits.padStart(scale + 1, "0");
  const split = padded.length - scale;
  const fraction = padded.slice(split).replace(/0+$/, "");
  return `${negative ? "-" : ""}${padded.slice(0, split)}${
    fraction === "" ? "" : `.${fraction}`
  }`;
}

function subtract(left: ParsedDecimal, right: ParsedDecimal): DecimalString {
  const scale = Math.max(left.scale, right.scale);
  return format(
    left.coefficient * powerOfTen(scale - left.scale) -
      right.coefficient * powerOfTen(scale - right.scale),
    scale,
  );
}

function percentage(
  change: ParsedDecimal,
  startingValue: ParsedDecimal,
): DecimalString | null {
  if (startingValue.coefficient === 0n) return null;
  const precision = 4;
  const numerator =
    change.coefficient *
    powerOfTen(startingValue.scale) *
    100n *
    powerOfTen(precision);
  const denominator = startingValue.coefficient * powerOfTen(change.scale);
  return format(numerator / denominator, precision);
}

export function percentageOf(
  value: DecimalString,
  base: DecimalString,
): DecimalString | null {
  return percentage(decimal(value), decimal(base));
}

export function summarizePerformanceSeries(
  points: readonly (readonly [number, DecimalString])[],
  options: {
    readonly label: string;
    readonly expectedCadenceMs: number | null;
  },
): PerformanceSummary | null {
  if (points.length === 0) return null;
  let previousTime: number | null = null;
  let gapCount = 0;
  const parsed = points.map(([time, value]) => {
    if (!Number.isSafeInteger(time) || time < 0) {
      throw new Error("Performance timestamps must be non-negative integers.");
    }
    if (previousTime !== null) {
      if (time <= previousTime) {
        throw new Error("Performance timestamps must be strictly increasing.");
      }
      if (
        options.expectedCadenceMs !== null &&
        time - previousTime > options.expectedCadenceMs * 1.5
      ) {
        gapCount += 1;
      }
    }
    previousTime = time;
    return decimal(value);
  });
  const first = parsed[0];
  const last = parsed.at(-1);
  if (!first || !last) return null;
  const values = normalized(parsed);
  const ordered = [...values].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  const lowValue = ordered[0];
  const highValue = ordered.at(-1);
  if (lowValue === undefined || highValue === undefined) return null;
  const firstRank = new Map<bigint, number>();
  ordered.forEach((value, index) => {
    if (!firstRank.has(value)) firstRank.set(value, index);
  });
  const sparkline = values
    .map((value) => {
      if (lowValue === highValue) return BLOCKS[3];
      const rank = firstRank.get(value) ?? 0;
      return BLOCKS[
        Math.floor(
          (rank * (BLOCKS.length - 1)) / Math.max(1, ordered.length - 1),
        )
      ];
    })
    .join("");
  let highIndex = 0;
  let lowIndex = 0;
  for (let index = 1; index < parsed.length; index += 1) {
    if ((values[index] ?? 0n) > (values[highIndex] ?? 0n)) highIndex = index;
    if ((values[index] ?? 0n) < (values[lowIndex] ?? 0n)) lowIndex = index;
  }
  const changeValue = subtract(last, first);
  const change = decimal(changeValue);
  const percent = percentage(change, first);
  const gapText =
    gapCount === 0
      ? "No source gaps detected."
      : `${gapCount} source gap${gapCount === 1 ? "" : "s"} visible.`;
  return {
    sparkline,
    start: first.source,
    end: last.source,
    high: parsed[highIndex]?.source ?? first.source,
    low: parsed[lowIndex]?.source ?? first.source,
    absoluteChange: changeValue,
    percentChange: percent,
    gapCount,
    accessibilityLabel: `${options.label} account performance. Start ${first.source}. End ${last.source}. High ${parsed[highIndex]?.source ?? first.source}. Low ${parsed[lowIndex]?.source ?? first.source}. ${gapText}`,
  };
}
