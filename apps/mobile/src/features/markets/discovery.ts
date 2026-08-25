import type {
  MarketFamily,
  MarketLifecycle,
  MarketOrderAvailability,
  MarketSummary,
} from "@hyper-trader/hyperliquid/public";

export type MarketSort =
  | "symbol"
  | "volume"
  | "price_change"
  | "funding"
  | "open_interest";

export interface MarketDiscoveryOptions {
  readonly query: string;
  readonly families: readonly MarketFamily[];
  readonly includeHip3: boolean;
  readonly availability: MarketOrderAvailability | "all";
  readonly lifecycle: MarketLifecycle | "all";
  readonly favoritesOnly: boolean;
  readonly recentsOnly: boolean;
  readonly favoriteIds: readonly string[];
  readonly recentIds: readonly string[];
  readonly sort: MarketSort;
}

interface MarketDiscoveryProjection {
  readonly funding: number | null;
  readonly openInterest: number | null;
  readonly priceChange: number | null;
  readonly searchText: string;
  readonly sortLabel: string;
  readonly volume: number | null;
}

const projectionCache = new WeakMap<MarketSummary, MarketDiscoveryProjection>();

function compareText(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function searchableValues(market: MarketSummary): readonly string[] {
  const common = [
    market.displaySymbol,
    market.canonicalId,
    market.coin,
    market.family,
    marketVenueLabel(market),
  ];
  if (market.family === "perp") {
    return [
      ...common,
      market.dexName,
      market.dexFullName ?? "",
      market.dexIndex === 0 ? "native perpetual" : "HIP-3 perpetual",
    ];
  }
  if (market.family === "spot") {
    return [
      ...common,
      market.baseToken.name,
      market.baseToken.fullName ?? "",
      market.baseToken.tokenId,
      market.quoteToken.name,
      market.quoteToken.fullName ?? "",
      market.quoteToken.tokenId,
      marketDisplayLabel(market),
    ];
  }
  return [
    ...common,
    market.outcomeName,
    market.sideName,
    market.description,
    String(market.outcome),
  ];
}

function normalizeSearch(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

function matchesSearch(
  market: MarketSummary,
  tokens: readonly string[],
): boolean {
  if (tokens.length === 0) {
    return true;
  }
  const searchText = marketProjection(market).searchText;
  return tokens.every((token) => searchText.includes(token));
}

function decimalMetric(value: string | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function calculateMarketPriceChangePercent(
  market: MarketSummary,
): number | null {
  const current = decimalMetric(market.midPx ?? market.markPx);
  const previous = decimalMetric(market.prevDayPx);
  if (current === null || previous === null || previous === 0) {
    return null;
  }
  return ((current - previous) / Math.abs(previous)) * 100;
}

function marketProjection(market: MarketSummary): MarketDiscoveryProjection {
  const cached = projectionCache.get(market);
  if (cached) return cached;
  const projection = {
    funding: market.family === "perp" ? decimalMetric(market.funding) : null,
    openInterest:
      market.family === "perp" ? decimalMetric(market.openInterest) : null,
    priceChange: calculateMarketPriceChangePercent(market),
    searchText: searchableValues(market).map(normalizeSearch).join("\n"),
    sortLabel: normalizeSearch(marketDisplayLabel(market)),
    volume: decimalMetric(market.dayNtlVlm),
  };
  projectionCache.set(market, projection);
  return projection;
}

export function marketPriceChangePercent(market: MarketSummary): number | null {
  return marketProjection(market).priceChange;
}

function marketNumericMetric(
  market: MarketSummary,
  sort: Exclude<MarketSort, "symbol">,
): number | null {
  const projection = marketProjection(market);
  switch (sort) {
    case "volume":
      return projection.volume;
    case "price_change":
      return projection.priceChange;
    case "funding":
      return projection.funding;
    case "open_interest":
      return projection.openInterest;
  }
}

export function marketVenueLabel(market: MarketSummary): string {
  if (market.family === "perp") {
    return market.dexIndex === 0 || market.dexName === ""
      ? "Native"
      : market.dexFullName || market.dexName;
  }
  if (market.family === "spot") {
    return "Spot";
  }
  return market.outcomeName;
}

export function marketDisplayLabel(market: MarketSummary): string {
  if (market.family === "spot") {
    return `${market.baseToken.name}/${market.quoteToken.name}`;
  }
  if (market.family === "outcome") {
    return `${market.outcomeName} · ${market.sideName}`;
  }
  return market.displaySymbol;
}

export function marketPairLabel(market: MarketSummary): string {
  if (market.family === "spot") {
    return `${market.baseToken.name}/${market.quoteToken.name}`;
  }
  if (market.family === "perp") {
    return `${market.displaySymbol}-USDC`;
  }
  return market.displaySymbol;
}

export function compareMarkets(
  left: MarketSummary,
  right: MarketSummary,
  sort: MarketSort,
): number {
  if (sort !== "symbol") {
    const leftMetric = marketNumericMetric(left, sort);
    const rightMetric = marketNumericMetric(right, sort);
    if (leftMetric === null && rightMetric !== null) {
      return 1;
    }
    if (leftMetric !== null && rightMetric === null) {
      return -1;
    }
    if (
      leftMetric !== null &&
      rightMetric !== null &&
      leftMetric !== rightMetric
    ) {
      return rightMetric - leftMetric;
    }
  }

  const symbolOrder = compareText(
    marketProjection(left).sortLabel,
    marketProjection(right).sortLabel,
  );
  return symbolOrder === 0
    ? compareText(left.canonicalId, right.canonicalId)
    : symbolOrder;
}

export function discoverMarkets<T extends MarketSummary>(
  markets: readonly T[],
  options: MarketDiscoveryOptions,
): T[] {
  const families =
    options.families.length === 0 ? null : new Set(options.families);
  const favorites = options.favoritesOnly ? new Set(options.favoriteIds) : null;
  const recents = options.recentsOnly ? new Set(options.recentIds) : null;
  const normalizedQuery = normalizeSearch(options.query);
  const searchTokens =
    normalizedQuery === "" ? [] : normalizedQuery.split(/\s+/u);

  return markets
    .filter(
      (market) =>
        (families === null || families.has(market.family)) &&
        (options.includeHip3 ||
          market.family !== "perp" ||
          market.dexIndex === 0) &&
        (options.availability === "all" ||
          market.orderAvailability === options.availability) &&
        (options.lifecycle === "all" ||
          market.lifecycle === options.lifecycle) &&
        (favorites === null || favorites.has(market.canonicalId)) &&
        (recents === null || recents.has(market.canonicalId)) &&
        matchesSearch(market, searchTokens),
    )
    .sort((left, right) => compareMarkets(left, right, options.sort));
}
