import { describe, expect, test } from "bun:test";
import type { Market } from "@hyper-trader/hyperliquid/public";

import type { NormalizedTradingContext } from "../../core/context/supervisor";
import {
  HIP3_DUPLICATE,
  NATIVE_DUPLICATE,
  OUTCOME_MARKET,
  SPOT_DUPLICATE,
} from "../markets/fixture";
import {
  buildTradeLeverageReview,
  buildTradeReview,
  canStartTradeReview,
  cloidFromRandomBytes,
  controlsForMarket,
  createTradeDraft,
  createTradeOperationFence,
  evaluateTradeGate,
  hasSupportedOrderMetadata,
  reconcileTradeDraft,
  resolveCanonicalMarketSwitch,
  signerBindingForTradeContext,
  sizeForPreset,
  type TradeAccountSnapshot,
  type TradeAuthority,
  tradeConnectivityFromCatalogFreshness,
  tradeDraftValueKey,
  tradeReviewScopeKey,
} from "./trade-model";

const NOW = 1_725_000_000_000;
const context: NormalizedTradingContext = {
  network: "testnet",
  masterAccount: "0x1111111111111111111111111111111111111111",
  targetAccount: "0x2222222222222222222222222222222222222222",
  signer: {
    agentAddress: "0x3333333333333333333333333333333333333333",
    generation: 2,
  },
};
const account: TradeAccountSnapshot = {
  availableFunds: { buy: "1000", sell: "900" },
  leverage: 5,
  marginMode: "cross",
  positionSize: "0",
  version: 8,
  observedAtMs: NOW - 1_000,
};
const readyAuthority: TradeAuthority = {
  connectivity: "current",
  account,
  signerState: "unlocked",
  actionRuntimeAvailable: true,
};

describe("Trade leverage review", () => {
  test("builds a bounded update using the current margin mode", () => {
    const review = buildTradeLeverageReview({
      market: NATIVE_DUPLICATE,
      context,
      capturedContextEpoch: 7,
      authority: readyAuthority,
      leverage: 10,
      nowMs: NOW,
    });

    expect(review.validated.intent).toEqual({
      type: "update_leverage",
      assetId: NATIVE_DUPLICATE.orderAssetId,
      leverage: 10,
      marginMode: "cross",
    });
    expect(review.presentation).toMatchObject({
      market: "DUP-USDC",
      action: "Update leverage",
      leverageAndMargin: "10× · cross",
    });
  });

  test("rejects unchanged, excessive, and non-perpetual leverage", () => {
    expect(() =>
      buildTradeLeverageReview({
        market: NATIVE_DUPLICATE,
        context,
        capturedContextEpoch: 7,
        authority: readyAuthority,
        leverage: 5,
        nowMs: NOW,
      }),
    ).toThrow("different from the current value");
    expect(() =>
      buildTradeLeverageReview({
        market: NATIVE_DUPLICATE,
        context,
        capturedContextEpoch: 7,
        authority: readyAuthority,
        leverage: 21,
        nowMs: NOW,
      }),
    ).toThrow("from 1 through 20");
    expect(() =>
      buildTradeLeverageReview({
        market: SPOT_DUPLICATE,
        context,
        capturedContextEpoch: 7,
        authority: readyAuthority,
        leverage: 2,
        nowMs: NOW,
      }),
    ).toThrow("perpetual markets");
  });
});

