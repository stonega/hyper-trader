import { getAddress } from "viem";

import { HyperliquidValidationError } from "../errors";
import type { HyperliquidNetwork } from "../network";
import type { DecimalString } from "../numbers/decimal";
import {
  type PricePrecisionInputs,
  pricePrecisionForSizeDecimals,
} from "../numbers/precision";
import { assertTestnetSigningCapability } from "../signing/boundary";
import { parseCloid } from "./builders";
import { MINIMUM_ORDER_NOTIONAL_MESSAGE } from "./constants";
import type {
  CancelIntent,
  LimitOrderIntent,
  MarketOrderIntent,
  ReduceOnlyCloseIntent,
  TradingActionIntent,
  UpdateLeverageIntent,
} from "./types";

interface ParsedDecimal {
  readonly coefficient: bigint;
  readonly scale: number;
}

const DECIMAL_INPUT_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const MAX_DECIMAL_INPUT_LENGTH = 256;
const MAX_SLIPPAGE_BPS = 500;

function invalid(path: string, message: string): never {
  throw new HyperliquidValidationError(path, message);
}

function parseDecimal(value: unknown, path: string): ParsedDecimal {
  if (
    typeof value !== "string" ||
    value.length > MAX_DECIMAL_INPUT_LENGTH ||
    !DECIMAL_INPUT_PATTERN.test(value)
  ) {
    return invalid(path, "expected a canonical decimal string");
  }
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [integer = "0", fraction = ""] = unsigned.split(".");
  const trimmedFraction = fraction.replace(/0+$/, "");
  const digits = `${integer}${trimmedFraction}`.replace(/^0+(?=\d)/, "");
  const coefficient = BigInt(digits === "" ? "0" : digits);
  return {
    coefficient: negative ? -coefficient : coefficient,
    scale: trimmedFraction.length,
  };
}

function assertExactFields(
  value: object,
  expected: readonly string[],
  path: string,
): void {
  if (
    Object.keys(value).length !== expected.length ||
    !expected.every((key) => Object.hasOwn(value, key))
  ) {
    invalid(path, "unexpected or missing fields");
  }
}

function powerOfTen(scale: number): bigint {
  return 10n ** BigInt(scale);
}

function formatDecimal(value: ParsedDecimal): DecimalString {
  if (value.coefficient === 0n) return "0";
  const negative = value.coefficient < 0n;
  const digits = (negative ? -value.coefficient : value.coefficient).toString();
  if (value.scale === 0) return `${negative ? "-" : ""}${digits}`;
  const padded = digits.padStart(value.scale + 1, "0");
  const split = padded.length - value.scale;
  return `${negative ? "-" : ""}${padded.slice(0, split)}.${padded.slice(split)}`;
}

function normalizeDecimal(value: unknown, path: string): DecimalString {
  return formatDecimal(parseDecimal(value, path));
}

function compareDecimal(left: ParsedDecimal, right: ParsedDecimal): number {
  const scale = Math.max(left.scale, right.scale);
  const a = left.coefficient * powerOfTen(scale - left.scale);
  const b = right.coefficient * powerOfTen(scale - right.scale);
  return a < b ? -1 : a > b ? 1 : 0;
}

function multiplyDecimal(
  left: ParsedDecimal,
  right: ParsedDecimal,
): ParsedDecimal {
  const raw = {
    coefficient: left.coefficient * right.coefficient,
    scale: left.scale + right.scale,
  };
  let coefficient = raw.coefficient;
  let scale = raw.scale;
  while (scale > 0 && coefficient % 10n === 0n) {
    coefficient /= 10n;
    scale -= 1;
  }
  return { coefficient, scale };
}

function positiveDecimal(value: unknown, path: string): DecimalString {
  const parsed = parseDecimal(value, path);
  if (parsed.coefficient <= 0n) {
    return invalid(path, "expected a positive decimal value");
  }
  return formatDecimal(parsed);
}

