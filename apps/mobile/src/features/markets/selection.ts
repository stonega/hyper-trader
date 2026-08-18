import type { Market } from "@hyper-trader/hyperliquid/public";

import { compareMarkets } from "./discovery";

export type MarketSelectionSource = "route" | "last_used" | "volume_fallback";

export interface ResolvedMarketSelection {
  readonly market: Market;
  readonly source: MarketSelectionSource;
}

export function normalizeMarketRouteParam(
  value: string | readonly string[] | undefined,
): string | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  const normalized = candidate?.trim();
  return normalized ? normalized : null;
}

function findValidMarket(
  markets: readonly Market[],
  canonicalId: string | null,
): Market | null {
  if (canonicalId === null) {
    return null;
  }
  return (
    markets.find(
      (market) =>
        market.canonicalId === canonicalId && market.lifecycle === "active",
    ) ?? null
  );
}

export function resolveMarketSelection(
  markets: readonly Market[],
  requestedCanonicalId: string | null,
  lastCanonicalId: string | null,
): ResolvedMarketSelection | null {
  const requested = findValidMarket(markets, requestedCanonicalId);
  if (requested) {
    return { market: requested, source: "route" };
  }

  const lastUsed = findValidMarket(markets, lastCanonicalId);
  if (lastUsed) {
    return { market: lastUsed, source: "last_used" };
  }

  const fallback = markets.reduce<Market | null>((current, market) => {
    if (market.lifecycle !== "active") {
      return current;
    }
    return current === null || compareMarkets(market, current, "volume") < 0
      ? market
      : current;
  }, null);
  return fallback ? { market: fallback, source: "volume_fallback" } : null;
}

export function isUsableTradeSelection(
  markets: readonly Market[],
  selectedCanonicalId: string | null,
  navigationAndScrollReady: boolean,
): boolean {
  return (
    navigationAndScrollReady &&
    findValidMarket(markets, selectedCanonicalId) !== null
  );
}
