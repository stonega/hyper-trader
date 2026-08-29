import type { TradingActionIntent } from "../actions/types";
import type { HyperliquidNetwork } from "../network";

export type JournalActionType = TradingActionIntent["type"];

export const JOURNAL_ACTION_TYPES = [
  "market_order",
  "limit_order",
  "cancel",
  "bulk_cancel",
  "update_leverage",
  "reduce_only_close",
  "position_tpsl",
] as const satisfies readonly JournalActionType[];

export type JournalResultClass =
  | "accepted"
  | "rejected"
  | "expired"
  | "unresolved"
  | "ambiguous";

export const JOURNAL_STATES = [
  "prepared",
  "submission_started",
  "unresolved",
  "accepted",
  "rejected",
  "expired",
  "abandoned_before_submission",
  "reconciled_ambiguous",
] as const;

export type JournalState = (typeof JOURNAL_STATES)[number];

export const TERMINAL_JOURNAL_STATE_VALUES = [
  "accepted",
  "rejected",
  "expired",
  "abandoned_before_submission",
  "reconciled_ambiguous",
] as const satisfies readonly JournalState[];

export const TERMINAL_JOURNAL_STATES: ReadonlySet<JournalState> = new Set(
  TERMINAL_JOURNAL_STATE_VALUES,
);

export type SecretFreeIntent = Readonly<Record<string, unknown>>;

export interface PreparedActionInput {
  readonly journalId: string;
  readonly correlationId: string;
  readonly network: HyperliquidNetwork;
  readonly masterAccount: string;
  readonly targetAccount: string;
  readonly agentAddress: string;
  readonly signerGeneration: number;
  readonly capturedContextEpoch: number;
  readonly actionType: JournalActionType;
  readonly intentVersion: number;
  readonly normalizedSecretFreeIntent: SecretFreeIntent;
  readonly intentDigest: `0x${string}`;
  readonly equivalenceFingerprint: `0x${string}`;
  readonly nonce: number;
  readonly expiresAfterMs: number;
  readonly cloid: string | null;
  readonly assetId: number | null;
  readonly targetOid: number | null;
  readonly reconciliationKey: string;
  readonly preparedAt: number;
}

export interface PreparedActionRecord extends PreparedActionInput {
  readonly state: JournalState;
  readonly submissionStartedAt: number | null;
  readonly lastResultClass: JournalResultClass | null;
  readonly leaseOwner: string | null;
  readonly leaseExpiresAt: number | null;
  readonly reconciliationAttempts: number;
  readonly nextReconciliationAt: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface ReconciliationLease {
  readonly journalId: string;
  readonly owner: string;
  readonly expiresAt: number;
}

export interface TransportWritePermit {
  readonly journalId: string;
  consume<T>(write: () => T): T;
}

export interface SubmissionStartReceipt {
  readonly record: PreparedActionRecord;
  readonly transportPermit: TransportWritePermit;
}

export type RestartRecoveryDecision =
  | { readonly kind: "unchanged" }
  | {
      readonly kind: "transition";
      readonly state: "unresolved" | "abandoned_before_submission";
    };
