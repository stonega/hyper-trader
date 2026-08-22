import { describe, expect, test } from "bun:test";
import type {
  HyperliquidNetwork,
  MarketCatalog,
} from "@hyper-trader/hyperliquid/public";
import {
  createDevelopmentTestnetMarketCatalogClient,
  createMarketCatalogBackendClient,
  type DevelopmentMarketCatalogClient,
  loadMarketCatalog,
  type MarketCatalogBackendClient,
} from "./catalog-client";
import { NATIVE_DUPLICATE } from "./fixture";

const EMPTY_CATALOG: MarketCatalog = {
  markets: [],
  quarantined: [],
  sourceErrors: [],
};
const VALID_CATALOG: MarketCatalog = {
  ...EMPTY_CATALOG,
  markets: [NATIVE_DUPLICATE],
};

describe("mobile market catalog backend", () => {
  test("validates the generation-pinned backend response", async () => {
    const requested: string[] = [];
    const client = createMarketCatalogBackendClient({
      origin: "https://notify.example.com",
      fetch: (async (input) => {
        requested.push(input instanceof Request ? input.url : input.toString());
        return Response.json(
          {
            schemaVersion: 1,
            network: "testnet",
            generation: 3,
            publishedAtMs: 1_800_000_000_000,
            markets: VALID_CATALOG.markets,
            quarantined: [],
            sourceErrors: [],
          },
          { headers: { etag: '"market-catalog-testnet-3"' } },
        );
      }) as typeof globalThis.fetch,
    });

    expect(await client.read("testnet")).toEqual(VALID_CATALOG);
    expect(requested).toEqual([
      "https://notify.example.com/v1/market-catalog/testnet",
    ]);
  });

  test("requires the backend and never falls back to direct catalog discovery", async () => {
    const backend: MarketCatalogBackendClient = {
      read: async () => VALID_CATALOG,
    };

    expect(await loadMarketCatalog({ network: "testnet", backend })).toEqual(
      VALID_CATALOG,
    );
    await expect(
      loadMarketCatalog({
        network: "testnet",
        backend: null,
      }),
    ).rejects.toThrow("not configured");
  });

  test("allows an explicitly injected development catalog only when configured by the caller", async () => {
    const calls: HyperliquidNetwork[] = [];
    const development: DevelopmentMarketCatalogClient = {
      readBootstrap: async (network) => {
        calls.push(network);
        return VALID_CATALOG;
      },
      read: async (network) => {
        calls.push(network);
        return VALID_CATALOG;
      },
    };

    await expect(
      loadMarketCatalog({
        network: "testnet",
        backend: null,
        development,
      }),
    ).resolves.toEqual(VALID_CATALOG);
    expect(calls).toEqual(["testnet"]);
  });

  test("development bootstrap reads only bounded testnet core metadata", async () => {
    const requests: unknown[] = [];
    const client = createDevelopmentTestnetMarketCatalogClient({
      client: {
        getMarketCatalog: async (options) => {
          requests.push(options);
          return VALID_CATALOG;
        },
      },
    });

    await expect(client.readBootstrap("testnet")).resolves.toEqual({
      ...VALID_CATALOG,
      sourceErrors: [expect.objectContaining({ source: "backendCatalog" })],
    });
    await expect(client.read("testnet")).resolves.toEqual({
      ...VALID_CATALOG,
      sourceErrors: [expect.objectContaining({ source: "backendCatalog" })],
    });
    expect(requests).toEqual([
      { scope: "native", signal: undefined },
      { scope: "core", signal: undefined },
    ]);
    await expect(client.readBootstrap("mainnet")).rejects.toThrow(
      "testnet-only",
    );
    await expect(client.read("mainnet")).rejects.toThrow("testnet-only");
  });

  test("reuses a validated generation after a conditional 304", async () => {
    const headers: (string | null)[] = [];
    let requests = 0;
    const client = createMarketCatalogBackendClient({
      origin: "https://notify.example.com",
      fetch: (async (input) => {
        const request = input as Request;
        headers.push(request.headers.get("if-none-match"));
        requests += 1;
        if (requests === 2) return new Response(null, { status: 304 });
        return Response.json(
          {
            schemaVersion: 1,
            network: "testnet",
            generation: 3,
            publishedAtMs: 1_800_000_000_000,
            markets: VALID_CATALOG.markets,
            quarantined: [],
            sourceErrors: [],
          },
          { headers: { etag: '"market-catalog-testnet-3"' } },
        );
      }) as typeof globalThis.fetch,
    });

    expect(await client.read("testnet")).toEqual(VALID_CATALOG);
    expect(await client.read("testnet")).toEqual(VALID_CATALOG);
    expect(headers).toEqual([null, '"market-catalog-testnet-3"']);
  });

  test("rejects a cross-network backend response", async () => {
    const client = createMarketCatalogBackendClient({
      origin: "https://notify.example.com",
      fetch: (async (_input) =>
        Response.json(
          {
            schemaVersion: 1,
            network: "mainnet",
            generation: 3,
            publishedAtMs: 1_800_000_000_000,
            markets: [],
            quarantined: [],
            sourceErrors: [],
          },
          { headers: { etag: '"market-catalog-mainnet-3"' } },
        )) as typeof globalThis.fetch,
    });

    await expect(client.read("testnet")).rejects.toThrow("wrong network");
  });

  test("rejects an empty backend generation", async () => {
    const client = createMarketCatalogBackendClient({
      origin: "https://notify.example.com",
      fetch: (async (_input) =>
        Response.json(
          {
            schemaVersion: 1,
            network: "testnet",
            generation: 3,
            publishedAtMs: 1_800_000_000_000,
            markets: [],
            quarantined: [],
            sourceErrors: [],
          },
          { headers: { etag: '"market-catalog-testnet-3"' } },
        )) as typeof globalThis.fetch,
    });

    await expect(client.read("testnet")).rejects.toThrow(
      "no validated markets",
    );
  });
});
