import type {
  Cloid,
  LimitTimeInForce,
  SignerBinding,
} from "@hyper-trader/hyperliquid";
import { parseCloid } from "@hyper-trader/hyperliquid";
import {
  type DecimalString,
  isDecimalString,
  type Market,
} from "@hyper-trader/hyperliquid/public";
import { toHex } from "viem";

import {
  bindDraftContext,
  type DraftContextBinding,
  type DraftInvalidationReason,
  validateDraftContext,
} from "../../core/actions/draft-context";
import { marketMetadataFingerprint } from "../../core/actions/metadata-fingerprint";
import type { NormalizedTradingContext } from "../../core/context/supervisor";
import {
  type ActionReviewSnapshot,
  createActionReview,
} from "../actions/orchestrator";

export type TradeOrderType = "market" | "limit";

export interface TradeAccountSnapshot {
  readonly availableFunds: DecimalString;
  readonly leverage: number | null;
  readonly marginMode: "cross" | "isolated" | null;
  readonly positionSize: DecimalString;
  readonly version: number;
  readonly observedAtMs: number;
}

export interface TradeDraft {
  readonly binding: DraftContextBinding;
  readonly side: "buy" | "sell";
  readonly orderType: TradeOrderType;
  readonly size: string;
  readonly limitPrice: string;
  readonly leverage: number | null;
  readonly timeInForce: LimitTimeInForce;
  readonly reduceOnly: boolean;
  readonly slippageBps: string;
}

export interface TradeControlApplicability {
  readonly price: boolean;
  readonly leverage: boolean;
  readonly reduceOnly: boolean;
  readonly timeInForce: boolean;
  readonly slippage: boolean;
}

export type TradeConnectivity =
  | "current"
  | "stale"
  | "offline"
  | "reconnecting";

export type TradeSignerState = "missing" | "unlocked" | "locked" | "expired";

export interface TradeAuthority {
  readonly connectivity: TradeConnectivity;
  readonly account: TradeAccountSnapshot | null;
  readonly signerState: TradeSignerState;
  readonly actionRuntimeAvailable: boolean;
}

export type TradeGateCode =
  | "ready"
  | "invalid_time"
  | "mainnet"
  | "market_unavailable"
  | "hip3_release_gate"
  | "stale_metadata"
  | "offline"
  | "reconnecting"
  | "read_only"
  | "locked"
  | "expired_agent"
  | "stale_account"
  | "action_runtime_unavailable";

export type TradeGate =
  | { readonly enabled: true; readonly code: "ready"; readonly reason: string }
  | {
      readonly enabled: false;
      readonly code: Exclude<TradeGateCode, "ready">;
      readonly reason: string;
    };

export type TradeDraftReconciliation =
  | { readonly draft: TradeDraft; readonly preserved: true }
  | {
      readonly draft: TradeDraft;
      readonly preserved: false;
      readonly reason: DraftInvalidationReason;
      readonly message: string;
    };

export interface TradeOperationToken {
  readonly generation: number;
  readonly marketCanonicalId: string;
  readonly reviewScopeKey: string;
}

export interface TradeOperationFence {
  begin(marketCanonicalId: string, reviewScopeKey: string): TradeOperationToken;
  canCommit(token: TradeOperationToken, currentReviewScopeKey: string): boolean;
  invalidate(): void;
}

const ACCOUNT_FRESHNESS_WINDOW_MS = 30_000;
const REVIEW_WINDOW_MS = 30_000;

export function cloidFromRandomBytes(bytes: Uint8Array): Cloid {
  if (bytes.length !== 16) {
    throw new Error("A cryptographic 16-byte order identity is required.");
  }
  return parseCloid(toHex(bytes));
}

function marketFingerprint(market: Market): string {
  return marketMetadataFingerprint({
    canonicalId: market.canonicalId,
    orderAssetId: market.orderAssetId,
    family: market.family,
    pricePrecision: market.pricePrecision,
    sizeDecimals: market.sizeDecimals,
    ...(market.family === "perp"
      ? {
          maxLeverage: market.maxLeverage,
          onlyIsolated: market.onlyIsolated,
          marginMode: market.marginMode,
          marginTableId: market.marginTableId,
        }
      : {}),
    lifecycle: market.lifecycle,
    orderAvailability: market.orderAvailability,
  });
}