describe("Trade control applicability", () => {
  test("keeps only family and order appropriate controls visible", () => {
    expect(controlsForMarket(NATIVE_DUPLICATE, "market")).toEqual({
      price: false,
      leverage: true,
      reduceOnly: false,
      timeInForce: false,
      slippage: true,
    });
    expect(controlsForMarket(HIP3_DUPLICATE, "limit")).toEqual({
      price: true,
      leverage: true,
      reduceOnly: true,
      timeInForce: true,
      slippage: false,
    });
    expect(controlsForMarket(SPOT_DUPLICATE, "limit")).toEqual({
      price: true,
      leverage: false,
      reduceOnly: false,
      timeInForce: true,
      slippage: false,
    });
    expect(controlsForMarket(OUTCOME_MARKET, "market")).toEqual({
      price: false,
      leverage: false,
      reduceOnly: false,
      timeInForce: false,
      slippage: false,
    });
  });

  test.each([
    [NATIVE_DUPLICATE, true],
    [SPOT_DUPLICATE, true],
    [HIP3_DUPLICATE, true],
    [OUTCOME_MARKET, false],
    [{ ...NATIVE_DUPLICATE, lifecycle: "delisted" }, false],
    [{ ...NATIVE_DUPLICATE, orderAvailability: "browse_only" }, false],
    [{ ...NATIVE_DUPLICATE, sizeDecimals: null }, false],
    [{ ...NATIVE_DUPLICATE, pricePrecision: null }, false],
  ] as const)(
    "uses one supported-order metadata predicate",
    (market, expected) => {
      expect(hasSupportedOrderMetadata(market as Market)).toBe(expected);
    },
  );

  test("applies scoped defaults only when the selected market can support them", () => {
    expect(
      createTradeDraft({
        market: NATIVE_DUPLICATE,
        context,
        account,
        preferences: { defaultOrderType: "limit", defaultSlippageBps: 25 },
      }),
    ).toMatchObject({ orderType: "limit", slippageBps: "25" });
    expect(
      createTradeDraft({
        market: OUTCOME_MARKET,
        context,
        account,
        preferences: { defaultOrderType: "limit", defaultSlippageBps: 25 },
      }),
    ).toMatchObject({ orderType: "market", slippageBps: "50" });
  });
});

describe("Trade draft ownership", () => {
  test("preserves input for the same binding and invalidates metadata, market, and account changes", () => {
    const draft = {
      ...createTradeDraft({ market: NATIVE_DUPLICATE, context, account }),
      size: "2.5",
      limitPrice: "10.25",
      side: "sell" as const,
    };

    const preserved = reconcileTradeDraft(draft, {
      market: NATIVE_DUPLICATE,
      context,
      account,
    });
    expect(preserved.preserved).toBe(true);
    expect(preserved.draft).toBe(draft);

    const synchronizedLeverage = reconcileTradeDraft(
      { ...draft, leverage: null },
      {
        market: NATIVE_DUPLICATE,
        context,
        account,
      },
    );
    expect(synchronizedLeverage).toMatchObject({
      preserved: true,
      draft: {
        leverage: account.leverage,
        size: "2.5",
        limitPrice: "10.25",
        side: "sell",
      },
    });

    const changedMetadata = reconcileTradeDraft(draft, {
      market: { ...NATIVE_DUPLICATE, maxLeverage: 10 },
      context,
      account,
    });
    expect(changedMetadata).toMatchObject({
      preserved: false,
      reason: "market_metadata_changed",
    });
    expect(changedMetadata.draft.size).toBe("");

    const changedMarket = reconcileTradeDraft(draft, {
      market: HIP3_DUPLICATE,
      context,
      account,
    });
    expect(changedMarket).toMatchObject({
      preserved: false,
      reason: "market_changed",
    });

    const changedAccount = reconcileTradeDraft(draft, {
      market: NATIVE_DUPLICATE,
      context: { ...context, targetAccount: context.masterAccount },
      account,
    });
    expect(changedAccount).toMatchObject({
      preserved: false,
      reason: "account_changed",
    });

    expect(
      reconcileTradeDraft(draft, {
        market: NATIVE_DUPLICATE,
        context,
        account,
      }).draft.size,
    ).toBe("2.5");
  });
});

