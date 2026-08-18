import {
  type ActionJournalRepository,
  assertTestnetSigningCapability,
  decideReconciliation,
  isTerminalJournalState,
  type JournalState,
  type PreparedActionRecord,
  type ReconciliationDecision,
  type ReconciliationEvidence,
  type ReconciliationLease,
} from "@hyper-trader/hyperliquid";

export interface ReconciliationEvidenceSource {
  load(record: PreparedActionRecord): Promise<ReconciliationEvidence>;
}

export type ActionReconcilerResult =
  | ReconciliationDecision
  | { readonly kind: "lease_lost" }
  | { readonly kind: "not_reconcilable" }
  | { readonly kind: "already_terminal"; readonly state: JournalState };

export interface ActionReconciler {
  reconcile(journalId: string): Promise<ActionReconcilerResult>;
  reconcileNext(): Promise<ActionReconcilerResult | null>;
}

function nextAttempt(record: PreparedActionRecord, now: number): number {
  const delay = Math.min(
    30_000,
    1_000 * 2 ** Math.min(record.reconciliationAttempts, 5),
  );
  return now + delay;
}

function resultClass(
  state: Extract<
    JournalState,
    "accepted" | "rejected" | "expired" | "reconciled_ambiguous"
  >,
): "accepted" | "rejected" | "expired" | "ambiguous" {
  return state === "reconciled_ambiguous" ? "ambiguous" : state;
}

export function createActionReconciler(options: {
  readonly owner: string;
  readonly now: () => number;
  readonly repository: ActionJournalRepository;
  readonly evidence: ReconciliationEvidenceSource;
  readonly isActiveContext: (record: PreparedActionRecord) => boolean;
  readonly publishToActiveContext: (
    record: PreparedActionRecord,
    decision: ReconciliationDecision,
    evidence: ReconciliationEvidence,
  ) => void;
}): ActionReconciler {
  const scheduleAfterFailure = (
    record: PreparedActionRecord,
    lease: ReconciliationLease,
  ): ActionReconcilerResult => {
    const now = options.now();
    const renewed = options.repository.renewReconciliationLease(lease, now);
    if (renewed === null) return { kind: "lease_lost" };
    options.repository.scheduleReconciliation(
      record.journalId,
      options.owner,
      now,
      nextAttempt(record, now),
    );
    return { kind: "unresolved", reason: "incomplete_evidence" };
  };

  const reconcileClaim = async (
    record: PreparedActionRecord,
    lease: ReconciliationLease,
  ): Promise<ActionReconcilerResult> => {
    assertTestnetSigningCapability(record.network);
    let evidence: ReconciliationEvidence;
    try {
      evidence = await options.evidence.load(record);
    } catch {
      return scheduleAfterFailure(record, lease);
    }
    const now = options.now();
    const renewed = options.repository.renewReconciliationLease(lease, now);
    if (renewed === null) return { kind: "lease_lost" };
    const decision = decideReconciliation({ record, evidence });
    if (decision.kind === "unresolved") {
      options.repository.scheduleReconciliation(
        record.journalId,
        options.owner,
        now,
        nextAttempt(record, now),
      );
    } else {
      options.repository.transitionAction(
        record.journalId,
        decision.state,
        resultClass(decision.state),
        now,
      );
    }
    if (options.isActiveContext(record)) {
      options.publishToActiveContext(record, decision, evidence);
    }
    return decision;
  };

  return Object.freeze({
    async reconcile(journalId: string): Promise<ActionReconcilerResult> {
      const record = options.repository.getAction(journalId);
      if (record === null) return { kind: "not_reconcilable" };
      assertTestnetSigningCapability(record.network);
      if (isTerminalJournalState(record.state)) {
        return { kind: "already_terminal", state: record.state };
      }
      if (
        record.state !== "submission_started" &&
        record.state !== "unresolved"
      ) {
        return { kind: "not_reconcilable" };
      }
      const lease = options.repository.claimReconciliationLease(
        record.journalId,
        options.owner,
        options.now(),
      );
      return lease === null
        ? { kind: "lease_lost" }
        : reconcileClaim(record, lease);
    },
    async reconcileNext(): Promise<ActionReconcilerResult | null> {
      const claim = options.repository.claimNextReconciliation(
        options.owner,
        options.now(),
      );
      if (claim === null) return null;
      try {
        assertTestnetSigningCapability(claim.record.network);
      } catch (error) {
        options.repository.releaseReconciliationLease(
          claim.lease,
          options.now(),
        );
        throw error;
      }
      return reconcileClaim(claim.record, claim.lease);
    },
  });
}