export function tradeReviewScopeKey(input: {
  readonly market: Market;
  readonly context: NormalizedTradingContext;
  readonly authority: TradeAuthority;
}): string {
  const account = input.authority.account;
  return JSON.stringify([
    marketFingerprint(input.market),
    currentPrice(input.market),
    input.context.network,
    input.context.masterAccount,
    input.context.targetAccount,
    input.context.signer?.agentAddress ?? null,
    input.context.signer?.generation ?? null,
    input.authority.connectivity,
    input.authority.signerState,
    input.authority.actionRuntimeAvailable,
    account?.availableFunds ?? null,
    account?.leverage ?? null,
    account?.marginMode ?? null,
    account?.positionSize ?? null,
    account?.version ?? null,
    account?.observedAtMs ?? null,
  ]);
}

export function tradeDraftValueKey(draft: TradeDraft): string {
  return JSON.stringify([
    draft.binding.contextKey,
    draft.binding.marketCanonicalId,
    draft.binding.metadataFingerprint,
    draft.side,
    draft.orderType,
    draft.size,
    draft.limitPrice,
    draft.leverage,
    draft.timeInForce,
    draft.reduceOnly,
    draft.slippageBps,
  ]);
}

function currentPrice(market: Market): string {
  return market.midPx ?? market.markPx ?? "";
}

export function hasSupportedOrderMetadata(market: Market): boolean {
  return (
    market.family !== "outcome" &&
    market.lifecycle === "active" &&
    market.orderAvailability === "enabled" &&
    market.sizeDecimals !== null &&
    market.pricePrecision !== null
  );
}

export function controlsForMarket(
  market: Market,
  orderType: TradeOrderType,
): TradeControlApplicability {
  if (!hasSupportedOrderMetadata(market)) {
    return {
      price: false,
      leverage: false,
      reduceOnly: false,
      timeInForce: false,
      slippage: false,
    };
  }
  const isLimit = orderType === "limit";
  const isPerp = market.family === "perp";
  return {
    price: isLimit,
    leverage: isPerp,
    reduceOnly: isLimit && isPerp,
    timeInForce: isLimit,
    slippage: !isLimit,
  };
}

export function createTradeDraft(input: {
  readonly market: Market;
  readonly context: NormalizedTradingContext;
  readonly account: TradeAccountSnapshot | null;
}): TradeDraft {
  return {
    binding: bindDraftContext({
      context: input.context,
      marketCanonicalId: input.market.canonicalId,
      metadataFingerprint: marketFingerprint(input.market),
    }),
    side: "buy",
    orderType: "market",
    size: "",
    limitPrice: currentPrice(input.market),
    leverage:
      input.market.family === "perp" ? (input.account?.leverage ?? null) : null,
    timeInForce: "Gtc",
    reduceOnly: false,
    slippageBps: "50",
  };
}

export function reconcileTradeDraft(
  draft: TradeDraft,
  input: {
    readonly market: Market;
    readonly context: NormalizedTradingContext;
    readonly account: TradeAccountSnapshot | null;
  },
): TradeDraftReconciliation {
  const validation = validateDraftContext(draft.binding, {
    context: input.context,
    marketCanonicalId: input.market.canonicalId,
    metadataFingerprint: marketFingerprint(input.market),
  });
  if (validation.valid) {
    return { draft, preserved: true };
  }
  return {
    draft: createTradeDraft(input),
    preserved: false,
    reason: validation.reason,
    message: validation.message,
  };
}

export function resolveCanonicalMarketSwitch(
  markets: readonly Market[],
  canonicalId: string,
): Market | null {
  return markets.find((market) => market.canonicalId === canonicalId) ?? null;
}

