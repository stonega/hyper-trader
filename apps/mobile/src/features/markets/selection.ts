import type { Market } from "@hyper-trader/hyperliquid/public";

import { compareMarkets, marketPairLabel } from "./discovery";

export const DEFAULT_TRADE_MARKET_LABEL = "BTC-USDC";

export type MarketSelectionSource =
  | "route"
  | "last_used"
  | "default_market"
  | "volume_fallback";

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

function findDefaultMarket(markets: readonly Market[]): Market | null {
  const activeMarkets = markets.filter(
    (market) => market.lifecycle === "active",
  );
  const nativePerpetual = activeMarkets.find(
    (market) =>
      market.family === "perp" &&
      (market.dexIndex === 0 || market.dexName === "") &&
      marketPairLabel(market).toUpperCase() === DEFAULT_TRADE_MARKET_LABEL,
  );
  return (
    nativePerpetual ??
    activeMarkets.find(
      (market) =>
        marketPairLabel(market).toUpperCase() === DEFAULT_TRADE_MARKET_LABEL,
    ) ??
    null
  );
}

export function resolveMarketSelection(
  markets: readonly Market[],
  requestedCanonicalId: string | null,
  lastCanonicalId: string | null,
  options: { readonly allowVolumeFallback?: boolean } = {},
): ResolvedMarketSelection | null {
  const requested = findValidMarket(markets, requestedCanonicalId);
  if (requested) {
    return { market: requested, source: "route" };
  }

  const lastUsed = findValidMarket(markets, lastCanonicalId);
  if (lastUsed) {
    return { market: lastUsed, source: "last_used" };
  }

  if (options.allowVolumeFallback === false) {
    return null;
  }

  const defaultMarket = findDefaultMarket(markets);
  if (defaultMarket) {
    return { market: defaultMarket, source: "default_market" };
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