function normalizeAddress(value: string, path: string): string {
  try {
    return getAddress(value).toLowerCase();
  } catch {
    return invalid(path, "expected a 20-byte Ethereum address");
  }
}

function safeInteger(value: number, path: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || value < minimum) {
    return invalid(path, `expected a safe integer of at least ${minimum}`);
  }
  return value;
}

export interface ActionValidationContext {
  readonly network: HyperliquidNetwork;
  readonly masterAccount: string;
  readonly targetAccount: string;
  readonly capturedContextEpoch: number;
  readonly currentContextEpoch: number;
  readonly currentNetwork: HyperliquidNetwork;
  readonly currentMasterAccount: string;
  readonly currentTargetAccount: string;
  readonly reviewedAtMs: number;
  readonly reviewExpiresAtMs: number;
  readonly nowMs: number;
}

export interface ActionMarketRules {
  readonly canonicalId: string;
  readonly metadataFingerprint: string;
  readonly orderAssetId: number;
  readonly family: "perp" | "spot" | "outcome";
  readonly lifecycle: "active" | "delisted";
  readonly orderAvailability: "enabled" | "browse_only";
  readonly sizeDecimals: number | null;
  readonly pricePrecision: PricePrecisionInputs | null;
  readonly maxLeverage?: number;
  readonly onlyIsolated?: boolean;
  readonly referencePrice?: DecimalString | null;
  readonly minimumNotional?: DecimalString | null;
}

export interface CurrentOpenOrderIdentity {
  readonly assetId: number;
  readonly oid?: number;
  readonly cloid?: string;
}

export interface ActionAccountRules {
  readonly availableMargin: DecimalString;
  readonly leverage?: number;
  readonly marginMode?: "cross" | "isolated";
  readonly positionSize?: DecimalString;
  readonly openOrders?: readonly CurrentOpenOrderIdentity[];
  readonly version: number;
}

export interface TriggerControl {
  readonly price: DecimalString;
  readonly direction: "above" | "below";
}

export interface ActionControls {
  readonly slippageBps: number | null;
  readonly trigger: TriggerControl | null;
}

export interface TradingActionValidationInput {
  readonly context: ActionValidationContext;
  readonly market: ActionMarketRules;
  readonly account: ActionAccountRules;
  readonly controls: ActionControls;
  readonly intent: TradingActionIntent;
}

export interface ValidatedTradingAction {
  readonly intent: TradingActionIntent;
  readonly notional: DecimalString | null;
  readonly accountStateVersion: number;
  readonly marketCanonicalId: string;
}

function assertCurrentContext(context: ActionValidationContext): void {
  assertTestnetSigningCapability(context.network);
  safeInteger(context.capturedContextEpoch, "context.capturedContextEpoch");
  safeInteger(context.currentContextEpoch, "context.currentContextEpoch");
  safeInteger(context.reviewedAtMs, "context.reviewedAtMs");
  safeInteger(context.reviewExpiresAtMs, "context.reviewExpiresAtMs");
  safeInteger(context.nowMs, "context.nowMs");
  if (context.currentNetwork !== context.network) {
    invalid("context.network", "the active network changed after review");
  }
  if (context.capturedContextEpoch !== context.currentContextEpoch) {
    invalid("context.epoch", "the active trading context changed after review");
  }
  const master = normalizeAddress(
    context.masterAccount,
    "context.masterAccount",
  );
  const target = normalizeAddress(
    context.targetAccount,
    "context.targetAccount",
  );
  if (
    normalizeAddress(
      context.currentMasterAccount,
      "context.currentMasterAccount",
    ) !== master
  ) {
    invalid(
      "context.masterAccount",
      "the active master account changed after review",
    );
  }
  if (
    normalizeAddress(
      context.currentTargetAccount,
      "context.currentTargetAccount",
    ) !== target
  ) {
    invalid(
      "context.targetAccount",
      "the active target account changed after review",
    );
  }
  if (
    context.reviewExpiresAtMs <= context.reviewedAtMs ||
    context.nowMs >= context.reviewExpiresAtMs
  ) {
    invalid(
      "context.review",
      "the reviewed action expired and must be reviewed again",
    );
  }
}

