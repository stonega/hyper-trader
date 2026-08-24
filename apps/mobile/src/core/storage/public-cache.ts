import { parseMarketSummaryPage } from "@hyper-trader/hyperliquid/public";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import type {
  PersistedClient,
  Persister,
} from "@tanstack/react-query-persist-client";

import { isAllowlistedPublicQuery } from "../query/persistence";

export const PUBLIC_CACHE_STORAGE_KEY = "hyper-trader.public-query-cache.v4";
const LEGACY_PUBLIC_CACHE_STORAGE_KEYS = [
  "hyper-trader.public-query-cache.v1",
  "hyper-trader.public-query-cache.v2",
  "hyper-trader.public-query-cache.v3",
] as const;

export interface AsyncKeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<unknown>;
  removeItem(key: string): Promise<void>;
}

function isRestorablePublicData(
  queryKey: readonly unknown[],
  data: unknown,
): boolean {
  if (queryKey[2] !== "marketSummaries") return true;
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return false;
  }
  const infinite = data as Readonly<Record<string, unknown>>;
  if (
    !Array.isArray(infinite.pages) ||
    infinite.pages.length === 0 ||
    !Array.isArray(infinite.pageParams) ||
    infinite.pageParams.length !== infinite.pages.length
  ) {
    return false;
  }
  const firstPageParam = infinite.pageParams[0];
  if (
    typeof firstPageParam !== "object" ||
    firstPageParam === null ||
    Array.isArray(firstPageParam) ||
    Object.keys(firstPageParam).length !== 2 ||
    (firstPageParam as Record<string, unknown>).cursor !== null ||
    (firstPageParam as Record<string, unknown>).idOffset !== 0
  ) {
    return false;
  }
  try {
    for (const page of infinite.pages) parseMarketSummaryPage(page);
    return true;
  } catch {
    return false;
  }
}

function firstMarketSummaryPage(data: unknown): unknown {
  const infinite = data as {
    readonly pages: readonly unknown[];
    readonly pageParams: readonly unknown[];
  };
  return {
    pages: [infinite.pages[0]],
    pageParams: [infinite.pageParams[0]],
  };
}

function sanitizePersistedClient(value: PersistedClient): PersistedClient {
  if (
    !Number.isFinite(value.timestamp) ||
    typeof value.buster !== "string" ||
    !Array.isArray(value.clientState?.queries) ||
    !Array.isArray(value.clientState?.mutations)
  ) {
    throw new TypeError("The public query cache has an invalid shape.");
  }
  return {
    ...value,
    clientState: {
      mutations: [],
      queries: value.clientState.queries
        .filter(
          ({ queryKey, state }) =>
            state.status === "success" &&
            isAllowlistedPublicQuery(queryKey) &&
            isRestorablePublicData(queryKey, state.data),
        )
        .map((query) => ({
          ...query,
          state: {
            ...query.state,
            data:
              query.queryKey[2] === "marketSummaries"
                ? firstMarketSummaryPage(query.state.data)
                : query.state.data,
          },
        })),
    },
  };
}

export function createSafePublicCachePersister(
  storage: AsyncKeyValueStorage,
): Persister {
  const base = createAsyncStoragePersister({
    storage,
    key: PUBLIC_CACHE_STORAGE_KEY,
    throttleTime: 1_000,
  });
  return {
    persistClient(value) {
      return base.persistClient(sanitizePersistedClient(value));
    },
    async restoreClient() {
      try {
        await Promise.all(
          LEGACY_PUBLIC_CACHE_STORAGE_KEYS.map((key) =>
            storage.removeItem(key),
          ),
        );
        const restored = await base.restoreClient();
        return restored === undefined
          ? undefined
          : sanitizePersistedClient(restored);
      } catch {
        await base.removeClient();
        return undefined;
      }
    },
    removeClient: base.removeClient,
  };
}
