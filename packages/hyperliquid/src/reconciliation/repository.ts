import type {
  JournalResultClass,
  JournalState,
  PreparedActionRecord,
  ReconciliationLease,
  SubmissionStartReceipt,
} from "./types";

export interface ActionJournalRepository {
  getAction(journalId: string): PreparedActionRecord | null;
  markSubmissionStarted(journalId: string, now: number): SubmissionStartReceipt;
  transitionAction(
    journalId: string,
    next: JournalState,
    resultClass: JournalResultClass | null,
    now: number,
  ): PreparedActionRecord;
  claimReconciliationLease(
    journalId: string,
    owner: string,
    now: number,
    leaseDurationMs?: number,
  ): ReconciliationLease | null;
  claimNextReconciliation(
    owner: string,
    now: number,
    leaseDurationMs?: number,
  ): {
    readonly record: PreparedActionRecord;
    readonly lease: ReconciliationLease;
  } | null;
  renewReconciliationLease(
    lease: ReconciliationLease,
    now: number,
    leaseDurationMs?: number,
  ): ReconciliationLease | null;
  releaseReconciliationLease(lease: ReconciliationLease, now: number): boolean;
  scheduleReconciliation(
    journalId: string,
    owner: string,
    now: number,
    nextAttemptAt: number,
  ): PreparedActionRecord;
  recoverAfterRestart(now: number): readonly PreparedActionRecord[];
}