describe("Trade fail-closed gates", () => {
  test("keeps validated cached metadata current during background refresh", () => {
    expect(tradeConnectivityFromCatalogFreshness("fresh")).toBe("current");
    expect(tradeConnectivityFromCatalogFreshness("refreshing")).toBe("current");
    expect(tradeConnectivityFromCatalogFreshness("stale")).toBe("stale");
    expect(tradeConnectivityFromCatalogFreshness("offline")).toBe("offline");
  });

  test.each([
    ["mainnet", { ...context, network: "mainnet" }, readyAuthority],
    ["stale_metadata", context, { ...readyAuthority, connectivity: "stale" }],
    ["offline", context, { ...readyAuthority, connectivity: "offline" }],
    [
      "reconnecting",
      context,
      { ...readyAuthority, connectivity: "reconnecting" },
    ],
    ["expired_agent", context, { ...readyAuthority, signerState: "expired" }],
  ] as const)("reports %s with an explicit reason", (code, next, authority) => {
    const gate = evaluateTradeGate({
      market: NATIVE_DUPLICATE,
      context: next,
      authority,
      nowMs: NOW,
    });
    expect(gate).toMatchObject({ enabled: false, code });
    expect(gate.reason.length).toBeGreaterThan(12);
  });

  test("allows review while device authentication waits for confirmation", () => {
    expect(
      evaluateTradeGate({
        market: NATIVE_DUPLICATE,
        context,
        authority: { ...readyAuthority, signerState: "locked" },
        nowMs: NOW,
      }),
    ).toMatchObject({
      enabled: true,
      code: "ready",
      reason:
        "Ready for review. You’ll confirm on this device only when signing is required.",
    });
  });

  test("keeps HIP-3 controls inspectable but review gated pending cloid evidence", () => {
    expect(
      evaluateTradeGate({
        market: HIP3_DUPLICATE,
        context,
        authority: readyAuthority,
        nowMs: NOW,
      }),
    ).toMatchObject({ enabled: false, code: "hip3_release_gate" });
    expect(
      evaluateTradeGate({
        market: {
          ...HIP3_DUPLICATE,
          canonicalId: "perp:8:1",
          dexIndex: 8,
          dexName: "new-builder",
        },
        context,
        authority: readyAuthority,
        nowMs: NOW,
      }),
    ).toMatchObject({ enabled: false, code: "hip3_release_gate" });
  });

  test("distinguishes read-only, unavailable market, and stale account authority", () => {
    const readOnlyContext = {
      ...context,
      masterAccount: null,
      targetAccount: null,
      signer: null,
    };
    expect(
      evaluateTradeGate({
        market: NATIVE_DUPLICATE,
        context: readOnlyContext,
        authority: { ...readyAuthority, account: null, signerState: "missing" },
        nowMs: NOW,
      }),
    ).toMatchObject({ enabled: false, code: "read_only" });
    expect(
      evaluateTradeGate({
        market: { ...NATIVE_DUPLICATE, lifecycle: "delisted" },
        context,
        authority: readyAuthority,
        nowMs: NOW,
      }),
    ).toMatchObject({ enabled: false, code: "market_unavailable" });
    expect(
      evaluateTradeGate({
        market: NATIVE_DUPLICATE,
        context,
        authority: { ...readyAuthority, actionRuntimeAvailable: false },
        nowMs: NOW,
      }),
    ).toMatchObject({
      enabled: true,
      code: "ready",
      reason: "Ready for review. Order submission is currently unavailable.",
    });
    expect(
      evaluateTradeGate({
        market: OUTCOME_MARKET,
        context,
        authority: readyAuthority,
        nowMs: NOW,
      }),
    ).toMatchObject({ enabled: false, code: "market_unavailable" });
    const staleAccountGate = evaluateTradeGate({
      market: NATIVE_DUPLICATE,
      context,
      authority: {
        ...readyAuthority,
        account: { ...account, observedAtMs: NOW - 30_001 },
      },
      nowMs: NOW,
    });
    expect(staleAccountGate).toMatchObject({
      enabled: false,
      code: "stale_account",
      reason: "Account details will refresh before review.",
    });
    expect(canStartTradeReview(staleAccountGate)).toBe(true);
    expect(
      canStartTradeReview(
        evaluateTradeGate({
          market: NATIVE_DUPLICATE,
          context,
          authority: { ...readyAuthority, connectivity: "offline" },
          nowMs: NOW,
        }),
      ),
    ).toBe(false);
  });
});

