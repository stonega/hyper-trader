import { describe, expect, test } from "bun:test";

import { createPublicHyperliquidClient } from "./public";

describe("public market reads", () => {
  test("validates typed reads and preserves decimal strings", async () => {
    const bodies: Record<string, unknown>[] = [];
    const responses: Record<string, unknown> = {
      allMids: { "alpha:DUP": "1.0000000000000001" },
      candleSnapshot: [
        {
          t: 1,
          T: 2,
          s: "alpha:DUP",
          i: "1m",
          o: "1.0000000000000001",
          c: "1.0000000000000002",
          h: "1.0000000000000003",
          l: "1.0000000000000000",
          v: "3.0000000000000001",
          n: 4,
          futureField: true,
        },
      ],
      l2Book: {
        coin: "alpha:DUP",
        time: 3,
        levels: [
          [{ px: "1.0000000000000001", sz: "2.0000000000000001", n: 1 }],
          [{ px: "1.0000000000000002", sz: "3.0000000000000001", n: 2 }],
        ],
      },
      recentTrades: [
        {
          coin: "alpha:DUP",
          side: "B",
          px: "1.0000000000000001",
          sz: "2.0000000000000001",
          time: 4,
          hash: "0xtrade",
          tid: 5,
        },
      ],
      fundingHistory: [
        {
          coin: "alpha:DUP",
          fundingRate: "0.0000000000000001",
          premium: "0.0000000000000002",
          time: 6,
        },
      ],
    };
    const client = createPublicHyperliquidClient({
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as Record<
          string,
          unknown
        > & {
          type: string;
        };
        bodies.push(body);
        return Response.json(responses[body.type]);
      },
    });

    const [mids, candles, book, trades, funding] = await Promise.all([
      client.getAllMids({ dex: "alpha" }),
      client.getCandles({
        coin: "alpha:DUP",
        interval: "1m",
        startTime: 1,
        endTime: 2,
      }),
      client.getL2Book({ coin: "alpha:DUP", nSigFigs: 5, mantissa: 2 }),
      client.getRecentTrades("alpha:DUP"),
      client.getFundingHistory({ coin: "alpha:DUP", startTime: 0 }),
    ]);

    expect(mids[0]?.price).toBe("1.0000000000000001");
    expect(candles[0]?.close).toBe("1.0000000000000002");
    expect(book.asks[0]?.size).toBe("3.0000000000000001");
    expect(trades[0]?.price).toBe("1.0000000000000001");
    expect(funding[0]?.fundingRate).toBe("0.0000000000000001");
    expect(bodies).toContainEqual({ type: "allMids", dex: "alpha" });
    expect(bodies).toContainEqual({
      type: "candleSnapshot",
      req: {
        coin: "alpha:DUP",
        interval: "1m",
        startTime: 1,
        endTime: 2,
      },
    });
    expect(bodies).toContainEqual({
      type: "l2Book",
      coin: "alpha:DUP",
      nSigFigs: 5,
      mantissa: 2,
    });
  });

  test("rejects malformed public payloads", async () => {
    const client = createPublicHyperliquidClient({
      fetch: async () => Response.json({ coin: "BTC", time: 1, levels: [[]] }),
    });
    await expect(client.getL2Book({ coin: "BTC" })).rejects.toThrow(
      "expected bid and ask levels",
    );
  });

  test("rejects candle rows that do not match the requested series", async () => {
    const validCandle = {
      t: 1,
      T: 2,
      s: "BTC",
      i: "15m",
      o: "10",
      c: "11",
      h: "12",
      l: "9",
      v: "3",
      n: 4,
    };
    const client = createPublicHyperliquidClient({
      fetch: async () => Response.json([{ ...validCandle, i: "unknown" }]),
    });
    await expect(
      client.getCandles({ coin: "BTC", interval: "15m", startTime: 1 }),
    ).rejects.toThrow("expected a supported candle interval");

    const mismatchedClient = createPublicHyperliquidClient({
      fetch: async () => Response.json([{ ...validCandle, s: "ETH" }]),
    });
    await expect(
      mismatchedClient.getCandles({
        coin: "BTC",
        interval: "15m",
        startTime: 1,
      }),
    ).rejects.toThrow("expected requested coin BTC");
  });
});
