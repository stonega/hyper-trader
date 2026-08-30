import { encode } from "@msgpack/msgpack";
import {
  concatBytes,
  getAddress,
  hexToBytes,
  keccak256,
  numberToBytes,
} from "viem";

import { HyperliquidValidationError } from "../errors";
import { ACTION_EXPIRY_MS } from "../nonces/allocation";
import {
  CANONICAL_POSITIVE_DECIMAL_PATTERN,
  CLOID_PATTERN,
  MAX_BULK_CANCELS,
  ZERO_DECIMAL_PATTERN,
} from "./constants";
import type { ExchangeAction, OrderWire, TriggerOrderWire } from "./types";

export interface L1ActionEncodingInput {
  readonly action: ExchangeAction;
  readonly nonce: number;
  readonly vaultAddress?: string | null;
  readonly expiresAfter?: number | null;
}

export interface EncodedL1Action {
  readonly actionBytes: Uint8Array;
  readonly actionHash: `0x${string}`;
  readonly nonce: number;
  readonly vaultAddress: `0x${string}` | null;
  readonly expiresAfter: number | null;
}

function uint64Bytes(value: number, path: string): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new HyperliquidValidationError(
      path,
      "expected a non-negative safe integer",
    );
  }
  return numberToBytes(BigInt(value), { size: 8 });
}

function normalizeVaultAddress(
  address: string | null | undefined,
): `0x${string}` | null {
  if (address == null) {
    return null;
  }
  try {
    return getAddress(address);
  } catch {
    throw new HyperliquidValidationError(
      "vaultAddress",
      "expected a 20-byte Ethereum address",
    );
  }
}

function validateExpiry(
  nonce: number,
  expiresAfter: number | null | undefined,
): number | null {
  if (expiresAfter == null) {
    return null;
  }
  uint64Bytes(expiresAfter, "expiresAfter");
  if (expiresAfter <= nonce || expiresAfter - nonce > ACTION_EXPIRY_MS) {
    throw new HyperliquidValidationError(
      "expiresAfter",
      `expected a timestamp after nonce and within ${ACTION_EXPIRY_MS} ms`,
    );
  }
  return expiresAfter;
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  path: string,
): void {
  const keys = Object.keys(value).sort();
  const canonical = [...expected].sort();
  if (
    keys.length !== canonical.length ||
    keys.some((key, index) => key !== canonical[index])
  ) {
    throw new HyperliquidValidationError(path, "unexpected wire fields");
  }
}

function objectAt(value: unknown, path: string): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new HyperliquidValidationError(path, "expected a plain object");
  }
  return value as Record<string, unknown>;
}

function assetId(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new HyperliquidValidationError(
      path,
      "expected a non-negative safe integer",
    );
  }
  return value as number;
}

function cloid(value: unknown, path: string): `0x${string}` {
  if (typeof value !== "string" || !CLOID_PATTERN.test(value)) {
    throw new HyperliquidValidationError(path, "expected a 128-bit cloid");
  }
  return value.toLowerCase() as `0x${string}`;
}

function canonicalOrderWire(
  value: unknown,
  path: string,
  kind: "limit" | "trigger",
): OrderWire {
  const order = objectAt(value, path);
  assertExactKeys(order, ["a", "b", "p", "s", "r", "t", "c"], path);
  if (typeof order.b !== "boolean" || typeof order.r !== "boolean") {
    throw new HyperliquidValidationError(
      path,
      "side and reduceOnly must be booleans",
    );
  }
  if (
    typeof order.p !== "string" ||
    !CANONICAL_POSITIVE_DECIMAL_PATTERN.test(order.p) ||
    ZERO_DECIMAL_PATTERN.test(order.p)
  ) {
    throw new HyperliquidValidationError(
      path,
      "price must be a positive canonical decimal string",
    );
  }
  if (
    typeof order.s !== "string" ||
    !CANONICAL_POSITIVE_DECIMAL_PATTERN.test(order.s) ||
    (kind === "limit"
      ? ZERO_DECIMAL_PATTERN.test(order.s)
      : !ZERO_DECIMAL_PATTERN.test(order.s))
  ) {
    throw new HyperliquidValidationError(
      `${path}.s`,
      kind === "trigger"
        ? "position TP/SL size must use the canonical zero sentinel"
        : "size must be a positive canonical decimal string",
    );
  }
  const orderType = objectAt(order.t, `${path}.t`);
  if (kind === "limit") {
    assertExactKeys(orderType, ["limit"], `${path}.t`);
    const limit = objectAt(orderType.limit, `${path}.t.limit`);
    assertExactKeys(limit, ["tif"], `${path}.t.limit`);
    if (limit.tif !== "Alo" && limit.tif !== "Gtc" && limit.tif !== "Ioc") {
      throw new HyperliquidValidationError(
        `${path}.t.limit.tif`,
        "unknown time in force",
      );
    }
    return {
      a: assetId(order.a, `${path}.a`),
      b: order.b,
      p: order.p,
      s: order.s,
      r: order.r,
      t: { limit: { tif: limit.tif } },
      c: cloid(order.c, `${path}.c`),
    };
  }
  assertExactKeys(orderType, ["trigger"], `${path}.t`);
  const trigger = objectAt(orderType.trigger, `${path}.t.trigger`);
  assertExactKeys(
    trigger,
    ["isMarket", "triggerPx", "tpsl"],
    `${path}.t.trigger`,
  );
  if (
    order.r !== true ||
    trigger.isMarket !== true ||
    (trigger.tpsl !== "tp" && trigger.tpsl !== "sl") ||
    typeof trigger.triggerPx !== "string" ||
    !CANONICAL_POSITIVE_DECIMAL_PATTERN.test(trigger.triggerPx) ||
    ZERO_DECIMAL_PATTERN.test(trigger.triggerPx)
  ) {
    throw new HyperliquidValidationError(
      `${path}.t.trigger`,
      "expected a reduce-only market TP/SL trigger",
    );
  }
  return {
    a: assetId(order.a, `${path}.a`),
    b: order.b,
    p: order.p,
    s: order.s,
    r: true,
    t: {
      trigger: {
        isMarket: true,
        triggerPx: trigger.triggerPx,
        tpsl: trigger.tpsl,
      },
    },
    c: cloid(order.c, `${path}.c`),
  } satisfies TriggerOrderWire;
}

