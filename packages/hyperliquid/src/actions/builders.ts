import { HyperliquidValidationError } from "../errors";
import type { DecimalString } from "../numbers/decimal";
import {
  CANONICAL_POSITIVE_DECIMAL_PATTERN,
  CLOID_PATTERN,
  MAX_BULK_CANCELS,
  ZERO_DECIMAL_PATTERN,
} from "./constants";
import type {
  BulkCancelIntent,
  CancelByCloidAction,
  CancelByOidAction,
  CancelIntent,
  Cloid,
  ExchangeAction,
  LimitOrderIntent,
  LimitTimeInForce,
  MarketOrderIntent,
  OrderAction,
  OrderSide,
  OrderWire,
  ReduceOnlyCloseIntent,
  TradingActionIntent,
  UpdateLeverageAction,
  UpdateLeverageIntent,
} from "./types";

const VALID_SIDES: ReadonlySet<OrderSide> = new Set(["buy", "sell"]);
const VALID_TIFS: ReadonlySet<LimitTimeInForce> = new Set([
  "Alo",
  "Gtc",
  "Ioc",
]);

function invalid(path: string, message: string): never {
  throw new HyperliquidValidationError(path, message);
}

function validateAssetId(assetId: number, path = "assetId"): number {
  if (!Number.isSafeInteger(assetId) || assetId < 0) {
    invalid(path, "expected a non-negative safe integer");
  }
  return assetId;
}

function validatePositiveDecimal(
  value: DecimalString,
  path: string,
): DecimalString {
  if (
    !CANONICAL_POSITIVE_DECIMAL_PATTERN.test(value) ||
    ZERO_DECIMAL_PATTERN.test(value)
  ) {
    invalid(path, "expected a positive canonical decimal string");
  }
  return value;
}

export function parseCloid(value: string, path = "cloid"): Cloid {
  if (!CLOID_PATTERN.test(value)) {
    invalid(path, "expected a 128-bit 0x-prefixed client order ID");
  }
  return value.toLowerCase() as Cloid;
}

function orderWire(input: {
  readonly assetId: number;
  readonly side: OrderSide;
  readonly price: DecimalString;
  readonly size: DecimalString;
  readonly reduceOnly: boolean;
  readonly tif: LimitTimeInForce;
  readonly cloid: Cloid;
}): OrderWire {
  if (!VALID_SIDES.has(input.side)) {
    invalid("side", "expected buy or sell");
  }
  if (!VALID_TIFS.has(input.tif)) {
    invalid("timeInForce", "expected Alo, Gtc, or Ioc");
  }
  if (typeof input.reduceOnly !== "boolean") {
    invalid("reduceOnly", "expected a boolean");
  }
  return {
    a: validateAssetId(input.assetId),
    b: input.side === "buy",
    p: validatePositiveDecimal(input.price, "price"),
    s: validatePositiveDecimal(input.size, "size"),
    r: input.reduceOnly,
    t: { limit: { tif: input.tif } },
    c: parseCloid(input.cloid),
  };
}

function singleOrderAction(order: OrderWire): OrderAction {
  return { type: "order", orders: [order], grouping: "na" };
}

export function buildMarketOrderAction(
  intent: Omit<MarketOrderIntent, "type"> | MarketOrderIntent,
): OrderAction {
  if ("type" in intent && intent.type !== "market_order") {
    invalid("type", "expected market_order");
  }
  return singleOrderAction(
    orderWire({
      ...intent,
      price: intent.aggressiveLimitPrice,
      reduceOnly: false,
      tif: "Ioc",
    }),
  );
}

export function buildLimitOrderAction(
  intent: Omit<LimitOrderIntent, "type"> | LimitOrderIntent,
): OrderAction {
  if ("type" in intent && intent.type !== "limit_order") {
    invalid("type", "expected limit_order");
  }
  return singleOrderAction(
    orderWire({
      ...intent,
      price: intent.limitPrice,
      tif: intent.timeInForce,
    }),
  );
}

