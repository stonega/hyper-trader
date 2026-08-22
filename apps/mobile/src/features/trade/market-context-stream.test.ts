import { describe, expect, test } from "bun:test";

import {
  createTradeMarketContextWire,
  marketContextBaselineFromStream,
  marketContextFromMarket,
  marketContextFromStreamMessage,
} from "./market-context-stream";

describe("Trade market-context stream", () => {
  test("decodes validated selected-market context", () => {
    const wire = createTradeMarketContextWire("context", "BTC");
    const [message] = wire.decode({
      channel: "activeAssetCtx",
      data: {
        coin: "BTC",
        ctx: {
          markPx: "101",
          midPx: "100",
          funding: "0.0001",
          openInterest: "20",
        },
      },
    });
    if (!message) throw new Error("Expected a market-context message.");

    expect(wire.subscription).toEqual({ type: "activeAssetCtx", coin: "BTC" });
    expect(marketContextFromStreamMessage(message).markPx).toBe("101");
  });

  test("ignores another market and rejects malformed selected data", () => {
    const wire = createTradeMarketContextWire("context", "BTC");
    expect(
      wire.decode({
        channel: "activeAssetCtx",
        data: { coin: "ETH", ctx: { markPx: "1" } },
      }),
    ).toEqual([]);
    expect(() =>
      wire.decode({
        channel: "activeAssetCtx",
        data: { coin: "BTC", ctx: { markPx: null } },
      }),
    ).toThrow("expected a decimal string");
  });

  test("creates and validates a normalized catalog baseline", () => {
    const context = marketContextFromMarket({
      family: "perp",
      markPx: "100",
      midPx: "99",
    } as never);
    expect(marketContextBaselineFromStream(context)).toEqual({
      markPx: "100",
      midPx: "99",
    });
  });
});
