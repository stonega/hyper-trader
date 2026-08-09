import { describe, expect, test } from "bun:test";

import { createPublicHyperliquidClient } from "../public";
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
      quoteToken: { index: 0, tokenId: "0xusdc", name: "USDC" },
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
