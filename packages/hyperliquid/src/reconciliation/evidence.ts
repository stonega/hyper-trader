import { CLOID_PATTERN } from "../actions/constants";
import type { ObservedOrderEvidence } from "./policy";

const CANCELED_ORDER_STATUSES: ReadonlySet<string> = new Set([
  "canceled",
  "marginCanceled",
  "vaultWithdrawalCanceled",
  "openInterestCapCanceled",
  "selfTradeCanceled",
  "reduceOnlyCanceled",
  "siblingFilledCanceled",
  "delistedCanceled",
  "liquidatedCanceled",
  "scheduledCancel",
]);

const REJECTED_ORDER_STATUSES: ReadonlySet<string> = new Set([
  "rejected",
  "tickRejected",
  "minTradeNtlRejected",
  "perpMarginRejected",
  "reduceOnlyRejected",
  "badAloPxRejected",
  "iocCancelRejected",
  "badTriggerPxRejected",
  "marketOrderNoLiquidityRejected",
  "positionIncreaseAtOpenInterestCapRejected",
  "positionFlipAtOpenInterestCapRejected",
  "tooAggressiveAtOpenInterestCapRejected",
  "openInterestIncreaseRejected",
  "insufficientSpotBalanceRejected",
  "oracleRejected",
  "perpMaxPositionRejected",
]);

function objectAt(value: unknown): Record<string, unknown> | null {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
    ? (value as Record<string, unknown>)
    : null;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  return (
    Object.keys(value).length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  );
}

function lifecycle(
  status: unknown,
): Extract<ObservedOrderEvidence, { readonly kind: "order" }>["status"] | null {
  if (status === "open" || status === "filled" || status === "triggered") {
    return status;
  }
  if (typeof status !== "string") return null;
  if (CANCELED_ORDER_STATUSES.has(status)) return "canceled";
  if (REJECTED_ORDER_STATUSES.has(status)) return "rejected";
  return null;
}

/**
 * Converts the documented `orderStatus` response to bounded reconciliation
 * evidence. Unknown provider vocabulary remains malformed and therefore can
 * never authorize expiry or a duplicate action.
 */
export function parseAuthoritativeOrderStatus(
  payload: unknown,
  expected: {
    readonly assetId: number;
    readonly oid: number | null;
    readonly cloid: string | null;
  },
): ObservedOrderEvidence {
  try {
    if (
      (expected.oid === null) === (expected.cloid === null) ||
      (expected.oid !== null &&
        (!Number.isSafeInteger(expected.oid) || expected.oid < 0)) ||
      (expected.cloid !== null && !CLOID_PATTERN.test(expected.cloid))
    ) {
      return { kind: "malformed" };
    }
    const root = objectAt(payload);
    if (root === null) return { kind: "malformed" };
    if (root.status === "unknownOid") {
      return exactKeys(root, ["status"])
        ? { kind: "unknown" }
        : { kind: "malformed" };
    }
    if (root.status !== "order" || !exactKeys(root, ["status", "order"])) {
      return { kind: "malformed" };
    }
    const wrapper = objectAt(root.order);
    const order = wrapper === null ? null : objectAt(wrapper.order);
    const status = wrapper === null ? null : lifecycle(wrapper.status);
    if (
      order === null ||
      status === null ||
      !Number.isSafeInteger(order.oid) ||
      (order.oid as number) < 0 ||
      (order.cloid !== undefined &&
        order.cloid !== null &&
        (typeof order.cloid !== "string" || !CLOID_PATTERN.test(order.cloid)))
    ) {
      return { kind: "malformed" };
    }
    const oid = order.oid as number;
    const cloid =
      typeof order.cloid === "string" ? order.cloid.toLowerCase() : null;
    const expectedCloid = expected.cloid?.toLowerCase() ?? null;
    if (
      (expected.oid !== null && expected.oid !== oid) ||
      (expectedCloid !== null && expectedCloid !== cloid)
    ) {
      return { kind: "malformed" };
    }
    return {
      kind: "order",
      assetId: expected.assetId,
      oid,
      cloid,
      status,
    };
  } catch {
    return { kind: "malformed" };
  }
}
