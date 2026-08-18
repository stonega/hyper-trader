import {
  type ActionFlowPhase,
  actionFlowConsumesBack,
} from "../actions/state-machine";

export type AccountMutationOperation =
  | "add"
  | "switch"
  | "lock"
  | "rotate"
  | "revoke_external"
  | "unlink_verified"
  | "unlink_local"
  | "repair";

export type AccountMutationGateReason =
  | "action_in_flight"
  | "action_status_unavailable"
  | "action_not_durable"
  | "action_unresolved"
  | "risk_acknowledgement_required";

export type AccountMutationGate =
  | { readonly allowed: true; readonly reason: null }
  | {
      readonly allowed: false;
      readonly reason: AccountMutationGateReason;
    };

export type AuthoritativeActionStatus =
  | { readonly known: false }
  | {
      readonly known: true;
      readonly pendingCount: number;
      readonly allPendingDurable: boolean;
    };

function requiresAuthoritativeActionStatus(
  operation: AccountMutationOperation,
): boolean {
  return (
    operation === "rotate" ||
    operation === "repair" ||
    operation === "unlink_verified" ||
    operation === "unlink_local"
  );
}

export function accountMutationGate(input: {
  readonly operation: AccountMutationOperation;
  readonly actionPhase: ActionFlowPhase;
  readonly actionStatus: AuthoritativeActionStatus;
  readonly riskAcknowledged: boolean;
}): AccountMutationGate {
  if (input.operation === "lock") return { allowed: true, reason: null };
  if (actionFlowConsumesBack(input.actionPhase)) {
    return { allowed: false, reason: "action_in_flight" };
  }
  if (!requiresAuthoritativeActionStatus(input.operation)) {
    return { allowed: true, reason: null };
  }
  const status = input.actionStatus;
  if (
    status.known !== true ||
    !Number.isSafeInteger(status.pendingCount) ||
    status.pendingCount < 0 ||
    typeof status.allPendingDurable !== "boolean"
  ) {
    return { allowed: false, reason: "action_status_unavailable" };
  }
  if (status.pendingCount > 0 && !status.allPendingDurable) {
    return { allowed: false, reason: "action_not_durable" };
  }
  if (input.operation === "unlink_local" && !input.riskAcknowledged) {
    return {
      allowed: false,
      reason: "risk_acknowledgement_required",
    };
  }
  if (
    status.pendingCount > 0 &&
    (input.operation === "rotate" ||
      input.operation === "repair" ||
      input.operation === "unlink_verified")
  ) {
    return { allowed: false, reason: "action_unresolved" };
  }
  return { allowed: true, reason: null };
}

export type AccountLifecycleOperation =
  | "rotate"
  | "revoke_external"
  | "unlink_verified"
  | "unlink_local"
  | "repair";

export type AccountOperationPhase =
  | "idle"
  | "locking"
  | "external_step"
  | "verifying"
  | "restricted"
  | "tombstoning"
  | "deleting_local"
  | "deleting_alerts"
  | "complete"
  | "failed";

export interface AccountOperationState {
  readonly operation: AccountLifecycleOperation | null;
  readonly phase: AccountOperationPhase;
  readonly generation: number;
  readonly completed: boolean;
  readonly newAgentActive: boolean;
  readonly oldAgentInactive: boolean;
  readonly nonceScopeTombstoned: boolean;
  readonly localSecretDeleted: boolean;
  readonly localCleanupComplete: boolean;
  readonly alertDeletion: "not_started" | "pending" | "complete" | "failed";
  readonly reason: string | null;
}

export const INITIAL_ACCOUNT_OPERATION: AccountOperationState = {
  operation: null,
  phase: "idle",
  generation: 0,
  completed: false,
  newAgentActive: false,
  oldAgentInactive: false,
  nonceScopeTombstoned: false,
  localSecretDeleted: false,
  localCleanupComplete: false,
  alertDeletion: "not_started",
  reason: null,
};

export type AccountOperationAction =
  | { readonly type: "START"; readonly operation: AccountLifecycleOperation }
  | { readonly type: "LOCAL_LOCKED" }
  | { readonly type: "EXTERNAL_STEP_RETURNED" }
  | {
      readonly type: "AUTHORITATIVE_PROOF";
      readonly newAgentActive: boolean;
      readonly oldAgentInactive: boolean;
    }
  | { readonly type: "ACKNOWLEDGE_UNVERIFIED_LOCAL_UNLINK" }
  | { readonly type: "NONCE_SCOPE_TOMBSTONED" }
  | { readonly type: "LOCAL_SECRET_DELETED" }
  | { readonly type: "ALERT_DATA_DELETED" }
  | {
      readonly type: "ALERT_DATA_DELETION_FAILED";
      readonly reason: string;
    }
  | { readonly type: "FAIL"; readonly reason: string }
  | { readonly type: "RESET" };

function needsNewAgent(operation: AccountLifecycleOperation | null): boolean {
  return operation === "rotate" || operation === "repair";
}

function needsAlertDeletion(
  operation: AccountLifecycleOperation | null,
): boolean {
  return operation === "unlink_verified" || operation === "unlink_local";
}

