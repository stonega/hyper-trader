import type { DehydrateOptions, Query, QueryKey } from "@tanstack/react-query";

import { isPublicQueryKey, type PublicQueryFamily } from "./keys";

export const PUBLIC_CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;
export const PUBLIC_CACHE_GC_TIME_MS = 24 * 60 * 60 * 1000;
export const PUBLIC_CACHE_BUSTER = "hyper-trader-public-v1";

const persistedFamilies = new Set<PublicQueryFamily>([
  "marketCatalog",
  "midPrices",
  "marketContext",
  "candles",
]);

export function isAllowlistedPublicQuery(queryKey: QueryKey): boolean {
  return (
    isPublicQueryKey(queryKey) &&
    (queryKey[1] === "mainnet" || queryKey[1] === "testnet") &&
    typeof queryKey[2] === "string" &&
    persistedFamilies.has(queryKey[2] as PublicQueryFamily)
  );
}

export function shouldPersistPublicQuery(query: Query): boolean {
  return (
    query.state.status === "success" && isAllowlistedPublicQuery(query.queryKey)
  );
}

export function createPublicCacheDehydrateOptions(): DehydrateOptions {
  return {
    shouldDehydrateMutation: () => false,
    shouldDehydrateQuery: shouldPersistPublicQuery,
  };
}
