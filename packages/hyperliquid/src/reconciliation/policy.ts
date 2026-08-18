import { getAddress } from "viem";

import { HyperliquidValidationError } from "../errors";
import type { HyperliquidNetwork } from "../network";
import { assertTestnetSigningCapability } from "../signing/boundary";
import type {
  JournalActionType,
  JournalState,
  SecretFreeIntent,
} from "./types";

export interface ReconciliationRecord {
  readonly network: HyperliquidNetwork;
  readonly masterAccount: string;
  readonly targetAccount: string;
  readonly actionType: JournalActionType;
  readonly assetId: number | null;
  readonly cloid: string | null;
  readonly targetOid: number | null;
  readonly expiresAfterMs: number;
  readonly normalizedSecretFreeIntent: SecretFreeIntent;
}

export type ObservedOrderEvidence =
  | { readonly kind: "unknown" }
  | { readonly kind: "malformed" }
  | {
      readonly kind: "order";
      readonly assetId: number;
      readonly oid: number;
      readonly cloid: string | null;
      readonly status:
        | "open"
        | "filled"
        | "canceled"
        | "triggered"
        | "rejected";
    };

export interface ObservedOrderIdentity {
  readonly assetId: number;
  readonly oid: number;
  readonly cloid: string | null;
}

export interface ObservedPositionEvidence {
  readonly assetId: number;
  readonly size: string;
}

export interface ObservedLeverageEvidence {
  readonly assetId: number;
  readonly leverage: number;
  readonly marginMode: "cross" | "isolated";
  readonly causallyAttributed: boolean;
}

export interface ReconciliationEvidence {
  readonly context: {
    readonly network: HyperliquidNetwork;
    readonly masterAccount: string;
    readonly targetAccount: string;
    readonly assetId: number | null;
  };
  readonly serverTimeMs: number;
  readonly complete: boolean;
  readonly order: ObservedOrderEvidence;
  readonly openOrders: readonly ObservedOrderIdentity[];
  readonly fills: readonly ObservedOrderIdentity[];
  readonly position: ObservedPositionEvidence | null;
  readonly leverage?: ObservedLeverageEvidence | null;
  readonly stateVersion: number;
  readonly definitiveRejection?: boolean;
}

export type ReconciliationDecision =
  | {
      readonly kind: "terminal";
      readonly state: Extract<
        JournalState,
        "accepted" | "rejected" | "expired" | "reconciled_ambiguous"
      >;
    }
  | {
      readonly kind: "unresolved";
      readonly reason:
        | "incomplete_evidence"
        | "before_expiry"
        | "action_still_pending";
    };

function invalid(path: string, message: string): never {
  throw new HyperliquidValidationError(path, message);
}

function normalizeAddress(value: string, path: string): string {
  try {
    return getAddress(value).toLowerCase();
  } catch {
    return invalid(path, "expected a 20-byte Ethereum address");
  }
}

function safeTime(value: number, path: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    return invalid(path, "expected a non-negative safe integer");
  }
  return value;
}

function assertContext(
  record: ReconciliationRecord,
  evidence: ReconciliationEvidence,
): void {
  assertTestnetSigningCapability(record.network);
  assertTestnetSigningCapability(evidence.context.network);
  if (
    record.network !== evidence.context.network ||
    normalizeAddress(record.masterAccount, "record.masterAccount") !==
      normalizeAddress(
        evidence.context.masterAccount,
        "evidence.masterAccount",
      ) ||
    normalizeAddress(record.targetAccount, "record.targetAccount") !==
      normalizeAddress(
        evidence.context.targetAccount,
        "evidence.targetAccount",
      ) ||
    record.assetId !== evidence.context.assetId
  ) {
    invalid(
      "evidence.context",
      "reconciliation evidence crossed an action context",
    );
  }
  safeTime(record.expiresAfterMs, "record.expiresAfterMs");
  safeTime(evidence.serverTimeMs, "evidence.serverTimeMs");
  safeTime(evidence.stateVersion, "evidence.stateVersion");
}

function sameIdentity(
  record: ReconciliationRecord,
  identity: ObservedOrderIdentity,
): boolean {
  if (record.assetId !== identity.assetId) return false;
  if (record.cloid !== null) {
    return identity.cloid?.toLowerCase() === record.cloid.toLowerCase();
  }
  return record.targetOid !== null && identity.oid === record.targetOid;
}

function exactObservedOrder(
  record: ReconciliationRecord,
  order: ObservedOrderEvidence,
): Extract<ObservedOrderEvidence, { readonly kind: "order" }> | null {
  if (order.kind !== "order") return null;
  return sameIdentity(record, order) ? order : null;
}

function atOrAfterExpiry(
  record: ReconciliationRecord,
  evidence: ReconciliationEvidence,
): boolean {
  return evidence.serverTimeMs > record.expiresAfterMs;
}

