import { describe, expect, test } from "bun:test";

import {
  createHyperliquidClient,
  HyperliquidApiError,
  parseAllMids,
} from "./index";

describe("parseAllMids", () => {
  test("returns sorted prices without losing decimal precision", () => {
    expect(parseAllMids({ ETH: "4231.125", BTC: "118001.25" })).toEqual([
      { symbol: "BTC", price: "118001.25" },
      { symbol: "ETH", price: "4231.125" },
    ]);
  });

  test("rejects malformed prices", () => {
    expect(() => parseAllMids({ BTC: null })).toThrow(
      "Hyperliquid returned an invalid mid price for BTC.",
    );
  });
});

describe("createHyperliquidClient", () => {
  test("posts an allMids request to the selected network", async () => {
    let requestUrl = "";
    let requestInit: RequestInit | undefined;
    const client = createHyperliquidClient({
      network: "testnet",
      fetch: async (input, init) => {
        requestUrl = String(input);
        requestInit = init;
        return Response.json({ ETH: "4000.5" });
      },
    });

    await expect(client.getAllMids()).resolves.toEqual([
      { symbol: "ETH", price: "4000.5" },
    ]);
    expect(requestUrl).toBe("https://api.hyperliquid-testnet.xyz/info");
    expect(requestInit?.method).toBe("POST");
    expect(requestInit?.body).toBe(JSON.stringify({ type: "allMids" }));
  });

  test("reports non-success API responses", async () => {
    const client = createHyperliquidClient({
      fetch: async () => new Response(null, { status: 429 }),
    });

    await expect(client.getAllMids()).rejects.toBeInstanceOf(
      HyperliquidApiError,
    );
  });
});
