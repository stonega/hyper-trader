import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import type {
  PersistedClient,
  Persister,
} from "@tanstack/react-query-persist-client";

import { isAllowlistedPublicQuery } from "../query/persistence";

export const PUBLIC_CACHE_STORAGE_KEY = "hyper-trader.public-query-cache.v3";
const LEGACY_PUBLIC_CACHE_STORAGE_KEYS = [
  "hyper-trader.public-query-cache.v1",
  "hyper-trader.public-query-cache.v2",
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
  if (queryKey[2] !== "marketCatalog") return true;
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return false;
  }
  const catalog = data as Readonly<Record<string, unknown>>;
  return (
    Array.isArray(catalog.markets) &&
    catalog.markets.length > 0 &&
    Array.isArray(catalog.quarantined) &&
    Array.isArray(catalog.sourceErrors)
  );
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
      queries: value.clientState.queries.filter(
        ({ queryKey, state }) =>
          state.status === "success" &&
          isAllowlistedPublicQuery(queryKey) &&
          isRestorablePublicData(queryKey, state.data),
      ),
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
