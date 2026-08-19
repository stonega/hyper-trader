import { describe, expect, test } from "bun:test";
import { dehydrate, hydrate, QueryClient } from "@tanstack/react-query";
import { createMobileQueryClient } from "./client";
import { queryKeys } from "./keys";
import {
  createPublicCacheDehydrateOptions,
  isAllowlistedPublicQuery,
  PUBLIC_CACHE_MAX_AGE_MS,
} from "./persistence";
import { removeIncompatiblePrivateQueries } from "./private-cache";

describe("query ownership and public persistence", () => {
  test("does not retry mutations by default", () => {
    expect(createMobileQueryClient().getDefaultOptions().mutations?.retry).toBe(
      false,
    );
  });

  test("distinguishes public and exact private ownership", () => {
    expect(queryKeys.public.marketCatalog("mainnet")).toEqual([
      "public",
      "mainnet",
      "marketCatalog",
    ]);
    expect(
      queryKeys.private.accountSnapshot({
        network: "testnet",
        masterAccount: "0xaaa",
        targetAccount: "0xbbb",
      }),
    ).toEqual(["private", "testnet", "0xaaa", "0xbbb", "accountSnapshot"]);
    expect(
      queryKeys.private.clearinghouseState(
        {
          network: "testnet",
          masterAccount: "0xaaa",
          targetAccount: "0xbbb",
        },
        "dex-one",
      ),
    ).toEqual([
      "private",
      "testnet",
      "0xaaa",
      "0xbbb",
      "clearinghouseState",
      "dex-one",
    ]);
    expect(
      queryKeys.private.openOrders(
        {
          network: "testnet",
          masterAccount: "0xaaa",
          targetAccount: "0xbbb",
        },
        "dex-two",
      ),
    ).not.toEqual(
      queryKeys.private.openOrders(
        {
          network: "testnet",
          masterAccount: "0xaaa",
          targetAccount: "0xbbb",
        },
        "dex-one",
      ),
    );
    expect(
      queryKeys.private.accountSnapshot({
        network: "testnet",
        masterAccount: " 0xAaA ",
        targetAccount: " 0xBbB ",
      }),
    ).toEqual(["private", "testnet", "0xaaa", "0xbbb", "accountSnapshot"]);
  });

  test("warm restore includes only allowlisted successful public families", async () => {
    const source = new QueryClient();
    source.setQueryData(queryKeys.public.marketCatalog("mainnet"), {
      markets: 4,
    });
    source.setQueryData(queryKeys.public.midPrices("mainnet"), {
      BTC: "90000",
    });
    source.setQueryData(
      queryKeys.private.accountSnapshot({
        network: "testnet",
        masterAccount: "0xaaa",
        targetAccount: "0xbbb",
      }),
      { accountValue: "123" },
    );

    const persisted = dehydrate(source, createPublicCacheDehydrateOptions());
    const restored = new QueryClient();
    hydrate(restored, persisted);

    expect(
      restored.getQueryData<{ markets: number }>(
        queryKeys.public.marketCatalog("mainnet"),
      ),
    ).toEqual({ markets: 4 });
    expect(
      restored.getQueryData<{ BTC: string }>(
        queryKeys.public.midPrices("mainnet"),
      ),
    ).toEqual({ BTC: "90000" });
    expect(
      restored.getQueryData(
        queryKeys.private.accountSnapshot({
          network: "testnet",
          masterAccount: "0xaaa",
          targetAccount: "0xbbb",
        }),
      ),
    ).toBeUndefined();
    expect(PUBLIC_CACHE_MAX_AGE_MS).toBeGreaterThan(0);
  });

  test("cold storage and unknown public families restore nothing", () => {
    expect(isAllowlistedPublicQuery(["public", "mainnet", "unknown"])).toBe(
      false,
    );
    const restored = new QueryClient();
    hydrate(restored, { mutations: [], queries: [] });
    expect(restored.getQueryCache().getAll()).toHaveLength(0);
    expect(
      isAllowlistedPublicQuery(
        queryKeys.public.marketCatalogBootstrap("testnet"),
      ),
    ).toBe(false);
  });

  test("never persists mutation variables or paused private work", () => {
    const source = new QueryClient();
    source.getMutationCache().build(
      source,
      {
        mutationKey: ["private", "signed-action"],
        mutationFn: async () => undefined,
      },
      {
        context: undefined,
        data: undefined,
        error: null,
        failureCount: 0,
        failureReason: null,
        isPaused: true,
        status: "pending",
        variables: { signingMaterial: "must-not-persist" },
        submittedAt: 1,
      },
    );

    const persisted = dehydrate(source, createPublicCacheDehydrateOptions());

    expect(persisted.mutations).toEqual([]);
    expect(JSON.stringify(persisted)).not.toContain("must-not-persist");
  });

  test("selective eviction retains public and destination-owned private data", () => {
    const client = new QueryClient();
    const source = {
      network: "testnet" as const,
      masterAccount: "0xaaa",
      targetAccount: "0xbbb",
    };
    const destination = {
      network: "testnet" as const,
      masterAccount: "0xaaa",
      targetAccount: "0xccc",
    };
    client.setQueryData(queryKeys.public.marketCatalog("mainnet"), "public");
    client.setQueryData(queryKeys.private.accountSnapshot(source), "source");
    client.setQueryData(
      queryKeys.private.accountSnapshot(destination),
      "destination",
    );

    removeIncompatiblePrivateQueries(client, destination);

    expect(
      client.getQueryData<string>(queryKeys.public.marketCatalog("mainnet")),
    ).toBe("public");
    expect(
      client.getQueryData(queryKeys.private.accountSnapshot(source)),
    ).toBeUndefined();
    expect(
      client.getQueryData<string>(
        queryKeys.private.accountSnapshot(destination),
      ),
    ).toBe("destination");
  });
});
