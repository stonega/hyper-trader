import { HyperliquidValidationError } from "../errors";
import type {
  JournalResultClass,
  JournalState,
  PreparedActionRecord,
  RestartRecoveryDecision,
} from "./types";
import { TERMINAL_JOURNAL_STATES } from "./types";

const ALLOWED_TRANSITIONS: Readonly<
  Record<JournalState, ReadonlySet<JournalState>>
> = {
  prepared: new Set(["submission_started", "abandoned_before_submission"]),
  submission_started: new Set([
    "accepted",
    "rejected",
    "expired",
    "unresolved",
    "reconciled_ambiguous",
  ]),
  unresolved: new Set([
    "accepted",
    "rejected",
    "expired",
    "reconciled_ambiguous",
  ]),
  accepted: new Set(),
  rejected: new Set(),
  expired: new Set(),
  abandoned_before_submission: new Set(),
  reconciled_ambiguous: new Set(),
};

export function isTerminalJournalState(state: JournalState): boolean {
  return TERMINAL_JOURNAL_STATES.has(state);
}

export function assertJournalTransition(
  current: JournalState,
  next: JournalState,
): void {
  if (!ALLOWED_TRANSITIONS[current].has(next)) {
    throw new HyperliquidValidationError(
      "journal.state",
      `transition from ${current} to ${next} is forbidden`,
    );
  }
}

export function mayMarkSubmissionStarted(
  record: PreparedActionRecord,
  now: number,
): boolean {
  return (
    record.state === "prepared" &&
    record.submissionStartedAt === null &&
    now < record.expiresAfterMs
  );
}

export function restartRecoveryDecision(
  record: PreparedActionRecord,
): RestartRecoveryDecision {
  if (isTerminalJournalState(record.state) || record.state === "unresolved") {
    return { kind: "unchanged" };
  }
  if (
    record.submissionStartedAt !== null ||
    record.state === "submission_started"
  ) {
    return { kind: "transition", state: "unresolved" };
  }
  if (record.state === "prepared") {
    return { kind: "transition", state: "abandoned_before_submission" };
  }
  return { kind: "unchanged" };
}

const RESULT_FOR_STATE: Readonly<
  Partial<Record<JournalState, JournalResultClass | null>>
> = {
  prepared: null,
  submission_started: null,
  unresolved: "unresolved",
  accepted: "accepted",
  rejected: "rejected",
  expired: "expired",
  abandoned_before_submission: null,
  reconciled_ambiguous: "ambiguous",
};

export function assertJournalResultClass(
  state: JournalState,
  resultClass: JournalResultClass | null,
): void {
  const expected = RESULT_FOR_STATE[state];
  if (expected === undefined || resultClass !== expected) {
    throw new HyperliquidValidationError(
      "journal.lastResultClass",
      `result class ${String(resultClass)} is invalid for state ${state}`,
    );
  }
}