function assertTradableMarket(
  market: ActionMarketRules,
  assetId: number,
): void {
  if (
    typeof market.canonicalId !== "string" ||
    market.canonicalId.length < 1 ||
    market.canonicalId.length > 256 ||
    !/^[A-Za-z0-9:._/-]+$/.test(market.canonicalId)
  ) {
    invalid(
      "market.canonicalId",
      "expected a bounded canonical market identity",
    );
  }
  if (
    typeof market.metadataFingerprint !== "string" ||
    market.metadataFingerprint.length < 1 ||
    market.metadataFingerprint.length > 2_048 ||
    hasControlCharacter(market.metadataFingerprint)
  ) {
    invalid(
      "market.metadataFingerprint",
      "expected a bounded metadata fingerprint",
    );
  }
  if (
    market.family !== "perp" &&
    market.family !== "spot" &&
    market.family !== "outcome"
  ) {
    invalid("market.family", "unknown market family");
  }
  if (market.lifecycle !== "active" || market.orderAvailability !== "enabled") {
    invalid(
      "market.tradability",
      "the current market is not available for trading",
    );
  }
  if (market.family === "outcome") {
    invalid("market.family", "outcome trading is browse-only in this build");
  }
  if (safeInteger(market.orderAssetId, "market.orderAssetId") !== assetId) {
    invalid(
      "intent.assetId",
      "the action asset does not match the current market",
    );
  }
  if (market.sizeDecimals === null || market.pricePrecision === null) {
    invalid("market.precision", "current precision metadata is unavailable");
  }
  const expectedPrecision = pricePrecisionForSizeDecimals(
    market.family,
    safeInteger(market.sizeDecimals, "market.sizeDecimals"),
  );
  if (
    expectedPrecision === null ||
    market.pricePrecision.maxSignificantFigures !==
      expectedPrecision.maxSignificantFigures ||
    !Number.isSafeInteger(market.pricePrecision.maxDecimalPlaces) ||
    market.pricePrecision.maxDecimalPlaces < 0 ||
    market.pricePrecision.maxDecimalPlaces > expectedPrecision.maxDecimalPlaces
  ) {
    invalid(
      "market.pricePrecision",
      "precision metadata does not match the current market family",
    );
  }
  if (
    market.onlyIsolated !== undefined &&
    typeof market.onlyIsolated !== "boolean"
  ) {
    invalid("market.onlyIsolated", "expected a boolean");
  }
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.charCodeAt(index);
    if (codePoint < 32 || codePoint === 127) {
      return true;
    }
  }
  return false;
}

function normalizeSize(
  value: DecimalString,
  market: ActionMarketRules,
): DecimalString {
  const normalized = positiveDecimal(value, "intent.size");
  const parsed = parseDecimal(normalized, "intent.size");
  if (market.sizeDecimals === null || parsed.scale > market.sizeDecimals) {
    invalid("intent.size", "size exceeds the current market precision");
  }
  return normalized;
}

function normalizePrice(
  value: DecimalString,
  market: ActionMarketRules,
): DecimalString {
  const normalized = positiveDecimal(value, "intent.price");
  const parsed = parseDecimal(normalized, "intent.price");
  const precision = market.pricePrecision;
  if (precision === null || parsed.scale > precision.maxDecimalPlaces) {
    invalid("intent.price", "price exceeds the current decimal-place limit");
  }
  const significantDigits = (
    parsed.coefficient < 0n ? -parsed.coefficient : parsed.coefficient
  )
    .toString()
    .replace(/^0+/, "").length;
  if (parsed.scale > 0 && significantDigits > precision.maxSignificantFigures) {
    invalid(
      "intent.price",
      "price exceeds the current significant-figure limit",
    );
  }
  return normalized;
}