export function createTradeOperationFence(): TradeOperationFence {
  let generation = 0;
  let currentMarket: string | null = null;
  let currentReviewScope: string | null = null;
  return {
    begin(marketCanonicalId, reviewScopeKey) {
      currentMarket = marketCanonicalId;
      currentReviewScope = reviewScopeKey;
      generation += 1;
      return { generation, marketCanonicalId, reviewScopeKey };
    },
    canCommit(token, currentReviewScopeKey) {
      return (
        token.generation === generation &&
        token.marketCanonicalId === currentMarket &&
        token.reviewScopeKey === currentReviewScope &&
        token.reviewScopeKey === currentReviewScopeKey
      );
    },
    invalidate() {
      generation += 1;
      currentMarket = null;
      currentReviewScope = null;
    },
  };
}

function disabled(
  code: Exclude<TradeGateCode, "ready">,
  reason: string,
): TradeGate {
  return { enabled: false, code, reason };
}

export function evaluateTradeGate(input: {
  readonly market: Market;
  readonly context: NormalizedTradingContext;
  readonly authority: TradeAuthority;
  readonly nowMs: number;
}): TradeGate {
  const { account, connectivity, signerState } = input.authority;
  if (!Number.isSafeInteger(input.nowMs) || input.nowMs < 0) {
    return disabled(
      "invalid_time",
      "Current device time is invalid. Refresh authoritative time before review.",
    );
  }
  if (input.context.network !== "testnet") {
    return disabled(
      "mainnet",
      "Mainnet is browse-only. This build can review testnet actions only.",
    );
  }
  if (!hasSupportedOrderMetadata(input.market)) {
    return disabled(
      "market_unavailable",
      "Current validated metadata does not permit an order for this market.",
    );
  }
  if (input.market.family === "perp" && input.market.dexIndex !== 0) {
    return disabled(
      "hip3_release_gate",
      "HIP-3 order review is gated until create-with-cloid and timeout reconciliation pass the live testnet safety probe.",
    );
  }
  if (connectivity === "offline") {
    return disabled(
      "offline",
      "Offline data remains browseable, but current authority cannot be revalidated.",
    );
  }
  if (connectivity === "reconnecting") {
    return disabled(
      "reconnecting",
      "Market data is reconnecting. Review stays closed until a current snapshot arrives.",
    );
  }
  if (connectivity === "stale") {
    return disabled(
      "stale_metadata",
      "Market metadata is stale. Refresh current trading rules before review.",
    );
  }
  if (
    input.context.masterAccount === null ||
    input.context.targetAccount === null ||
    input.context.signer === null ||
    account === null ||
    signerState === "missing"
  ) {
    return disabled(
      "read_only",
      "No exact testnet account, target, and API-wallet binding is active. Set up trading to continue.",
    );
  }
  if (signerState === "expired") {
    return disabled(
      "expired_agent",
      "The bound API wallet expired or became invalid. Reauthorize before review.",
    );
  }
  if (signerState === "locked") {
    return disabled(
      "locked",
      "The trading session is locked. Unlock and revalidate this preserved draft before review.",
    );
  }
  if (
    !Number.isSafeInteger(account.observedAtMs) ||
    account.observedAtMs > input.nowMs + 5_000 ||
    input.nowMs - account.observedAtMs > ACCOUNT_FRESHNESS_WINDOW_MS
  ) {
    return disabled(
      "stale_account",
      "Available funds and account rules are stale. Refresh them before review.",
    );
  }
  if (!input.authority.actionRuntimeAvailable) {
    return disabled(
      "action_runtime_unavailable",
      "The reviewed action runtime is release-gated in this build. Drafting remains available without signer or transport access.",
    );
  }
  return {
    enabled: true,
    code: "ready",
    reason:
      "Current testnet market, account, and signer authority are ready for review.",
  };
}

function parseUnsignedDecimal(
  value: string,
  path: string,
): {
  readonly coefficient: bigint;
  readonly scale: number;
} {
  if (!isDecimalString(value) || value.startsWith("-")) {
    throw new Error(`${path} must be a positive decimal value.`);
  }
  const [whole = "0", fraction = ""] = value.split(".");
  const coefficient = BigInt(`${whole}${fraction}`);
  if (coefficient <= 0n) {
    throw new Error(`${path} must be greater than zero.`);
  }
  return { coefficient, scale: fraction.length };
}

