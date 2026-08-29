import { describe, expect, test } from "bun:test";

import { MAINNET_TRADING_RELEASE_STAGE } from "../signing/boundary";
import { validateTradingAction } from "./validation";

const context = {
  network: "testnet" as const,
  masterAccount: "0x1111111111111111111111111111111111111111",
  targetAccount: "0x2222222222222222222222222222222222222222",
  capturedContextEpoch: 7,
  currentContextEpoch: 7,
  currentNetwork: "testnet" as const,
  currentMasterAccount: "0x1111111111111111111111111111111111111111",
  currentTargetAccount: "0x2222222222222222222222222222222222222222",
  reviewedAtMs: 1_725_000_000_000,
  reviewExpiresAtMs: 1_725_000_030_000,
  nowMs: 1_725_000_001_000,
};

const market = {
  canonicalId: "perp:BTC",
  metadataFingerprint: "metadata-v1",
  orderAssetId: 0,
  family: "perp" as const,
  lifecycle: "active" as const,
  orderAvailability: "enabled" as const,
  sizeDecimals: 3,
  pricePrecision: { maxSignificantFigures: 5 as const, maxDecimalPlaces: 2 },
  maxLeverage: 25,
  onlyIsolated: false,
  referencePrice: "100",
  minimumNotional: "10",
};