describe("canonical switching and review handoff", () => {
  test("derives exact cryptographic cloid and signer boundaries", () => {
    expect(
      cloidFromRandomBytes(Uint8Array.from({ length: 16 }, (_, i) => i)),
    ).toBe("0x000102030405060708090a0b0c0d0e0f");
    expect(() => cloidFromRandomBytes(new Uint8Array(15))).toThrow("16-byte");
    expect(() => cloidFromRandomBytes(new Uint8Array(17))).toThrow("16-byte");
    expect(signerBindingForTradeContext(context)).toEqual({
      network: "testnet",
      masterAccount: "0x1111111111111111111111111111111111111111",
      targetAccount: "0x2222222222222222222222222222222222222222",
      agentAddress: "0x3333333333333333333333333333333333333333",
      generation: 2,
    });
    expect(() =>
      signerBindingForTradeContext({ ...context, network: "mainnet" }),
    ).toThrow("testnet signer binding");
    expect(() =>
      signerBindingForTradeContext({ ...context, signer: null }),
    ).toThrow("testnet signer binding");
  });

  test("switches repeated display symbols only by canonical identity", () => {
    expect(
      resolveCanonicalMarketSwitch(
        [NATIVE_DUPLICATE, HIP3_DUPLICATE, SPOT_DUPLICATE],
        "perp:3:9",
      ),
    ).toBe(HIP3_DUPLICATE);
    expect(
      resolveCanonicalMarketSwitch(
        [NATIVE_DUPLICATE, HIP3_DUPLICATE, SPOT_DUPLICATE],
        "DUP",
      ),
    ).toBeNull();
  });

  test("constructs the exact immutable limit-order review payload", () => {
    const draft = {
      ...createTradeDraft({ market: NATIVE_DUPLICATE, context, account }),
      orderType: "limit" as const,
      side: "sell" as const,
      size: "2.5",
      limitPrice: "10.25",
      reduceOnly: false,
      timeInForce: "Gtc" as const,
    };
    const review = buildTradeReview({
      market: NATIVE_DUPLICATE,
      context,
      capturedContextEpoch: 9,
      authority: readyAuthority,
      draft,
      cloid: "0x00000000000000000000000000000042",
      nowMs: NOW,
    });

    expect(review.validation.intent).toEqual({
      type: "limit_order",
      assetId: NATIVE_DUPLICATE.orderAssetId,
      side: "sell",
      size: "2.5",
      limitPrice: "10.25",
      timeInForce: "Gtc",
      reduceOnly: false,
      cloid: "0x00000000000000000000000000000042",
    });
    expect(review.validation.account.availableMargin).toBe("900");
    expect(review.presentation).toEqual({
      market: "DUP-USDC",
      account: context.targetAccount as string,
      network: "Hyperliquid testnet",
      action: "Limit order · Gtc",
      side: "SELL",
      price: "10.25",
      size: "2.5",
      leverageAndMargin: "5× · cross",
      reduceOnly: "No",
      estimatedFee: "Unavailable until the refreshed quote",
      slippage: "Not applicable",
    });
    expect(Object.isFrozen(review)).toBe(true);
  });

  test("never fabricates leverage or isolated margin state and ignores hidden limit slippage", () => {
    const draft = {
      ...createTradeDraft({ market: NATIVE_DUPLICATE, context, account }),
      orderType: "limit" as const,
      size: "1",
      limitPrice: "10",
      slippageBps: "stale-hidden-value",
    };
    expect(() =>
      buildTradeReview({
        market: NATIVE_DUPLICATE,
        context,
        capturedContextEpoch: 9,
        authority: readyAuthority,
        draft: { ...draft, leverage: 10 },
        cloid: "0x00000000000000000000000000000044",
        nowMs: NOW,
      }),
    ).toThrow("Account leverage changed");

    expect(() =>
      buildTradeReview({
        market: { ...NATIVE_DUPLICATE, onlyIsolated: true },
        context,
        capturedContextEpoch: 9,
        authority: readyAuthority,
        draft: {
          ...createTradeDraft({
            market: { ...NATIVE_DUPLICATE, onlyIsolated: true },
            context,
            account,
          }),
          orderType: "limit",
          size: "1",
          limitPrice: "10",
        },
        cloid: "0x00000000000000000000000000000045",
        nowMs: NOW,
      }),
    ).toThrow("requires isolated margin");

    expect(
      buildTradeReview({
        market: NATIVE_DUPLICATE,
        context,
        capturedContextEpoch: 9,
        authority: readyAuthority,
        draft,
        cloid: "0x00000000000000000000000000000046",
        nowMs: NOW,
      }).validation.controls.slippageBps,
    ).toBeNull();
  });

  test("constructs a bounded market payload and rejects invalid or insufficient values", () => {
    const draft = {
      ...createTradeDraft({ market: NATIVE_DUPLICATE, context, account }),
      size: "2",
      side: "buy" as const,
      slippageBps: "50",
    };
    const input = {
      market: NATIVE_DUPLICATE,
      context,
      capturedContextEpoch: 9,
      authority: readyAuthority,
      draft,
      cloid: "0x00000000000000000000000000000043" as const,
      nowMs: NOW,
    };
    const review = buildTradeReview(input);
    expect(review.validation.intent).toMatchObject({
      type: "market_order",
      side: "buy",
      size: "2",
      aggressiveLimitPrice: "10.05",
    });
    expect(review.presentation.slippage).toBe("0.5%");

    const bitcoinLikeMarket = {
      ...NATIVE_DUPLICATE,
      markPx: "78800" as const,
      midPx: "78800" as const,
      sizeDecimals: 5,
      pricePrecision: {
        maxSignificantFigures: 5 as const,
        maxDecimalPlaces: 1,
      },
    };
    const bitcoinDraft = {
      ...createTradeDraft({
        market: bitcoinLikeMarket,
        context,
        account,
      }),
      size: "0.0001",
      side: "buy" as const,
      slippageBps: "50",
    };
    expect(() =>
      buildTradeReview({
        ...input,
        market: bitcoinLikeMarket,
        draft: bitcoinDraft,
      }),
    ).toThrow("Order must have minimum value of $10.");

    expect(() =>
      buildTradeReview({
        ...input,
        draft: { ...draft, size: "not-a-decimal" },
      }),
    ).toThrow();
    expect(() =>
      buildTradeReview({
        ...input,
        authority: {
          ...readyAuthority,
          account: {
            ...account,
            availableFunds: { buy: "1", sell: "1" },
          },
        },
      }),
    ).toThrow("insufficient current margin");
  });

  test("constructs a spot limit review without perp-only controls", () => {
    const draft = {
      ...createTradeDraft({ market: SPOT_DUPLICATE, context, account }),
      orderType: "limit" as const,
      side: "buy" as const,
      size: "5",
      limitPrice: "2",
    };
    const review = buildTradeReview({
      market: SPOT_DUPLICATE,
      context,
      capturedContextEpoch: 9,
      authority: readyAuthority,
      draft,
      cloid: "0x00000000000000000000000000000048",
      nowMs: NOW,
    });
    expect(review.validation.intent).toMatchObject({
      type: "limit_order",
      assetId: SPOT_DUPLICATE.orderAssetId,
      side: "buy",
      reduceOnly: false,
    });
    expect(review.presentation.leverageAndMargin).toBe("Spot");
    expect(review.presentation.slippage).toBe("Not applicable");
  });

  test("computes size presets with decimal flooring and fences late rapid-switch work", () => {
    expect(
      sizeForPreset({
        availableFunds: "1000",
        referencePrice: "10",
        leverage: 5,
        percentage: 25,
        sizeDecimals: 2,
      }),
    ).toBe("125");
    expect(
      sizeForPreset({
        availableFunds: "1.23",
        referencePrice: "2",
        leverage: 1,
        percentage: 50,
        sizeDecimals: 2,
      }),
    ).toBe("0.3");
    expect(() =>
      sizeForPreset({
        availableFunds: "0.01",
        referencePrice: "100000",
        leverage: 1,
        percentage: 25,
        sizeDecimals: 2,
      }),
    ).toThrow("below the current size precision");
    for (const availableFunds of ["0", "0.0", "-1", "01", ".5", "1."]) {
      expect(() =>
        sizeForPreset({
          availableFunds,
          referencePrice: "2",
          leverage: 1,
          percentage: 25,
          sizeDecimals: 2,
        }),
      ).toThrow();
    }

    const fence = createTradeOperationFence();
    const nativeScope = tradeReviewScopeKey({
      market: NATIVE_DUPLICATE,
      context,
      authority: readyAuthority,
    });
    const hip3Scope = tradeReviewScopeKey({
      market: HIP3_DUPLICATE,
      context,
      authority: readyAuthority,
    });
    const first = fence.begin(NATIVE_DUPLICATE.canonicalId, nativeScope);
    const second = fence.begin(HIP3_DUPLICATE.canonicalId, hip3Scope);
    expect(fence.canCommit(first, nativeScope)).toBe(false);
    expect(fence.canCommit(second, hip3Scope)).toBe(true);
    expect(
      fence.canCommit(
        second,
        tradeReviewScopeKey({
          market: { ...HIP3_DUPLICATE, maxLeverage: 10 },
          context,
          authority: readyAuthority,
        }),
      ),
    ).toBe(false);
    expect(
      fence.canCommit(
        second,
        tradeReviewScopeKey({
          market: { ...HIP3_DUPLICATE, markPx: "12.1" },
          context,
          authority: readyAuthority,
        }),
      ),
    ).toBe(false);
    expect(
      fence.canCommit(
        second,
        tradeReviewScopeKey({
          market: HIP3_DUPLICATE,
          context,
          authority: {
            ...readyAuthority,
            account: { ...account, version: 9, observedAtMs: NOW },
          },
        }),
      ),
    ).toBe(false);
    const editableDraft = createTradeDraft({
      market: HIP3_DUPLICATE,
      context,
      account,
    });
    const draftScope = `${hip3Scope}:${tradeDraftValueKey(editableDraft)}`;
    const draftOperation = fence.begin(HIP3_DUPLICATE.canonicalId, draftScope);
    expect(
      fence.canCommit(
        draftOperation,
        `${hip3Scope}:${tradeDraftValueKey({ ...editableDraft, size: "2" })}`,
      ),
    ).toBe(false);
    expect(
      fence.canCommit(
        draftOperation,
        `${hip3Scope}:${tradeDraftValueKey({ ...editableDraft, side: "sell" })}`,
      ),
    ).toBe(false);
    fence.invalidate();
    expect(fence.canCommit(draftOperation, draftScope)).toBe(false);
  });

  test("fails closed when the review clock is not a safe current millisecond value", () => {
    expect(
      evaluateTradeGate({
        market: NATIVE_DUPLICATE,
        context,
        authority: readyAuthority,
        nowMs: Number.NaN,
      }),
    ).toMatchObject({ enabled: false, code: "invalid_time" });
    expect(() =>
      buildTradeReview({
        market: NATIVE_DUPLICATE,
        context,
        capturedContextEpoch: 9,
        authority: readyAuthority,
        draft: {
          ...createTradeDraft({ market: NATIVE_DUPLICATE, context, account }),
          size: "1",
        },
        cloid: "0x00000000000000000000000000000047",
        nowMs: Number.MAX_SAFE_INTEGER + 1,
      }),
    ).toThrow();
  });
});