function powerOfTen(scale: number): bigint {
  return 10n ** BigInt(scale);
}

export function sizeForPreset(input: {
  readonly availableFunds: string;
  readonly referencePrice: string;
  readonly leverage: number;
  readonly percentage: 25 | 50 | 75 | 100;
  readonly sizeDecimals: number;
}): DecimalString {
  if (
    !Number.isSafeInteger(input.leverage) ||
    input.leverage < 1 ||
    !Number.isSafeInteger(input.sizeDecimals) ||
    input.sizeDecimals < 0 ||
    input.sizeDecimals > 18
  ) {
    throw new Error("Current leverage or size precision is unavailable.");
  }
  const available = parseUnsignedDecimal(
    input.availableFunds,
    "Available funds",
  );
  const price = parseUnsignedDecimal(input.referencePrice, "Reference price");
  const numerator =
    available.coefficient *
    BigInt(input.leverage) *
    BigInt(input.percentage) *
    powerOfTen(price.scale + input.sizeDecimals);
  const denominator = 100n * price.coefficient * powerOfTen(available.scale);
  const coefficient = numerator / denominator;
  if (coefficient === 0n) {
    throw new Error(
      "This preset is below the current size precision. Enter a larger size.",
    );
  }
  return formatCoefficient(coefficient, input.sizeDecimals);
}

function formatCoefficient(coefficient: bigint, scale: number): DecimalString {
  if (scale === 0) return coefficient.toString() as DecimalString;
  const digits = coefficient.toString().padStart(scale + 1, "0");
  const split = digits.length - scale;
  const fraction = digits.slice(split).replace(/0+$/, "");
  return (
    fraction.length === 0
      ? digits.slice(0, split)
      : `${digits.slice(0, split)}.${fraction}`
  ) as DecimalString;
}

function aggressivePrice(input: {
  readonly reference: string;
  readonly side: "buy" | "sell";
  readonly slippageBps: number;
  readonly maxDecimalPlaces: number;
  readonly maxSignificantFigures: number;
}): DecimalString {
  const reference = parseUnsignedDecimal(input.reference, "Reference price");
  const wholeDigits = Math.max(
    1,
    reference.coefficient.toString().length - reference.scale,
  );
  const targetScale = Math.max(
    0,
    Math.min(input.maxDecimalPlaces, input.maxSignificantFigures - wholeDigits),
  );
  const factor = BigInt(
    input.side === "buy"
      ? 10_000 + input.slippageBps
      : 10_000 - input.slippageBps,
  );
  const numerator = reference.coefficient * factor * powerOfTen(targetScale);
  const denominator = powerOfTen(reference.scale) * 10_000n;
  let coefficient = numerator / denominator;
  if (input.side === "sell" && numerator % denominator !== 0n) {
    coefficient += 1n;
  }
  if (coefficient <= 0n) {
    throw new Error("The slippage price bound is not positive.");
  }
  return formatCoefficient(coefficient, targetScale);
}

export function signerBindingForTradeContext(
  context: NormalizedTradingContext,
): SignerBinding {
  if (
    context.network !== "testnet" ||
    context.masterAccount === null ||
    context.targetAccount === null ||
    context.signer === null
  ) {
    throw new Error("An exact testnet signer binding is required for review.");
  }
  return {
    network: "testnet",
    masterAccount: context.masterAccount,
    targetAccount: context.targetAccount,
    agentAddress: context.signer.agentAddress,
    generation: context.signer.generation,
  };
}

function slippageValue(draft: TradeDraft): number {
  if (!/^\d+$/.test(draft.slippageBps)) {
    throw new Error("Slippage must be whole basis points from 0 through 500.");
  }
  const value = Number(draft.slippageBps);
  if (!Number.isSafeInteger(value) || value < 0 || value > 500) {
    throw new Error("Slippage must be whole basis points from 0 through 500.");
  }
  return value;
}