function cleanupPhaseAfterAuthoritativeProof(
  state: AccountOperationState,
): AccountOperationPhase {
  if (!state.nonceScopeTombstoned) return "tombstoning";
  if (!state.localSecretDeleted) return "deleting_local";
  if (
    needsAlertDeletion(state.operation) &&
    state.alertDeletion !== "complete"
  ) {
    return "deleting_alerts";
  }
  return "complete";
}

function canStartOperation(phase: AccountOperationPhase): boolean {
  return phase === "idle" || phase === "complete";
}

function canResetOperation(phase: AccountOperationPhase): boolean {
  return phase === "idle" || phase === "complete" || phase === "failed";
}

function failureNeedsAuthoritativeResolution(
  phase: AccountOperationPhase,
): boolean {
  return (
    phase === "external_step" ||
    phase === "verifying" ||
    phase === "restricted" ||
    phase === "tombstoning" ||
    phase === "deleting_local" ||
    phase === "deleting_alerts"
  );
}

export function reduceAccountOperation(
  state: AccountOperationState,
  action: AccountOperationAction,
): AccountOperationState {
  switch (action.type) {
    case "START":
      if (!canStartOperation(state.phase)) return state;
      return {
        ...INITIAL_ACCOUNT_OPERATION,
        operation: action.operation,
        phase: "locking",
        generation: state.generation + 1,
      };
    case "LOCAL_LOCKED":
      if (state.phase !== "locking") return state;
      return {
        ...state,
        phase: state.operation === "repair" ? "verifying" : "external_step",
      };
    case "EXTERNAL_STEP_RETURNED":
      return state.phase === "external_step"
        ? { ...state, phase: "verifying" }
        : state;
    case "AUTHORITATIVE_PROOF": {
      if (state.phase !== "verifying" && state.phase !== "restricted") {
        return state;
      }
      const verified =
        action.oldAgentInactive &&
        (!needsNewAgent(state.operation) || action.newAgentActive);
      const verifiedPhase = verified
        ? cleanupPhaseAfterAuthoritativeProof(state)
        : "restricted";
      return {
        ...state,
        phase: verifiedPhase,
        completed: verifiedPhase === "complete",
        newAgentActive: action.newAgentActive,
        oldAgentInactive: action.oldAgentInactive,
        reason: verified
          ? null
          : "Authoritative state has not proved the old agent inactive and the replacement active.",
      };
    }
    case "ACKNOWLEDGE_UNVERIFIED_LOCAL_UNLINK":
      if (
        state.operation !== "unlink_local" ||
        state.phase !== "external_step"
      ) {
        return state;
      }
      return {
        ...state,
        phase: "tombstoning",
        reason:
          "External revocation is unconfirmed. This device will remain visibly restricted.",
      };
    case "NONCE_SCOPE_TOMBSTONED":
      return state.phase === "tombstoning"
        ? {
            ...state,
            phase: "deleting_local",
            nonceScopeTombstoned: true,
          }
        : state;
    case "LOCAL_SECRET_DELETED":
      if (state.phase !== "deleting_local" || !state.nonceScopeTombstoned) {
        return state;
      }
      if (needsAlertDeletion(state.operation)) {
        return {
          ...state,
          phase: "deleting_alerts",
          localSecretDeleted: true,
          alertDeletion: "pending",
        };
      }
      return {
        ...state,
        phase: "complete",
        completed: true,
        localSecretDeleted: true,
        localCleanupComplete: true,
      };
    case "ALERT_DATA_DELETED":
      if (state.phase !== "deleting_alerts") return state;
      if (state.operation === "unlink_local" && !state.oldAgentInactive) {
        return {
          ...state,
          phase: "restricted",
          completed: false,
          localCleanupComplete: true,
          alertDeletion: "complete",
          reason:
            "Local unlink finished, but external agent revocation remains unconfirmed.",
        };
      }
      return {
        ...state,
        phase: "complete",
        completed: true,
        localCleanupComplete: true,
        alertDeletion: "complete",
        reason: null,
      };
    case "ALERT_DATA_DELETION_FAILED":
      return state.phase === "deleting_alerts"
        ? {
            ...state,
            phase: "restricted",
            completed: false,
            localCleanupComplete: true,
            alertDeletion: "failed",
            reason: action.reason.slice(0, 160),
          }
        : state;
    case "FAIL":
      if (state.phase === "complete") return state;
      if (failureNeedsAuthoritativeResolution(state.phase)) {
        return {
          ...state,
          phase: "restricted",
          completed: false,
          reason: action.reason.slice(0, 160),
        };
      }
      return {
        ...state,
        phase: "failed",
        completed: false,
        reason: action.reason.slice(0, 160),
      };
    case "RESET":
      if (!canResetOperation(state.phase)) return state;
      return {
        ...INITIAL_ACCOUNT_OPERATION,
        generation: state.generation + 1,
      };
  }
}

export function accountGateMessage(reason: AccountMutationGateReason): string {
  switch (reason) {
    case "action_in_flight":
      return "Wait until signing or submission finishes.";
    case "action_status_unavailable":
      return "Authoritative pending-action status is unavailable. This account change remains disabled.";
    case "action_not_durable":
      return "Wait until every unresolved action has a durable reconciliation record.";
    case "action_unresolved":
      return "Rotation, repair, or verified unlink waits for pending actions to reconcile.";
    case "risk_acknowledgement_required":
      return "Acknowledge the external registration risk before local unlink.";
  }
}
