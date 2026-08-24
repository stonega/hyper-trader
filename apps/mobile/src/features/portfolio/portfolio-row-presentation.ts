import type { Market } from "@hyper-trader/hyperliquid/public";

import { marketPairLabel } from "../markets/discovery";

export type PortfolioSideColor = "danger" | "default" | "success";

export function portfolioSideLabel(side: string): string {
  const normalized = side.trim().toLowerCase();
  if (normalized === "b" || normalized === "bid" || normalized === "buy") {
    return "Buy";
  }
  if (
    normalized === "a" ||
    normalized === "ask" ||
    normalized === "s" ||
    normalized === "sell"
  ) {
    return "Sell";
  }
  if (normalized === "") return "Unknown side";
  return `${normalized[0]?.toUpperCase() ?? ""}${normalized.slice(1)}`;
}

export function portfolioSideColor(side: string): PortfolioSideColor {
  const label = portfolioSideLabel(side);
  return label === "Buy" ? "success" : label === "Sell" ? "danger" : "default";
}

export function portfolioMarketLabel(
  coin: string,
  markets: readonly Market[],
  resolvedMarket: Market | null = null,
): string {
  const market =
    resolvedMarket ?? markets.find((candidate) => candidate.coin === coin);
  if (market) return marketPairLabel(market);

  const separator = coin.indexOf(":");
  const displayCoin = (
    separator === -1 ? coin : coin.slice(separator + 1)
  ).trim();
  if (displayCoin === "") return "Unknown market";
  if (displayCoin.startsWith("@") || displayCoin.startsWith("#")) {
    return displayCoin;
  }
  return `${displayCoin}-USDC`;
}

export function formatPortfolioRecordTime(timestamp: number): string {
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    return "Time unavailable";
  }
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
  }).format(new Date(timestamp));
}