function assertSlippage(
  input: TradingActionValidationInput,
  side: "buy" | "sell",
  aggressivePrice: DecimalString,
): void {
  const bps = input.controls.slippageBps;
  if (
    !Number.isSafeInteger(bps) ||
    bps === null ||
    bps < 0 ||
    bps > MAX_SLIPPAGE_BPS
  ) {
    invalid(
      "controls.slippageBps",
      `expected whole basis points between 0 and ${MAX_SLIPPAGE_BPS}`,
    );
  }
  if (input.market.referencePrice == null) {
    invalid("market.referencePrice", "a current reference price is required");
  }
  const aggressive = parseDecimal(aggressivePrice, "intent.price");
  const reference = parseDecimal(
    positiveDecimal(input.market.referencePrice, "market.referencePrice"),
    "market.referencePrice",
  );
  const multiplier = {
    coefficient: BigInt(side === "buy" ? 10_000 + bps : 10_000 - bps),
    scale: 0,
  };
  const left = multiplyDecimal(aggressive, { coefficient: 10_000n, scale: 0 });
  const right = multiplyDecimal(reference, multiplier);
  if (
    (side === "buy" && compareDecimal(left, right) > 0) ||
    (side === "sell" && compareDecimal(left, right) < 0)
  ) {
    invalid(
      "intent.price",
      "aggressive price exceeds the reviewed slippage bound",
    );
  }
}

function positionSize(account: ActionAccountRules): ParsedDecimal {
  return parseDecimal(account.positionSize ?? "0", "account.positionSize");
}

function assertReduceOnly(
  input: TradingActionValidationInput,
  side: "buy" | "sell",
  size: DecimalString,
  requireFullClose: boolean,
): void {
  if (input.market.family !== "perp") {
    invalid(
      "intent.reduceOnly",
      "reduce-only actions require a perpetual market",
    );
  }
  const position = positionSize(input.account);
  if (position.coefficient === 0n) {
    invalid("account.positionSize", "there is no position to reduce");
  }
  const reducingSide = position.coefficient > 0n ? "sell" : "buy";
  if (side !== reducingSide) {
    invalid(
      "intent.side",
      "reduce-only side would increase or reverse the position",
    );
  }
  const absolutePosition = {
    coefficient:
      position.coefficient < 0n ? -position.coefficient : position.coefficient,
    scale: position.scale,
  };
  const requested = parseDecimal(size, "intent.size");
  const comparison = compareDecimal(requested, absolutePosition);
  if (comparison > 0 || (requireFullClose && comparison !== 0)) {
    invalid(
      "intent.size",
      requireFullClose
        ? "a close must use the full position size"
        : "reduce-only size exceeds the current position",
    );
  }
}

function assertMargin(
  input: TradingActionValidationInput,
  notional: ParsedDecimal,
  reduceOnly: boolean,
): void {
  if (reduceOnly) return;
  const minimum = input.market.minimumNotional;
  if (
    minimum != null &&
    compareDecimal(
      notional,
      parseDecimal(
        positiveDecimal(minimum, "market.minimumNotional"),
        "market.minimumNotional",
      ),
    ) < 0
  ) {
    invalid("intent.notional", MINIMUM_ORDER_NOTIONAL_MESSAGE);
  }
  const leverage = input.market.family === "spot" ? 1 : input.account.leverage;
  if (!Number.isSafeInteger(leverage) || leverage == null || leverage < 1) {
    invalid("account.leverage", "current leverage is unavailable");
  }
  const maxLeverage =
    input.market.family === "spot" ? 1 : input.market.maxLeverage;
  if (
    !Number.isSafeInteger(maxLeverage) ||
    maxLeverage == null ||
    leverage > maxLeverage
  ) {
    invalid("account.leverage", "leverage exceeds the current market maximum");
  }
  if (input.market.onlyIsolated && input.account.marginMode !== "isolated") {
    invalid("account.marginMode", "this market requires isolated margin");
  }
  const available = parseDecimal(
    normalizeDecimal(input.account.availableMargin, "account.availableMargin"),
    "account.availableMargin",
  );
  const leveragedAvailable = multiplyDecimal(available, {
    coefficient: BigInt(leverage),
    scale: 0,
  });
  if (compareDecimal(notional, leveragedAvailable) > 0) {
    invalid(
      "account.availableMargin",
      "insufficient current margin for this action",
    );
  }
}

