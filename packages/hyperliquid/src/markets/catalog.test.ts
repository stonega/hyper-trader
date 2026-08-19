import { describe, expect, test } from "bun:test";

import {
  createPublicHyperliquidClient,
  parseMarketCatalogSnapshot,
} from "../public";
import { CATALOG_RESPONSES } from "./catalog.fixture";

function catalogFetch(): typeof globalThis.fetch {
  return async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as {
      type: string;
      dex?: string;
    };

    if (body.type === "perpDexs") {
      return Response.json(CATALOG_RESPONSES.perpDexs);
    }
    if (body.type === "metaAndAssetCtxs") {
      return Response.json(
        body.dex
          ? CATALOG_RESPONSES[body.dex as "alpha" | "beta"]
          : CATALOG_RESPONSES.native,
      );
    }
    if (body.type === "spotMetaAndAssetCtxs") {
      return Response.json(CATALOG_RESPONSES.spot);
    }
    if (body.type === "outcomeMeta") {
      return Response.json(CATALOG_RESPONSES.outcomes);
    }

    return Response.json({ error: "unexpected request" }, { status: 400 });
  };
}

describe("market catalog discovery", () => {
  test("can return validated native perpetuals without waiting for other core sources", async () => {
    const requests: string[] = [];
    const catalog = await createPublicHyperliquidClient({
      network: "testnet",
      fetch: async (input, init) => {
        const body = JSON.parse(String(init?.body)) as {
          type: string;
          dex?: string;
        };
        requests.push(body.type);
        return catalogFetch()(input, init);
      },
    }).getMarketCatalog({ scope: "native" });

    expect(requests).toEqual(["metaAndAssetCtxs"]);
    expect(catalog.markets.length).toBeGreaterThan(0);
    expect(catalog.markets.every(({ family }) => family === "perp")).toBe(true);
  });

  test("preserves canonical identities and quarantines unsafe records", async () => {
    const catalog = await createPublicHyperliquidClient({
      network: "testnet",
      fetch: catalogFetch(),
    }).getMarketCatalog();

    expect(catalog.markets.map(({ canonicalId }) => canonicalId)).toEqual([
      "perp:0:0",
      "perp:0:1",
      "perp:1:0",
      "perp:1:1",
      "perp:2:0",
      "spot:7",
      "outcome:12:0",
      "outcome:12:1",
    ]);

    const colliding = catalog.markets.filter(
      ({ displaySymbol }) => displaySymbol === "DUP",
    );
    expect(colliding).toHaveLength(4);
    expect(new Set(colliding.map(({ canonicalId }) => canonicalId)).size).toBe(
      4,
    );

    const alpha = catalog.markets.find(
      ({ canonicalId }) => canonicalId === "perp:1:0",
    );
    expect(alpha).toMatchObject({
      dexIndex: 1,
      dexName: "alpha",
      universeIndex: 0,
      orderAssetId: 110_000,
      maxLeverage: 10,
    });

    const isolated = catalog.markets.find(
      ({ canonicalId }) => canonicalId === "perp:1:1",
    );
    expect(isolated).toMatchObject({
      marginMode: "strictIsolated",
      onlyIsolated: true,
    });

    const spot = catalog.markets.find(({ family }) => family === "spot");
    expect(spot).toMatchObject({
      canonicalId: "spot:7",
      orderAssetId: 10_007,
      universeIndex: 7,
      baseToken: { index: 42, tokenId: "0xdup", name: "DUP" },
      quoteToken: {
        index: 0,
        tokenId: "0xusdc",
        name: "USDC",
        evmContract: {
          address: "0x0b80659a4076e9e93c7dbe0f10675a16a3e5c206",
          extraWeiDecimals: -2,
        },
      },
      midPx: "0.20926500001",
    });

    expect(
      catalog.markets.filter(({ family }) => family === "outcome"),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          canonicalId: "outcome:12:0",
          outcome: 12,
          side: 0,
          sideName: "Higher",
          encoding: 120,
          coin: "#120",
          orderAssetId: 100_000_120,
          orderAvailability: "browse_only",
          validationReasons: ["precision_not_provided_by_outcome_metadata"],
          description: "",
        }),
        expect.objectContaining({
          canonicalId: "outcome:12:1",
          side: 1,
          sideName: "Lower",
          encoding: 121,
          coin: "#121",
          orderAssetId: 100_000_121,
        }),
      ]),
    );

    expect(catalog.quarantined).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          canonicalId: "perp:0:2",
          reasons: expect.arrayContaining(["invalid_sz_decimals"]),
        }),
        expect.objectContaining({
          canonicalId: "perp:2:1",
          reasons: expect.arrayContaining(["delisted"]),
        }),
      ]),
    );
    expect(catalog.markets[0]?.markPx).toBe("118001.25000001");

    expect(
      parseMarketCatalogSnapshot(
        JSON.parse(
          JSON.stringify({
            schemaVersion: 1,
            network: "testnet",
            generation: 1,
            publishedAtMs: 1_800_000_000_000,
            markets: catalog.markets,
            quarantined: catalog.quarantined,
            sourceErrors: catalog.sourceErrors,
          }),
        ),
      ).catalog,
    ).toEqual(catalog);
  });

  test("rejects unknown fields in a persisted catalog snapshot", () => {
    expect(() =>
      parseMarketCatalogSnapshot({
        schemaVersion: 1,
        network: "testnet",
        generation: 1,
        publishedAtMs: 1_800_000_000_000,
        markets: [],
        quarantined: [],
        sourceErrors: [],
        privateKey: "must-not-pass",
      }),
    ).toThrow("missing or unknown fields");
  });

  test("returns validated sources when one catalog endpoint fails", async () => {
    const client = createPublicHyperliquidClient({
      network: "testnet",
      fetch: async (input, init) => {
        const body = JSON.parse(String(init?.body)) as {
          type: string;
          dex?: string;
        };
        if (body.type === "spotMetaAndAssetCtxs") {
          return new Response(null, { status: 503 });
        }
        return catalogFetch()(input, init);
      },
    });

    const catalog = await client.getMarketCatalog();
    expect(catalog.markets.some(({ family }) => family === "perp")).toBe(true);
    expect(catalog.markets.some(({ family }) => family === "outcome")).toBe(
      true,
    );
    expect(catalog.markets.some(({ family }) => family === "spot")).toBe(false);
    expect(catalog.sourceErrors).toEqual([
      expect.objectContaining({ source: "spotMetaAndAssetCtxs" }),
    ]);
  });

  test("bounds source concurrency and prioritizes core market coverage", async () => {
    const builderDexCount = 20;
    let activeRequests = 0;
    let maximumActiveRequests = 0;
    const startedSources: string[] = [];
    const requestedDexes: string[] = [];
    const marketContext = {
      dayNtlVlm: "1.0",
      funding: "0.0",
      markPx: "1.0",
      midPx: "1.0",
      openInterest: "1.0",
      oraclePx: "1.0",
      prevDayPx: "1.0",
    };

    const catalog = await createPublicHyperliquidClient({
      network: "testnet",
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as {
          type: string;
          dex?: string;
        };
        if (body.type === "perpDexs") {
          return Response.json([
            null,
            ...Array.from({ length: builderDexCount }, (_, index) => ({
              name: `dex${index}`,
              fullName: `DEX ${index}`,
            })),
          ]);
        }

        const source = `${body.type}:${body.dex ?? "native"}`;
        startedSources.push(source);
        activeRequests += 1;
        maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests);
        await new Promise((resolve) => setTimeout(resolve, 2));
        activeRequests -= 1;

        if (body.type === "metaAndAssetCtxs" && body.dex) {
          requestedDexes.push(body.dex);
          return Response.json([
            {
              universe: [
                {
                  name: `${body.dex}:ASSET`,
                  szDecimals: 2,
                  maxLeverage: 5,
                },
              ],
              marginTables: [],
              collateralToken: 0,
            },
            [marketContext],
          ]);
        }
        if (body.type === "metaAndAssetCtxs") {
          return Response.json(CATALOG_RESPONSES.native);
        }
        if (body.type === "spotMetaAndAssetCtxs") {
          return Response.json(CATALOG_RESPONSES.spot);
        }
        if (body.type === "outcomeMeta") {
          return Response.json(CATALOG_RESPONSES.outcomes);
        }
        return Response.json({ error: "unexpected request" }, { status: 400 });
      },
    }).getMarketCatalog();

    expect(maximumActiveRequests).toBeGreaterThan(1);
    expect(maximumActiveRequests).toBeLessThanOrEqual(8);
    expect(startedSources.slice(0, 3)).toEqual([
      "metaAndAssetCtxs:native",
      "spotMetaAndAssetCtxs:native",
      "outcomeMeta:native",
    ]);
    expect(requestedDexes).toHaveLength(builderDexCount);
    expect(
      catalog.markets.filter(
        (market) => market.family === "perp" && market.dexIndex !== 0,
      ),
    ).toHaveLength(builderDexCount);
    expect(catalog.sourceErrors).toEqual([]);
  });

  test("loads core markets without enumerating builder DEXes", async () => {
    const requestedTypes: string[] = [];
    const catalog = await createPublicHyperliquidClient({
      network: "testnet",
      fetch: async (input, init) => {
        const body = JSON.parse(String(init?.body)) as { type: string };
        requestedTypes.push(body.type);
        return catalogFetch()(input, init);
      },
    }).getMarketCatalog({ scope: "core" });

    expect(requestedTypes).toEqual([
      "metaAndAssetCtxs",
      "spotMetaAndAssetCtxs",
      "outcomeMeta",
    ]);
    expect(catalog.markets.some(({ family }) => family === "perp")).toBe(true);
    expect(catalog.markets.some(({ family }) => family === "spot")).toBe(true);
    expect(catalog.markets.some(({ family }) => family === "outcome")).toBe(
      true,
    );
    expect(
      catalog.markets.some(
        (market) => market.family === "perp" && market.dexIndex !== 0,
      ),
    ).toBe(false);
  });

  test("loads one bounded builder page for server-side incremental sync", async () => {
    const requestedDexes: string[] = [];
    const catalog = await createPublicHyperliquidClient({
      network: "testnet",
      fetch: async (input, init) => {
        const body = JSON.parse(String(init?.body)) as {
          type: string;
          dex?: string;
        };
        if (body.type === "metaAndAssetCtxs" && body.dex) {
          requestedDexes.push(body.dex);
        }
        return catalogFetch()(input, init);
      },
    }).getMarketCatalog({
      scope: "incremental",
      builderDexOffset: 1,
      builderDexLimit: 1,
    });

    expect(requestedDexes).toEqual(["beta"]);
    expect(catalog.builderPage).toEqual({
      offset: 1,
      limit: 1,
      total: 2,
      dexes: [{ index: 2, name: "beta", fullName: "Beta DEX" }],
    });
    expect(
      catalog.markets.filter(
        (market) => market.family === "perp" && market.dexIndex !== 0,
      ),
    ).toEqual([expect.objectContaining({ dexIndex: 2, dexName: "beta" })]);
  });

  test("preserves retry metadata for a rate-limited catalog source", async () => {
    const client = createPublicHyperliquidClient({
      network: "testnet",
      fetch: async (input, init) => {
        const body = JSON.parse(String(init?.body)) as { type: string };
        if (body.type === "spotMetaAndAssetCtxs") {
          return new Response(null, {
            status: 429,
            headers: { "retry-after": "7" },
          });
        }
        return catalogFetch()(input, init);
      },
    });

    const catalog = await client.getMarketCatalog({ scope: "core" });
    expect(catalog.sourceErrors).toEqual([
      expect.objectContaining({
        source: "spotMetaAndAssetCtxs",
        status: 429,
        retryAfterMs: 7_000,
      }),
    ]);
  });

  test("rejects incremental pages that could exceed the shared REST budget", async () => {
    const client = createPublicHyperliquidClient({
      network: "testnet",
      fetch: catalogFetch(),
    });

    await expect(
      client.getMarketCatalog({
        scope: "incremental",
        builderDexOffset: 0,
        builderDexLimit: 38,
      }),
    ).rejects.toThrow("between 1 and 37");
  });

  test("propagates cancellation and never starts queued catalog sources", async () => {
    const builderDexCount = 20;
    const controller = new AbortController();
    const startedSources: string[] = [];
    let activeRequests = 0;
    let notifyStarted: (() => void) | undefined;
    const firstBatchStarted = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    const client = createPublicHyperliquidClient({
      network: "testnet",
      timeoutMs: 60_000,
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as {
          type: string;
          dex?: string;
        };
        if (body.type === "perpDexs") {
          return Response.json([
            null,
            ...Array.from({ length: builderDexCount }, (_, index) => ({
              name: `dex${index}`,
              fullName: null,
            })),
          ]);
        }

        startedSources.push(`${body.type}:${body.dex ?? "native"}`);
        activeRequests += 1;
        if (activeRequests === 8) notifyStarted?.();
        return await new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal?.aborted) {
            reject(signal.reason);
            return;
          }
          signal?.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        });
      },
    });

    const pending = client.getMarketCatalog({ signal: controller.signal });
    await firstBatchStarted;
    controller.abort(new DOMException("test cancellation", "AbortError"));

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(startedSources).toHaveLength(8);
  });

  test("does not request testnet-only outcomes on mainnet", async () => {
    const requestedTypes: string[] = [];
    const client = createPublicHyperliquidClient({
      network: "mainnet",
      fetch: async (input, init) => {
        const body = JSON.parse(String(init?.body)) as { type: string };
        requestedTypes.push(body.type);
        return catalogFetch()(input, init);
      },
    });

    const catalog = await client.getMarketCatalog();
    expect(requestedTypes).not.toContain("outcomeMeta");
    expect(catalog.markets.some(({ family }) => family === "outcome")).toBe(
      false,
    );
    expect(catalog.sourceErrors).toEqual([]);
  });
});
