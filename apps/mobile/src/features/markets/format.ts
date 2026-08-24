import type {
  MarketSummary,
  PricePrecisionInputs,
} from "@hyper-trader/hyperliquid/public";

const dollarFormatters = new Map<number, Intl.NumberFormat>();

function dollarFormatter(maximumFractionDigits: number): Intl.NumberFormat {
  const cached = dollarFormatters.get(maximumFractionDigits);
  if (cached) return cached;
  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits,
  });
  dollarFormatters.set(maximumFractionDigits, formatter);
  return formatter;
}

function rawFractionDigits(value: string): number {
  const separator = value.indexOf(".");
  return separator === -1 ? 0 : value.length - separator - 1;
}

function priceFractionDigits(
  value: string,
  number: number,
  precision: PricePrecisionInputs | null,
): number {
  if (precision === null) return Math.min(rawFractionDigits(value), 8);
  const absolute = Math.abs(number);
  if (absolute === 0) return precision.maxDecimalPlaces;
  const exponent = Math.floor(Math.log10(absolute));
  const significantFractionDigits =
    exponent >= 0
      ? Math.max(0, precision.maxSignificantFigures - exponent - 1)
      : -exponent - 1 + precision.maxSignificantFigures;
  return Math.min(precision.maxDecimalPlaces, significantFractionDigits);
}
const compactDecimalFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 2,
});

export function formatMarketPrice(market: MarketSummary): string {
  const value = market.midPx ?? market.markPx;
  if (value === null || value === undefined) {
    return "Price unavailable";
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return value;
  }
  return dollarFormatter(
    priceFractionDigits(value, number, market.pricePrecision),
  ).format(number);
}

export function formatCompactDecimal(value: string | null | undefined): string {
  if (value === null || value === undefined) {
    return "Unavailable";
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return value;
  }
  return compactDecimalFormatter.format(number);
}

export function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "Unavailable";
  }
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(2)}%`;
}
