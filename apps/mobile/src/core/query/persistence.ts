import type { DehydrateOptions, Query, QueryKey } from "@tanstack/react-query";

import { isPublicQueryKey, type PublicQueryFamily } from "./keys";

export const PUBLIC_CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;
export const PUBLIC_CACHE_GC_TIME_MS = 24 * 60 * 60 * 1000;
export const PUBLIC_CACHE_BUSTER = "hyper-trader-public-v3";

const persistedFamilies = new Set<PublicQueryFamily>(["marketCatalog"]);

const PERSISTING_CACHE_EVENT_TYPES = new Set(["added", "removed", "updated"]);

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

export function shouldPersistPublicCacheEvent(event: {
  readonly type: string;
  readonly query?: Pick<Query, "queryKey">;
}): boolean {
  return (
    PERSISTING_CACHE_EVENT_TYPES.has(event.type) &&
    event.query !== undefined &&
    isAllowlistedPublicQuery(event.query.queryKey)
  );
}

export function createPublicCacheDehydrateOptions(): DehydrateOptions {
  return {
    shouldDehydrateMutation: () => false,
    shouldDehydrateQuery: shouldPersistPublicQuery,
  };
}
