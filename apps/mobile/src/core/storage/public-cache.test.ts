import { describe, expect, test } from "bun:test";

import {
  createSafePublicCachePersister,
  PUBLIC_CACHE_STORAGE_KEY,
} from "./public-cache";

function memoryStorage(initial?: string) {
  const values = new Map<string, string>();
  if (initial !== undefined) {
    values.set(PUBLIC_CACHE_STORAGE_KEY, initial);
  }
  return {
    values,
    async getItem(key: string) {
      return values.get(key) ?? null;
    },
    async setItem(key: string, value: string) {
      values.set(key, value);
    },
    async removeItem(key: string) {
      values.delete(key);
    },
  };
}

describe("safe public cache persister", () => {
  test("keeps restoration pending until asynchronous storage resolves", async () => {
    let release: (value: string | null) => void = () => undefined;
    let settled = false;
    const persister = createSafePublicCachePersister({
      getItem: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
      setItem: async () => undefined,
      removeItem: async () => undefined,
    });

    const restoration = Promise.resolve(persister.restoreClient?.()).then(
      (value) => {
        settled = true;
        return value;
      },
    );
    await Promise.resolve();
    expect(settled).toBe(false);
    release(null);

    expect(await restoration).toBeUndefined();
  });

  test("removes corrupt storage and restores as a cold cache", async () => {
    const storage = memoryStorage("{not-json");
    const persister = createSafePublicCachePersister(storage);

    expect(await persister.restoreClient()).toBeUndefined();
    expect(storage.values.has(PUBLIC_CACHE_STORAGE_KEY)).toBe(false);
  });

  test("strips private queries and every mutation from restored data", async () => {
    const storage = memoryStorage();
    const persister = createSafePublicCachePersister(storage);
    await persister.persistClient({
      timestamp: 10,
      buster: "test",
      clientState: {
        mutations: [
          {
            mutationKey: ["private", "action"],
            state: {
              context: undefined,
              data: undefined,
              error: null,
              failureCount: 0,
              failureReason: null,
              isPaused: true,
              status: "pending",
              variables: { secret: "never" },
              submittedAt: 1,
            },
          },
        ],
        queries: [
          {
            dehydratedAt: 1,
            queryHash: "public",
            queryKey: ["public", "mainnet", "marketCatalog"],
            state: {
              data: { markets: 1 },
              dataUpdateCount: 1,
              dataUpdatedAt: 1,
              error: null,
              errorUpdateCount: 0,
              errorUpdatedAt: 0,
              fetchFailureCount: 0,
              fetchFailureReason: null,
              fetchMeta: null,
              isInvalidated: false,
              status: "success",
              fetchStatus: "idle",
            },
          },
          {
            dehydratedAt: 1,
            queryHash: "private",
            queryKey: ["private", "testnet", "0xaaa", "0xaaa", "portfolio"],
            state: {
              data: { accountValue: "1" },
              dataUpdateCount: 1,
              dataUpdatedAt: 1,
              error: null,
              errorUpdateCount: 0,
              errorUpdatedAt: 0,
              fetchFailureCount: 0,
              fetchFailureReason: null,
              fetchMeta: null,
              isInvalidated: false,
              status: "success",
              fetchStatus: "idle",
            },
          },
        ],
      },
    });
    const raw = storage.values.get(PUBLIC_CACHE_STORAGE_KEY) ?? "";

    expect(raw).not.toContain("accountValue");
    expect(raw).not.toContain("never");

    const restored = await persister.restoreClient();

    expect(restored?.clientState.mutations).toEqual([]);
    expect(
      restored?.clientState.queries.map(({ queryHash }) => queryHash),
    ).toEqual(["public"]);
    expect(JSON.stringify(restored)).not.toContain("accountValue");
    expect(JSON.stringify(restored)).not.toContain("never");
  });
});