describe("action boundary validation", () => {
  test("normalizes a decimal-safe limit order against current context", () => {
    const result = validateTradingAction({
      context,
      market,
      account: {
        availableMargin: "1000",
        leverage: 5,
        positionSize: "0",
        version: 4,
      },
      controls: { slippageBps: null, trigger: null },
      intent: {
        type: "limit_order",
        assetId: 0,
        side: "buy",
        size: "0.100",
        limitPrice: "100.00",
        timeInForce: "Gtc",
        reduceOnly: false,
        cloid: "0x00000000000000000000000000000001",
      },
    });

    expect(result.intent.size).toBe("0.1");
    expect(
      result.intent.type === "limit_order" && result.intent.limitPrice,
    ).toBe("100");
    expect(result.notional).toBe("10");
  });

  test("reports the exact minimum-notional message", () => {
    expect(() =>
      validateTradingAction({
        context,
        market,
        account: {
          availableMargin: "1000",
          leverage: 5,
          marginMode: "cross",
          positionSize: "0",
          version: 4,
        },
        controls: { slippageBps: null, trigger: null },
        intent: {
          type: "limit_order",
          assetId: 0,
          side: "buy",
          size: "0.099",
          limitPrice: "100",
          timeInForce: "Gtc",
          reduceOnly: false,
          cloid: "0x0000000000000000000000000000000a",
        },
      }),
    ).toThrow("Order must have minimum value of $10.");
  });

  test("accepts integer prices while rejecting forged precision metadata", () => {
    const input = {
      context,
      market,
      account: {
        availableMargin: "100000",
        leverage: 5,
        marginMode: "cross" as const,
        positionSize: "0",
        version: 4,
      },
      controls: { slippageBps: null, trigger: null },
      intent: {
        type: "limit_order" as const,
        assetId: 0,
        side: "buy" as const,
        size: "0.1",
        limitPrice: "100000",
        timeInForce: "Gtc" as const,
        reduceOnly: false,
        cloid: "0x00000000000000000000000000000007",
      },
    };
    expect(validateTradingAction(input).intent).toMatchObject({
      limitPrice: "100000",
    });
    expect(() =>
      validateTradingAction({
        ...input,
        market: {
          ...market,
          pricePrecision: {
            maxSignificantFigures: 5,
            maxDecimalPlaces: 8,
          },
        },
      }),
    ).toThrow("precision");
  });

  test.each([
    [
      "notional",
      { availableMargin: "1" },
      { slippageBps: null, trigger: null },
    ],
    ["slippage", {}, { slippageBps: 10, trigger: null }],
    [
      "trigger",
      {},
      { slippageBps: null, trigger: { price: "101", direction: "above" } },
    ],
  ] as const)(
    "rejects invalid applicable %s state",
    (_label, accountMutation, controls) => {
      expect(() =>
        validateTradingAction({
          context,
          market,
          account: {
            availableMargin: "1000",
            leverage: 5,
            marginMode: "cross",
            positionSize: "0",
            version: 4,
            ...accountMutation,
          },
          controls: controls as never,
          intent: {
            type: "limit_order",
            assetId: 0,
            side: "buy",
            size: "0.1",
            limitPrice: "100",
            timeInForce: "Gtc",
            reduceOnly: false,
            cloid: "0x00000000000000000000000000000008",
          },
        }),
      ).toThrow();
    },
  );

  test("rejects extraneous intent fields and unavailable markets", () => {
    const input = {
      context,
      market,
      account: {
        availableMargin: "1000",
        leverage: 5,
        marginMode: "cross" as const,
        positionSize: "0",
        version: 4,
      },
      controls: { slippageBps: null, trigger: null },
      intent: {
        type: "limit_order" as const,
        assetId: 0,
        side: "buy" as const,
        size: "0.1",
        limitPrice: "100",
        timeInForce: "Gtc" as const,
        reduceOnly: false,
        cloid: "0x00000000000000000000000000000009",
      },
    };
    expect(() =>
      validateTradingAction({
        ...input,
        intent: { ...input.intent, aggressiveLimitPrice: "101" } as never,
      }),
    ).toThrow("fields");
    expect(() =>
      validateTradingAction({
        ...input,
        market: { ...market, lifecycle: "delisted" },
      }),
    ).toThrow("available");
  });

  test("rejects precision drift and applies the compile-owned mainnet stage", () => {
    expect(() =>
      validateTradingAction({
        context,
        market: { ...market, sizeDecimals: 2 },
        account: {
          availableMargin: "1000",
          leverage: 5,
          positionSize: "0",
          version: 5,
        },
        controls: { slippageBps: null, trigger: null },
        intent: {
          type: "limit_order",
          assetId: 0,
          side: "buy",
          size: "0.001",
          limitPrice: "100",
          timeInForce: "Gtc",
          reduceOnly: false,
          cloid: "0x00000000000000000000000000000002",
        },
      }),
    ).toThrow("size");

    const validateMainnet = () =>
      validateTradingAction({
        context: {
          ...context,
          network: "mainnet",
          currentNetwork: "mainnet",
        },
        market,
        account: {
          availableMargin: "1000",
          leverage: 1,
          positionSize: "0",
          version: 5,
        },
        controls: { slippageBps: 50, trigger: null },
        intent: {
          type: "market_order",
          assetId: 0,
          side: "buy",
          size: "1",
          aggressiveLimitPrice: "100.5",
          cloid: "0x00000000000000000000000000000003",
        },
      });
    if (MAINNET_TRADING_RELEASE_STAGE === "preactivation") {
      expect(validateMainnet).toThrow("mainnet");
    } else {
      expect(validateMainnet).not.toThrow();
    }
  });

  test("requires a full opposite-side reduce-only close", () => {
    expect(() =>
      validateTradingAction({
        context,
        market,
        account: {
          availableMargin: "100",
          leverage: 5,
          positionSize: "2",
          version: 5,
        },
        controls: { slippageBps: 100, trigger: null },
        intent: {
          type: "reduce_only_close",
          assetId: 0,
          side: "sell",
          size: "1",
          aggressiveLimitPrice: "99",
          cloid: "0x00000000000000000000000000000004",
        },
      }),
    ).toThrow("full position size");
  });

  test("validates a position-linked take-profit create and stop-loss edit", () => {
    const base = {
      context,
      market,
      account: {
        availableMargin: "100",
        leverage: 5,
        marginMode: "cross" as const,
        positionSize: "2",
        version: 5,
      },
    };
    const takeProfit = validateTradingAction({
      ...base,
      controls: {
        slippageBps: 500,
        trigger: { price: "110", direction: "above" as const },
      },
      intent: {
        type: "position_tpsl",
        assetId: 0,
        side: "sell",
        size: "2.000",
        triggerPrice: "110.00",
        aggressiveLimitPrice: "104.5",
        triggerKind: "take_profit",
        existingOid: null,
        cloid: "0x0000000000000000000000000000000b",
      },
    });
    expect(takeProfit.intent).toMatchObject({
      type: "position_tpsl",
      triggerPrice: "110",
      aggressiveLimitPrice: "104.5",
      size: "2",
    });

    expect(() =>
      validateTradingAction({
        ...base,
        account: {
          ...base.account,
          openOrders: [{ assetId: 0, oid: 77 }],
        },
        controls: {
          slippageBps: 500,
          trigger: { price: "90", direction: "below" },
        },
        intent: {
          type: "position_tpsl",
          assetId: 0,
          side: "sell",
          size: "2",
          triggerPrice: "90",
          aggressiveLimitPrice: "85.5",
          triggerKind: "stop_loss",
          existingOid: 77,
          cloid: "0x0000000000000000000000000000000c",
        },
      }),
    ).not.toThrow();
  });

  test("rejects unsafe protective-order direction, size, and stale edits", () => {
    const input = {
      context,
      market,
      account: {
        availableMargin: "100",
        leverage: 5,
        positionSize: "2",
        version: 5,
      },
      controls: {
        slippageBps: 500,
        trigger: { price: "90", direction: "below" as const },
      },
      intent: {
        type: "position_tpsl" as const,
        assetId: 0,
        side: "sell" as const,
        size: "2",
        triggerPrice: "90",
        aggressiveLimitPrice: "85.5",
        triggerKind: "take_profit" as const,
        existingOid: null,
        cloid: "0x0000000000000000000000000000000d" as const,
      },
    };
    expect(() => validateTradingAction(input)).toThrow("direction");
    expect(() =>
      validateTradingAction({
        ...input,
        controls: {
          ...input.controls,
          trigger: { price: "110", direction: "above" },
        },
        intent: { ...input.intent, triggerPrice: "110", size: "1" },
      }),
    ).toThrow("full position size");
    expect(() =>
      validateTradingAction({
        ...input,
        controls: {
          ...input.controls,
          trigger: { price: "110", direction: "above" },
        },
        intent: {
          ...input.intent,
          triggerPrice: "110",
          aggressiveLimitPrice: "104.5",
          existingOid: 77,
        },
      }),
    ).toThrow("no longer open");
  });

  test("requires an explicit exact current context", () => {
    const forged = {
      context: { ...context },
      market,
      account: {
        availableMargin: "1000",
        leverage: 5,
        positionSize: "0",
        version: 4,
      },
      controls: { slippageBps: null, trigger: null },
      intent: {
        type: "limit_order",
        assetId: 0,
        side: "buy",
        size: "0.1",
        limitPrice: "100",
        timeInForce: "Gtc",
        reduceOnly: false,
        cloid: "0x00000000000000000000000000000005",
      },
    };
    delete (forged.context as Partial<typeof context>).currentTargetAccount;
    expect(() =>
      validateTradingAction(
        forged as unknown as Parameters<typeof validateTradingAction>[0],
      ),
    ).toThrow("currentTargetAccount");
  });

  test.each([
    ["side", { side: "hold" }],
    ["timeInForce", { timeInForce: "Never" }],
    ["reduceOnly", { reduceOnly: "yes" }],
  ] as const)("rejects forged order discriminator %s", (_label, mutation) => {
    expect(() =>
      validateTradingAction({
        context,
        market,
        account: {
          availableMargin: "1000",
          leverage: 5,
          positionSize: "0",
          version: 4,
        },
        controls: { slippageBps: null, trigger: null },
        intent: {
          type: "limit_order",
          assetId: 0,
          side: "buy",
          size: "0.1",
          limitPrice: "100",
          timeInForce: "Gtc",
          reduceOnly: false,
          cloid: "0x00000000000000000000000000000006",
          ...mutation,
        } as never,
      }),
    ).toThrow();
  });

  test("rejects a forged leverage margin mode", () => {
    expect(() =>
      validateTradingAction({
        context,
        market,
        account: {
          availableMargin: "1000",
          leverage: 5,
          positionSize: "0",
          version: 4,
        },
        controls: { slippageBps: null, trigger: null },
        intent: {
          type: "update_leverage",
          assetId: 0,
          leverage: 2,
          marginMode: "portfolio",
        } as never,
      }),
    ).toThrow("marginMode");
  });
});