export function buildReduceOnlyCloseAction(
  intent: Omit<ReduceOnlyCloseIntent, "type"> | ReduceOnlyCloseIntent,
): OrderAction {
  if ("type" in intent && intent.type !== "reduce_only_close") {
    invalid("type", "expected reduce_only_close");
  }
  return singleOrderAction(
    orderWire({
      ...intent,
      price: intent.aggressiveLimitPrice,
      reduceOnly: true,
      tif: "Ioc",
    }),
  );
}

function validateOid(oid: number, path: string): number {
  if (!Number.isSafeInteger(oid) || oid < 0) {
    invalid(path, "expected a non-negative safe integer order ID");
  }
  return oid;
}

export function buildCancelAction(
  intent: Omit<CancelIntent, "type"> | CancelIntent,
): CancelByOidAction | CancelByCloidAction {
  if ("type" in intent && intent.type !== "cancel") {
    invalid("type", "expected cancel");
  }
  const assetId = validateAssetId(intent.assetId);
  return intent.target.kind === "oid"
    ? {
        type: "cancel",
        cancels: [
          { a: assetId, o: validateOid(intent.target.oid, "target.oid") },
        ],
      }
    : {
        type: "cancelByCloid",
        cancels: [{ asset: assetId, cloid: parseCloid(intent.target.cloid) }],
      };
}

export function buildBulkCancelAction(
  intent: Omit<BulkCancelIntent, "type"> | BulkCancelIntent,
): CancelByOidAction | CancelByCloidAction {
  if ("type" in intent && intent.type !== "bulk_cancel") {
    invalid("type", "expected bulk_cancel");
  }
  const { cancels } = intent;
  if (cancels.length === 0 || cancels.length > MAX_BULK_CANCELS) {
    invalid(
      "cancels",
      `expected between 1 and ${MAX_BULK_CANCELS} cancellations`,
    );
  }
  const targetKind = cancels[0]?.target.kind;
  if (cancels.some(({ target }) => target.kind !== targetKind)) {
    invalid("cancels", "cannot mix order IDs and client order IDs");
  }
  if (targetKind === "oid") {
    return {
      type: "cancel",
      cancels: cancels.map(({ assetId, target }, index) => {
        if (target.kind !== "oid") {
          invalid(`cancels[${index}].target`, "expected an order ID");
        }
        return {
          a: validateAssetId(assetId, `cancels[${index}].assetId`),
          o: validateOid(target.oid, `cancels[${index}].target.oid`),
        };
      }),
    };
  }
  return {
    type: "cancelByCloid",
    cancels: cancels.map(({ assetId, target }, index) => {
      if (target.kind !== "cloid") {
        invalid(`cancels[${index}].target`, "expected a client order ID");
      }
      return {
        asset: validateAssetId(assetId, `cancels[${index}].assetId`),
        cloid: parseCloid(target.cloid, `cancels[${index}].target.cloid`),
      };
    }),
  };
}

export function buildUpdateLeverageAction(
  intent: Omit<UpdateLeverageIntent, "type"> | UpdateLeverageIntent,
): UpdateLeverageAction {
  if ("type" in intent && intent.type !== "update_leverage") {
    invalid("type", "expected update_leverage");
  }
  if (intent.marginMode !== "cross" && intent.marginMode !== "isolated") {
    invalid("marginMode", "expected cross or isolated");
  }
  if (
    !Number.isSafeInteger(intent.leverage) ||
    intent.leverage < 1 ||
    intent.leverage > 100
  ) {
    invalid("leverage", "expected an integer between 1 and 100");
  }
  return {
    type: "updateLeverage",
    asset: validateAssetId(intent.assetId),
    isCross: intent.marginMode === "cross",
    leverage: intent.leverage,
  };
}

export function buildExchangeAction(
  intent: TradingActionIntent,
): ExchangeAction {
  switch (intent.type) {
    case "market_order":
      return buildMarketOrderAction(intent);
    case "limit_order":
      return buildLimitOrderAction(intent);
    case "reduce_only_close":
      return buildReduceOnlyCloseAction(intent);
    case "cancel":
      return buildCancelAction(intent);
    case "bulk_cancel":
      return buildBulkCancelAction(intent);
    case "update_leverage":
      return buildUpdateLeverageAction(intent);
    default:
      return invalid("type", "unsupported trading action intent");
  }
}
