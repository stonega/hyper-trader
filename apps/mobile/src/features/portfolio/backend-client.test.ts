import { describe, expect, test } from "bun:test";

import { createPortfolioBackendClient } from "./backend-client";

const USER = `0x${"1".repeat(40)}`;
const summary = {
  accountValue: "10",
  totalNtlPos: "0",
  totalRawUsd: "10",
  totalMarginUsed: "0",
};

describe("Portfolio backend client", () => {
  test("keeps the address out of the URL and validates the response identity", async () => {
    let observed: Request | null = null;
    const fetchRequest = (async (input: string | URL | Request) => {
      observed = input instanceof Request ? input : new Request(input);
      return Response.json(
        {
          schemaVersion: 1,
          network: "testnet",
          user: USER,
          generatedAtMs: 20,
          dexes: [
            {
              dex: "",
              clearinghouse: {
                assetPositions: [],
                crossMaintenanceMarginUsed: "0",
                crossMarginSummary: summary,
                marginSummary: summary,
                time: 10,
                withdrawable: "10",
              },
              openOrders: [],
            },
          ],
          spot: { balances: [] },
          sourceGaps: [],
        },
        { headers: { "cache-control": "private, no-store" } },
      );
    }) as typeof globalThis.fetch;
    const client = createPortfolioBackendClient({
      origin: "https://backend.example.com",
      fetch: fetchRequest,
    });

    const result = await client.readLive("testnet", USER);
    const request = observed as Request | null;
    if (!request) throw new Error("Expected a backend request.");
    expect(request.url).toBe(
      "https://backend.example.com/v1/portfolio-snapshots/live",
    );
    expect(request.url).not.toContain(USER);
    expect(await request.clone().json()).toEqual({
      network: "testnet",
      user: USER,
    });
    expect(result.dexes[0]?.clearinghouse.positions).toEqual([]);
  });

  test("sends and validates the exact mainnet account scope", async () => {
    let observed: Request | null = null;
    const client = createPortfolioBackendClient({
      origin: "https://backend.example.com",
      fetch: (async (input: string | URL | Request) => {
        observed = input instanceof Request ? input : new Request(input);
        return Response.json(
          {
            schemaVersion: 1,
            network: "mainnet",
            user: USER,
            generatedAtMs: 20,
            dexes: [
              {
                dex: "",
                clearinghouse: {
                  assetPositions: [],
                  crossMaintenanceMarginUsed: "0",
                  crossMarginSummary: summary,
                  marginSummary: summary,
                  time: 10,
                  withdrawable: "10",
                },
                openOrders: [],
              },
            ],
            spot: { balances: [] },
            sourceGaps: [],
          },
          { headers: { "cache-control": "private, no-store" } },
        );
      }) as typeof globalThis.fetch,
    });

    const result = await client.readLive("mainnet", USER);
    const request = observed as Request | null;
    if (!request) throw new Error("Expected a backend request.");
    expect(await request.clone().json()).toEqual({
      network: "mainnet",
      user: USER,
    });
    expect(result.network).toBe("mainnet");
    expect(result.user).toBe(USER);
  });

  test("rejects non-HTTPS origins and cacheable account responses", async () => {
    expect(() =>
      createPortfolioBackendClient({ origin: "http://backend.example.com" }),
    ).toThrow("exact HTTPS origin");
    const client = createPortfolioBackendClient({
      origin: "https://backend.example.com",
      fetch: (async () =>
        Response.json({})) as unknown as typeof globalThis.fetch,
    });
    await expect(client.readLive("testnet", USER)).rejects.toThrow(
      "response is invalid",
    );
  });
});
