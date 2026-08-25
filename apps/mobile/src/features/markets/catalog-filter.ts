import type {
  MarketLifecycle,
  MarketOrderAvailability,
} from "@hyper-trader/hyperliquid/public";

export interface MarketCatalogFilters {
  readonly includeHip3: boolean;
  readonly availability: MarketOrderAvailability | "all";
  readonly lifecycle: MarketLifecycle | "all";
}

export const ACTIVE_MARKET_CATALOG_FILTERS = {
  includeHip3: true,
  availability: "all",
  lifecycle: "active",
} as const satisfies MarketCatalogFilters;