function validateOrder(
  input: TradingActionValidationInput,
  intent: MarketOrderIntent | LimitOrderIntent | ReduceOnlyCloseIntent,
): ValidatedTradingAction {
  assertExactFields(
    intent,
    intent.type === "limit_order"
      ? [
          "type",
          "assetId",
          "side",
          "size",
          "limitPrice",
          "timeInForce",
          "reduceOnly",
          "cloid",
        ]
      : ["type", "assetId", "side", "size", "aggressiveLimitPrice", "cloid"],
    "intent.fields",
  );
  if (intent.side !== "buy" && intent.side !== "sell") {
    invalid("intent.side", "expected buy or sell");
  }
  if (
    intent.type === "limit_order" &&
    intent.timeInForce !== "Alo" &&
    intent.timeInForce !== "Gtc" &&
    intent.timeInForce !== "Ioc"
  ) {
    invalid("intent.timeInForce", "expected Alo, Gtc, or Ioc");
  }
  if (intent.type === "limit_order" && typeof intent.reduceOnly !== "boolean") {
    invalid("intent.reduceOnly", "expected a boolean");
  }
  assertTradableMarket(
    input.market,
    safeInteger(intent.assetId, "intent.assetId"),
  );
  if (input.controls.trigger !== null) {
    positiveDecimal(input.controls.trigger.price, "controls.trigger.price");
    if (
      input.controls.trigger.direction !== "above" &&
      input.controls.trigger.direction !== "below"
    ) {
      invalid("controls.trigger.direction", "expected above or below");
    }
    invalid(
      "controls.trigger",
      "trigger orders are not encoded by this action version",
    );
  }
  const size = normalizeSize(intent.size, input.market);
  const rawPrice =
    intent.type === "limit_order"
      ? intent.limitPrice
      : intent.aggressiveLimitPrice;
  const price = normalizePrice(rawPrice, input.market);
  const notional = multiplyDecimal(
    parseDecimal(size, "intent.size"),
    parseDecimal(price, "intent.price"),
  );
  if (intent.type !== "limit_order") {
    assertSlippage(input, intent.side, price);
  } else if (input.controls.slippageBps !== null) {
    invalid(
      "controls.slippageBps",
      "slippage applies only to market execution",
    );
  }
  if (intent.type === "reduce_only_close") {
    assertReduceOnly(input, intent.side, size, true);
  } else if (intent.type === "limit_order" && intent.reduceOnly) {
    assertReduceOnly(input, intent.side, size, false);
  }
  assertMargin(
    input,
    notional,
    intent.type === "reduce_only_close" ||
      (intent.type === "limit_order" && intent.reduceOnly),
  );
  const cloid = parseCloid(intent.cloid);
  const normalizedIntent: TradingActionIntent =
    intent.type === "limit_order"
      ? { ...intent, size, limitPrice: price, cloid }
      : intent.type === "market_order"
        ? {
            ...intent,
            size,
            aggressiveLimitPrice: price,
            cloid,
          }
        : {
            ...intent,
            size,
            aggressiveLimitPrice: price,
            cloid,
          };
  return {
    intent: normalizedIntent,
    notional: formatDecimal(notional),
    accountStateVersion: safeInteger(input.account.version, "account.version"),
    marketCanonicalId: input.market.canonicalId,
  };
}

