import { describe, expect, test } from "bun:test";
import {
  MarketSummaryGenerationChangedError,
  type MarketSummaryPage,
  type MarketSummaryQuery,
} from "@hyper-trader/hyperliquid/public";

import type { DevelopmentMarketCatalogClient } from "./catalog-client";
import { HIP3_DUPLICATE, NATIVE_DUPLICATE } from "./fixture";
import {
  createDevelopmentMarketSummaryClient,
  createMarketSummaryBackendClient,
} from "./summary-client";

const QUERY: MarketSummaryQuery = {
  query: "btc",
  family: "perp",
  includeHip3: false,
  availability: "enabled",
  lifecycle: "active",
  sort: "volume",
  ids: ["perp:0:0"],
  cursor: null,
  limit: 24,
};

const PAGE: MarketSummaryPage = {
  schemaVersion: 1,
  network: "testnet",
  generation: 3,
  publishedAtMs: 1_800_000_000_000,
  items: [
    {
      family: "perp",
      canonicalId: "perp:0:0",
      displaySymbol: "BTC",
      coin: "BTC",
      lifecycle: "active",
      orderAvailability: "enabled",
      pricePrecision: { maxSignificantFigures: 5, maxDecimalPlaces: 4 },
      dayNtlVlm: "100",
      markPx: "1",
      dexIndex: 0,
      dexName: "",
      dexFullName: null,
      maxLeverage: 20,
    },
  ],
  total: 1,
  nextCursor: null,
  quarantinedCount: 0,
  sourceErrorCount: 0,
};

describe("mobile market summary client", () => {
  test("requests and validates only the selected market page", async () => {
    let requested: Request | undefined;
    const client = createMarketSummaryBackendClient({
      origin: "https://notify.example.com",
      fetch: (async (input) => {
        requested = input as Request;
        return Response.json(PAGE);
      }) as typeof globalThis.fetch,
    });

    await expect(client.read("testnet", QUERY)).resolves.toEqual(PAGE);
    const url = new URL(requested?.url ?? "");
    expect(url.pathname).toBe("/v1/market-summaries/testnet");
    expect(url.searchParams.get("limit")).toBe("24");
    expect(url.searchParams.get("query")).toBe("btc");
    expect(url.searchParams.get("family")).toBe("perp");
    expect(url.searchParams.get("includeHip3")).toBe("false");
    expect(url.searchParams.getAll("id")).toEqual(["perp:0:0"]);
  });

  test("signals a stale generation so pagination can restart", async () => {
    const client = createMarketSummaryBackendClient({
      origin: "https://notify.example.com",
      fetch: (async () =>
        Response.json(
          { error: "generation_changed" },
          { status: 409 },
        )) as unknown as typeof globalThis.fetch,
    });

    await expect(client.read("testnet", QUERY)).rejects.toBeInstanceOf(
      MarketSummaryGenerationChangedError,
    );
  });

  test("caches development discovery and pages it locally", async () => {
    let reads = 0;
    const development: DevelopmentMarketCatalogClient = {
      readBootstrap: async () => {
        throw new Error("bootstrap must not be used");
      },
      read: async () => {
        reads += 1;
        return {
          markets: [NATIVE_DUPLICATE, HIP3_DUPLICATE],
          quarantined: [],
          sourceErrors: [],
        };
      },
    };
    const client = createDevelopmentMarketSummaryClient(
      development,
      () => 1_800_000_000_000,
    );
    const first = await client.read("testnet", {
      ...QUERY,
      query: "",
      includeHip3: true,
      ids: [],
      limit: 1,
    });
    const second = await client.read("testnet", {
      ...QUERY,
      query: "",
      includeHip3: true,
      ids: [],
      cursor: first.nextCursor,
      limit: 1,
    });

    expect(first.items).toHaveLength(1);
    expect(second.items).toHaveLength(1);
    expect(reads).toBe(1);
  });

  test("can reuse the shared catalog query instead of starting another read", async () => {
    let directReads = 0;
    let sharedReads = 0;
    const development: DevelopmentMarketCatalogClient = {
      readBootstrap: async () => {
        throw new Error("bootstrap must not be used");
      },
      read: async () => {
        directReads += 1;
        return {
          markets: [NATIVE_DUPLICATE],
          quarantined: [],
          sourceErrors: [],
        };
      },
    };
    const client = createDevelopmentMarketSummaryClient(
      development,
      () => 1_800_000_000_000,
      async () => {
        sharedReads += 1;
        return {
          markets: [HIP3_DUPLICATE],
          quarantined: [],
          sourceErrors: [],
        };
      },
    );

    const page = await client.read("testnet", {
      ...QUERY,
      query: "",
      family: null,
      includeHip3: true,
      ids: [],
    });

    expect(page.items.map((market) => market.canonicalId)).toEqual([
      HIP3_DUPLICATE.canonicalId,
    ]);
    expect(sharedReads).toBe(1);
    expect(directReads).toBe(0);
  });
});