function canonicalizeExchangeAction(action: ExchangeAction): ExchangeAction {
  const raw = objectAt(action, "action");
  switch (raw.type) {
    case "order": {
      assertExactKeys(raw, ["type", "orders", "grouping"], "action");
      if (
        (raw.grouping !== "na" && raw.grouping !== "positionTpsl") ||
        !Array.isArray(raw.orders) ||
        raw.orders.length !== 1
      ) {
        throw new HyperliquidValidationError(
          "action.orders",
          "expected one supported order",
        );
      }
      return {
        type: "order",
        orders: [
          canonicalOrderWire(
            raw.orders[0],
            "action.orders[0]",
            raw.grouping === "na" ? "limit" : "trigger",
          ),
        ],
        grouping: raw.grouping,
      };
    }
    case "modify": {
      assertExactKeys(raw, ["type", "oid", "order"], "action");
      if (!Number.isSafeInteger(raw.oid) || (raw.oid as number) < 1) {
        throw new HyperliquidValidationError(
          "action.oid",
          "expected a positive order ID",
        );
      }
      return {
        type: "modify",
        oid: raw.oid as number,
        order: canonicalOrderWire(
          raw.order,
          "action.order",
          "trigger",
        ) as TriggerOrderWire,
      };
    }
    case "cancel": {
      assertExactKeys(raw, ["type", "cancels"], "action");
      if (
        !Array.isArray(raw.cancels) ||
        raw.cancels.length < 1 ||
        raw.cancels.length > MAX_BULK_CANCELS
      ) {
        throw new HyperliquidValidationError("action.cancels", "invalid count");
      }
      return {
        type: "cancel",
        cancels: raw.cancels.map((value, index) => {
          const cancel = objectAt(value, `action.cancels[${index}]`);
          assertExactKeys(cancel, ["a", "o"], `action.cancels[${index}]`);
          if (!Number.isSafeInteger(cancel.o) || (cancel.o as number) < 0) {
            throw new HyperliquidValidationError(
              `action.cancels[${index}].o`,
              "invalid order ID",
            );
          }
          return {
            a: assetId(cancel.a, `action.cancels[${index}].a`),
            o: cancel.o as number,
          };
        }),
      };
    }
    case "cancelByCloid": {
      assertExactKeys(raw, ["type", "cancels"], "action");
      if (
        !Array.isArray(raw.cancels) ||
        raw.cancels.length < 1 ||
        raw.cancels.length > MAX_BULK_CANCELS
      ) {
        throw new HyperliquidValidationError("action.cancels", "invalid count");
      }
      return {
        type: "cancelByCloid",
        cancels: raw.cancels.map((value, index) => {
          const cancel = objectAt(value, `action.cancels[${index}]`);
          assertExactKeys(
            cancel,
            ["asset", "cloid"],
            `action.cancels[${index}]`,
          );
          return {
            asset: assetId(cancel.asset, `action.cancels[${index}].asset`),
            cloid: cloid(cancel.cloid, `action.cancels[${index}].cloid`),
          };
        }),
      };
    }
    case "updateLeverage": {
      assertExactKeys(raw, ["type", "asset", "isCross", "leverage"], "action");
      if (
        typeof raw.isCross !== "boolean" ||
        !Number.isSafeInteger(raw.leverage) ||
        (raw.leverage as number) < 1 ||
        (raw.leverage as number) > 100
      ) {
        throw new HyperliquidValidationError(
          "action.updateLeverage",
          "invalid margin mode or leverage",
        );
      }
      return {
        type: "updateLeverage",
        asset: assetId(raw.asset, "action.asset"),
        isCross: raw.isCross,
        leverage: raw.leverage as number,
      };
    }
    default:
      throw new HyperliquidValidationError(
        "action.type",
        "unsupported exchange action discriminator",
      );
  }
}

export function encodeL1Action(input: L1ActionEncodingInput): EncodedL1Action {
  const nonceBytes = uint64Bytes(input.nonce, "nonce");
  const actionBytes = encode(canonicalizeExchangeAction(input.action));
  const vaultAddress = normalizeVaultAddress(input.vaultAddress);
  const expiresAfter = validateExpiry(input.nonce, input.expiresAfter);
  const vaultBytes =
    vaultAddress === null
      ? new Uint8Array([0])
      : concatBytes([new Uint8Array([1]), hexToBytes(vaultAddress)]);
  const expiryBytes =
    expiresAfter === null
      ? new Uint8Array()
      : concatBytes([
          new Uint8Array([0]),
          uint64Bytes(expiresAfter, "expiresAfter"),
        ]);
  const preimage = concatBytes([
    actionBytes,
    nonceBytes,
    vaultBytes,
    expiryBytes,
  ]);
  return {
    actionBytes,
    actionHash: keccak256(preimage),
    nonce: input.nonce,
    vaultAddress,
    expiresAfter,
  };
}
