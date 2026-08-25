import {
  type ActionJournalRepository,
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

export type ReconciledActionPhase =
  | "accepted"
  | "rejected"
  | "expired"
  | "ambiguous";

export interface ActionReconciliationPort {
  reconcile(journalId: string): Promise<ReconciledActionPhase | null>;
}

function nextAttempt(record: PreparedActionRecord, now: number): number {
  const delay = Math.min(
    30_000,
    1_000 * 2 ** Math.min(record.reconciliationAttempts, 5),
  );
  const expiryProbeAt = record.expiresAfterMs + 1_000;
  return now < expiryProbeAt
    ? Math.min(now + delay, expiryProbeAt)
    : Math.min(now + delay, now + 1_000);
}

function resultClass(
  state: Extract<
    JournalState,
    "accepted" | "rejected" | "expired" | "reconciled_ambiguous"
  >,
): "accepted" | "rejected" | "expired" | "ambiguous" {
  return state === "reconciled_ambiguous" ? "ambiguous" : state;
}

function terminalPhase(state: JournalState): ReconciledActionPhase | null {
  if (state === "reconciled_ambiguous") return "ambiguous";
  return state === "accepted" || state === "rejected" || state === "expired"
    ? state
    : null;
}

const DEFAULT_MAX_FOREGROUND_ATTEMPTS = 10;
const LEASE_RETRY_MS = 250;

export function createActionReconciliationPort(options: {
  readonly repository: Pick<ActionJournalRepository, "getAction">;
  readonly reconciler: ActionReconciler;
  readonly now: () => number;
  readonly wait?: (milliseconds: number) => Promise<void>;
  readonly maxAttempts?: number;
  readonly shouldContinue?: () => boolean;
}): ActionReconciliationPort {
  const wait =
    options.wait ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_FOREGROUND_ATTEMPTS;
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) {
    throw new TypeError("maxAttempts must be a positive integer.");
  }

  return Object.freeze({
    async reconcile(journalId: string): Promise<ReconciledActionPhase | null> {
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        if (options.shouldContinue?.() === false) return null;
        const record = options.repository.getAction(journalId);
        if (record === null) return null;
        const existingTerminal = terminalPhase(record.state);
        if (existingTerminal !== null) return existingTerminal;
        if (
          record.state !== "submission_started" &&
          record.state !== "unresolved"
        ) {
          return null;
        }
        const waitMs = Math.max(0, record.nextReconciliationAt - options.now());
        if (waitMs > 0) await wait(waitMs);
        if (options.shouldContinue?.() === false) return null;

        const result = await options.reconciler.reconcile(journalId);
        if (result.kind === "terminal") return resultClass(result.state);
        if (result.kind === "already_terminal") {
          return terminalPhase(result.state);
        }
        if (result.kind === "not_reconcilable") return null;
        if (result.kind === "lease_lost") await wait(LEASE_RETRY_MS);
      }
      return null;
    },
  });
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
      return reconcileClaim(claim.record, claim.lease);
    },
  });
}