export function buildTradeReview(input: {
  readonly market: Market;
  readonly context: NormalizedTradingContext;
  readonly capturedContextEpoch: number;
  readonly authority: TradeAuthority;
  readonly draft: TradeDraft;
  readonly cloid: Cloid;
  readonly nowMs: number;
}): ActionReviewSnapshot {
  const gate = evaluateTradeGate(input);
  if (!gate.enabled) {
    throw new Error(gate.reason);
  }
  const draftValidation = validateDraftContext(input.draft.binding, {
    context: input.context,
    marketCanonicalId: input.market.canonicalId,
    metadataFingerprint: marketFingerprint(input.market),
  });
  if (!draftValidation.valid) {
    throw new Error(draftValidation.message);
  }
  const account = input.authority.account;
  if (account === null) {
    throw new Error("A current account snapshot is required for review.");
  }
  if (input.draft.size.trim() === "") {
    throw new Error("Enter an order size before review.");
  }
  const reference = currentPrice(input.market);
  if (reference === "") {
    throw new Error("A current reference price is required for review.");
  }
  if (
    input.market.family === "perp" &&
    input.draft.leverage !== account.leverage
  ) {
    throw new Error(
      "Order review must use the current account leverage. Change leverage through its separately reviewed action first.",
    );
  }
  const slippage =
    input.draft.orderType === "market" ? slippageValue(input.draft) : null;
  const intent =
    input.draft.orderType === "limit"
      ? ({
          type: "limit_order",
          assetId: input.market.orderAssetId,
          side: input.draft.side,
          size: input.draft.size.trim() as DecimalString,
          limitPrice: input.draft.limitPrice.trim() as DecimalString,
          timeInForce: input.draft.timeInForce,
          reduceOnly: input.market.family === "perp" && input.draft.reduceOnly,
          cloid: input.cloid,
        } as const)
      : ({
          type: "market_order",
          assetId: input.market.orderAssetId,
          side: input.draft.side,
          size: input.draft.size.trim() as DecimalString,
          aggressiveLimitPrice: aggressivePrice({
            reference,
            side: input.draft.side,
            slippageBps: slippage as number,
            maxDecimalPlaces:
              input.market.pricePrecision?.maxDecimalPlaces ?? 0,
            maxSignificantFigures:
              input.market.pricePrecision?.maxSignificantFigures ?? 0,
          }),
          cloid: input.cloid,
        } as const);
  const leverage = input.market.family === "spot" ? 1 : account.leverage;
  const marginMode =
    input.market.family === "spot"
      ? undefined
      : (account.marginMode ?? undefined);
  const binding = signerBindingForTradeContext(input.context);

  return createActionReview({
    binding,
    capturedContextEpoch: input.capturedContextEpoch,
    validation: {
      context: {
        network: binding.network,
        masterAccount: binding.masterAccount,
        targetAccount: binding.targetAccount,
        capturedContextEpoch: input.capturedContextEpoch,
        currentContextEpoch: input.capturedContextEpoch,
        currentNetwork: binding.network,
        currentMasterAccount: binding.masterAccount,
        currentTargetAccount: binding.targetAccount,
        reviewedAtMs: input.nowMs,
        reviewExpiresAtMs: input.nowMs + REVIEW_WINDOW_MS,
        nowMs: input.nowMs,
      },
      market: {
        canonicalId: input.market.canonicalId,
        metadataFingerprint: marketFingerprint(input.market),
        orderAssetId: input.market.orderAssetId,
        family: input.market.family,
        lifecycle: input.market.lifecycle,
        orderAvailability: input.market.orderAvailability,
        sizeDecimals: input.market.sizeDecimals,
        pricePrecision: input.market.pricePrecision,
        ...(input.market.family === "perp"
          ? {
              maxLeverage: input.market.maxLeverage,
              onlyIsolated: input.market.onlyIsolated,
            }
          : {}),
        referencePrice: reference as DecimalString,
      },
      account: {
        availableMargin: account.availableFunds,
        ...(leverage === null ? {} : { leverage }),
        ...(marginMode === undefined ? {} : { marginMode }),
        positionSize: account.positionSize,
        version: account.version,
      },
      controls: {
        slippageBps: slippage,
        trigger: null,
      },
      intent,
    },
  });
}
