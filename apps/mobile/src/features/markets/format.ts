import type { Market } from "@hyper-trader/hyperliquid/public";

const wholeDollarFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const standardDollarFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});
const smallDollarFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 6,
});
const compactDecimalFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 2,
});

export function formatMarketPrice(market: Market): string {
  const value = market.midPx ?? market.markPx;
  if (value === null || value === undefined) {
    return "Price unavailable";
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return value;
  }
  const formatter =
    number >= 1_000
      ? wholeDollarFormatter
      : number >= 1
        ? standardDollarFormatter
        : smallDollarFormatter;
  return formatter.format(number);
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
