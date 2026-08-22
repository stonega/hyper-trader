import { describe, expect, test } from "bun:test";

import { NATIVE_DUPLICATE } from "../markets/fixture";
import { buildTradeChartOverlays } from "./trade-chart-overlays";
import { createTradeDraft } from "./trade-model";

const context = {
  network: "testnet",
  masterAccount: "0x1111111111111111111111111111111111111111",
  targetAccount: null,
  signer: null,
} as const;

describe("trade chart overlays", () => {
  test("builds exact market, position, order, and bound draft overlays", () => {
    const market = { ...NATIVE_DUPLICATE, midPx: "11", markPx: "10.9" };
    const draft = {
      ...createTradeDraft({ market, context, account: null }),
      orderType: "limit" as const,
      limitPrice: "10.5",
    };
    const orders: Parameters<typeof buildTradeChartOverlays>[0]["openOrders"] =
      [
        {
          coin: market.coin,
          limitPrice: "9.5",
          oid: 7,
          side: "B",
          size: "2",
          timestamp: 1,
        },
        {
          coin: market.coin,
          limitPrice: "8",
          oid: 9,
          side: "A",
          size: "2",
          timestamp: 2,
          isTrigger: true,
          triggerPrice: "12.5",
          triggerCondition: "Price above 12.5",
          orderType: "Take Profit Market",
          isPositionTpsl: true,
          reduceOnly: true,
        },
        {
          coin: "OTHER",
          limitPrice: "20",
          oid: 8,
          side: "A",
          size: "1",
          timestamp: 2,
        },
      ];

    expect(
      buildTradeChartOverlays({
        market,
        lastPrice: "11.1",
        account: {
          availableFunds: { buy: "1", sell: "1" },
          leverage: 5,
          marginMode: "cross",
          positionSize: "2",
          entryPrice: "10",
          liquidationPrice: "4",
          version: 1,
          observedAtMs: 1,
        },
        draft,
        openOrders: orders,
      }).map(({ kind, price }) => [kind, price]),
    ).toEqual([
      ["last", "11.1"],
      ["mark", "10.9"],
      ["entry", "10"],
      ["liquidation", "4"],
      ["open_order", "9.5"],
      ["trigger_order", "12.5"],
      ["draft", "10.5"],
    ]);
  });

  test("does not infer invalid, irrelevant, or flat-position overlays", () => {
    const market = { ...NATIVE_DUPLICATE, midPx: null, markPx: "bad" };
    expect(
      buildTradeChartOverlays({
        market,
        account: {
          availableFunds: { buy: "1", sell: "1" },
          leverage: 5,
          marginMode: "cross",
          positionSize: "0.000",
          entryPrice: "10",
          liquidationPrice: "4",
          version: 1,
          observedAtMs: 1,
        },
        draft: null,
        openOrders: [],
      }),
    ).toEqual([]);
  });

  test("falls back to the validated market mid when the last price is invalid", () => {
    const market = { ...NATIVE_DUPLICATE, midPx: "11", markPx: "11" };
    expect(
      buildTradeChartOverlays({
        market,
        lastPrice: "not-a-price",
        account: null,
        draft: null,
        openOrders: [],
      }).map(({ kind, price: overlayPrice }) => [kind, overlayPrice]),
    ).toEqual([["mid", "11"]]);
  });
});