function decideCreate(
  record: ReconciliationRecord,
  evidence: ReconciliationEvidence,
): ReconciliationDecision {
  if (record.cloid === null) {
    return invalid(
      "record.cloid",
      "order creation requires an immutable cloid",
    );
  }
  const order = exactObservedOrder(record, evidence.order);
  const hasAcceptance =
    (order !== null && order.status !== "rejected") ||
    evidence.openOrders.some((item) => sameIdentity(record, item)) ||
    evidence.fills.some((item) => sameIdentity(record, item));
  const hasRejection =
    order?.status === "rejected" || evidence.definitiveRejection === true;
  if (hasAcceptance && hasRejection) {
    return { kind: "terminal", state: "reconciled_ambiguous" };
  }
  if (hasRejection) return { kind: "terminal", state: "rejected" };
  if (hasAcceptance) {
    return { kind: "terminal", state: "accepted" };
  }
  if (!atOrAfterExpiry(record, evidence)) {
    return { kind: "unresolved", reason: "before_expiry" };
  }
  return { kind: "terminal", state: "expired" };
}

function decideCancel(
  record: ReconciliationRecord,
  evidence: ReconciliationEvidence,
): ReconciliationDecision {
  if ((record.cloid === null) === (record.targetOid === null)) {
    return invalid(
      "record.cancelTarget",
      "cancel requires exactly one immutable order identity",
    );
  }
  if (evidence.definitiveRejection === true) {
    return { kind: "terminal", state: "rejected" };
  }
  const order = exactObservedOrder(record, evidence.order);
  if (
    order !== null &&
    (order.status === "canceled" ||
      order.status === "filled" ||
      order.status === "triggered")
  ) {
    return { kind: "terminal", state: "accepted" };
  }
  const remainsOpen = evidence.openOrders.some((item) =>
    sameIdentity(record, item),
  );
  if (remainsOpen) {
    return atOrAfterExpiry(record, evidence)
      ? { kind: "terminal", state: "expired" }
      : { kind: "unresolved", reason: "action_still_pending" };
  }
  const intent = record.normalizedSecretFreeIntent;
  if (
    intent.targetObservedBeforeSubmission === true &&
    evidence.order.kind === "unknown"
  ) {
    return { kind: "terminal", state: "accepted" };
  }
  return atOrAfterExpiry(record, evidence)
    ? { kind: "terminal", state: "reconciled_ambiguous" }
    : { kind: "unresolved", reason: "before_expiry" };
}

function decideClose(
  record: ReconciliationRecord,
  evidence: ReconciliationEvidence,
): ReconciliationDecision {
  const orderDecision = decideCreate(record, evidence);
  if (
    orderDecision.kind === "terminal" &&
    (orderDecision.state === "accepted" || orderDecision.state === "rejected")
  ) {
    return orderDecision;
  }
  const intent = record.normalizedSecretFreeIntent;
  if (
    evidence.position?.assetId === record.assetId &&
    evidence.position.size === "0" &&
    typeof intent.reviewedPositionSize === "string" &&
    intent.reviewedPositionSize !== "0"
  ) {
    return { kind: "terminal", state: "reconciled_ambiguous" };
  }
  return orderDecision;
}

function decideLeverage(
  record: ReconciliationRecord,
  evidence: ReconciliationEvidence,
): ReconciliationDecision {
  if (evidence.definitiveRejection === true) {
    return { kind: "terminal", state: "rejected" };
  }
  const intent = record.normalizedSecretFreeIntent;
  const leverage = evidence.leverage;
  const reviewedStateVersion = intent.reviewedAccountStateVersion;
  if (
    !Number.isSafeInteger(intent.leverage) ||
    (intent.marginMode !== "cross" && intent.marginMode !== "isolated") ||
    !Number.isSafeInteger(reviewedStateVersion) ||
    (reviewedStateVersion as number) < 0
  ) {
    return { kind: "unresolved", reason: "incomplete_evidence" };
  }
  if (
    leverage !== null &&
    leverage !== undefined &&
    leverage.assetId === record.assetId &&
    leverage.leverage === intent.leverage &&
    leverage.marginMode === intent.marginMode
  ) {
    return leverage.causallyAttributed
      ? { kind: "terminal", state: "accepted" }
      : { kind: "terminal", state: "reconciled_ambiguous" };
  }
  if (!atOrAfterExpiry(record, evidence)) {
    return { kind: "unresolved", reason: "before_expiry" };
  }
  return evidence.stateVersion > (reviewedStateVersion as number)
    ? { kind: "terminal", state: "expired" }
    : { kind: "unresolved", reason: "incomplete_evidence" };
}

export function decideReconciliation(input: {
  readonly record: ReconciliationRecord;
  readonly evidence: ReconciliationEvidence;
}): ReconciliationDecision {
  assertContext(input.record, input.evidence);
  if (!input.evidence.complete || input.evidence.order.kind === "malformed") {
    return { kind: "unresolved", reason: "incomplete_evidence" };
  }
  switch (input.record.actionType) {
    case "market_order":
    case "limit_order":
      return decideCreate(input.record, input.evidence);
    case "reduce_only_close":
      return decideClose(input.record, input.evidence);
    case "cancel":
      return decideCancel(input.record, input.evidence);
    case "update_leverage":
      return decideLeverage(input.record, input.evidence);
    case "bulk_cancel":
      return invalid(
        "record.actionType",
        "bulk cancel is not a U7 public action",
      );
    default:
      return invalid("record.actionType", "unsupported reconciliation action");
  }
}