function validateCancel(
  input: TradingActionValidationInput,
  intent: CancelIntent,
): ValidatedTradingAction {
  assertExactFields(intent, ["type", "assetId", "target"], "intent.fields");
  if (intent.target.kind !== "oid" && intent.target.kind !== "cloid") {
    invalid("intent.target.kind", "expected oid or cloid");
  }
  assertExactFields(
    intent.target,
    intent.target.kind === "oid" ? ["kind", "oid"] : ["kind", "cloid"],
    "intent.target.fields",
  );
  assertTradableMarket(
    input.market,
    safeInteger(intent.assetId, "intent.assetId"),
  );
  if (input.controls.slippageBps !== null || input.controls.trigger !== null) {
    invalid("controls", "cancel does not accept slippage or trigger controls");
  }
  const orders = input.account.openOrders;
  if (orders === undefined) {
    invalid("account.openOrders", "current open-order evidence is required");
  }
  const targetCloid =
    intent.target.kind === "cloid" ? parseCloid(intent.target.cloid) : null;
  if (intent.target.kind === "oid") {
    safeInteger(intent.target.oid, "intent.target.oid", 1);
  }
  const matched = orders.some((order) => {
    if (order.assetId !== intent.assetId) return false;
    return intent.target.kind === "oid"
      ? order.oid === intent.target.oid
      : order.cloid != null &&
          parseCloid(order.cloid, "account.openOrders.cloid") === targetCloid;
  });
  if (!matched) {
    invalid(
      "intent.target",
      "the exact order is not open in current account state",
    );
  }
  const normalizedIntent: CancelIntent =
    intent.target.kind === "cloid"
      ? {
          ...intent,
          target: {
            kind: "cloid",
            cloid: targetCloid as NonNullable<typeof targetCloid>,
          },
        }
      : intent;
  return {
    intent: normalizedIntent,
    notional: null,
    accountStateVersion: safeInteger(input.account.version, "account.version"),
    marketCanonicalId: input.market.canonicalId,
  };
}

function validateLeverage(
  input: TradingActionValidationInput,
  intent: UpdateLeverageIntent,
): ValidatedTradingAction {
  assertExactFields(
    intent,
    ["type", "assetId", "leverage", "marginMode"],
    "intent.fields",
  );
  if (intent.marginMode !== "cross" && intent.marginMode !== "isolated") {
    invalid("intent.marginMode", "expected cross or isolated");
  }
  assertTradableMarket(
    input.market,
    safeInteger(intent.assetId, "intent.assetId"),
  );
  if (input.market.family !== "perp") {
    invalid("intent.type", "leverage updates require a perpetual market");
  }
  if (input.controls.slippageBps !== null || input.controls.trigger !== null) {
    invalid("controls", "leverage updates do not accept order controls");
  }
  const max = input.market.maxLeverage;
  if (
    !Number.isSafeInteger(intent.leverage) ||
    intent.leverage < 1 ||
    !Number.isSafeInteger(max) ||
    max == null ||
    intent.leverage > Math.min(max, 100)
  ) {
    invalid("intent.leverage", "leverage exceeds the current market maximum");
  }
  if (input.market.onlyIsolated && intent.marginMode !== "isolated") {
    invalid("intent.marginMode", "this market requires isolated margin");
  }
  return {
    intent,
    notional: null,
    accountStateVersion: safeInteger(input.account.version, "account.version"),
    marketCanonicalId: input.market.canonicalId,
  };
}

export function validateTradingAction(
  input: TradingActionValidationInput,
): ValidatedTradingAction {
  assertCurrentContext(input.context);
  if (
    input.account.marginMode !== undefined &&
    input.account.marginMode !== "cross" &&
    input.account.marginMode !== "isolated"
  ) {
    invalid("account.marginMode", "expected cross or isolated");
  }
  switch (input.intent.type) {
    case "market_order":
    case "limit_order":
    case "reduce_only_close":
      return validateOrder(input, input.intent);
    case "cancel":
      return validateCancel(input, input.intent);
    case "update_leverage":
      return validateLeverage(input, input.intent);
    case "bulk_cancel":
      return invalid(
        "intent.type",
        "bulk cancel is not a reviewed U7 public action",
      );
    default:
      return invalid("intent.type", "unsupported trading action intent");
  }
}
