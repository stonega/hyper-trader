import { describe, expect, test } from "bun:test";

import { createPublicHyperliquidClient } from "./public";

describe("public account monitoring snapshot", () => {
  test("fetches and validates the authoritative account baseline through the public entry", async () => {
    const requests: Record<string, unknown>[] = [];
    const client = createPublicHyperliquidClient({
      network: "testnet",
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        requests.push(body);
        if (body.type === "clearinghouseState") {
          return Response.json({
            assetPositions: [],
            crossMaintenanceMarginUsed: "0",
            crossMarginSummary: {
              accountValue: "100.0000000000000001",
              totalNtlPos: "0",
              totalRawUsd: "100.0000000000000001",
              totalMarginUsed: "0",
            },
            marginSummary: {
              accountValue: "100.0000000000000001",
              totalNtlPos: "0",
              totalRawUsd: "100.0000000000000001",
              totalMarginUsed: "0",
            },
            time: 100,
            withdrawable: "100.0000000000000001",
          });
        }
        if (body.type === "openOrders") return Response.json([]);
        if (body.type === "historicalOrders") return Response.json([]);
        if (body.type === "userFills") return Response.json([]);
        if (body.type === "userFunding") return Response.json([]);
        throw new Error("unexpected request");
      },
    });
    const user = `0x${"11".repeat(20)}`;
    const snapshot = await client.getNotificationAccountSnapshot({
      user,
      dex: "",
      fundingStartTime: 1,
    });
    expect(snapshot.clearinghouse.marginSummary.accountValue).toBe(
      "100.0000000000000001",
    );
    expect(requests.map((request) => request.type).sort()).toEqual([
      "clearinghouseState",
      "historicalOrders",
      "openOrders",
      "userFills",
      "userFunding",
    ]);
    expect(requests.every((request) => request.user === user)).toBe(true);
  });

  test("rejects ambiguous or noncanonical account input before transport", async () => {
    let calls = 0;
    const client = createPublicHyperliquidClient({
      fetch: async () => {
        calls += 1;
        return Response.json({});
      },
    });
    await expect(
      client.getNotificationAccountSnapshot({
        user: `0X${"11".repeat(20)}`,
        dex: "",
        fundingStartTime: 1,
      }),
    ).rejects.toThrow("account");
    expect(calls).toBe(0);
  });
});
