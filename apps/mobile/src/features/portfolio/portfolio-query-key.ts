import type { AccountTarget } from "@hyper-trader/hyperliquid";
import type { Market } from "@hyper-trader/hyperliquid/public";

import type { NormalizedTradingContext } from "../../core/context/supervisor";
import { queryKeys } from "../../core/query/keys";
import { accountTargetIdentityKey } from "./portfolio-model";

export function portfolioCatalogCacheKey(
  markets: readonly Market[] | undefined,
): string {
  return JSON.stringify(
    markets?.map((market) => [
      market.canonicalId,
      market.orderAssetId,
      market.lifecycle,
      market.orderAvailability,
      market.sizeDecimals,
      market.pricePrecision,
      market.family === "perp" ? market.maxLeverage : null,
      market.family === "perp" ? market.onlyIsolated : null,
    ]) ?? null,
  );
}

export function portfolioQueryKey(
  context: NormalizedTradingContext,
  target: AccountTarget,
  catalogFingerprint: string,
) {
  return [
    ...queryKeys.private.accountSnapshot(context),
    "portfolio-screen",
    accountTargetIdentityKey(target),
    catalogFingerprint,
  ] as const;
}
