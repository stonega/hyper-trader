import { describe, expect, test } from "bun:test";

import {
  type ActionFlowPhase,
  actionFlowConsumesBack,
} from "../actions/state-machine";
import {
  type AccountOperationState,
  accountMutationGate,
  INITIAL_ACCOUNT_OPERATION,
  reduceAccountOperation,
} from "./account-lifecycle";

describe("account mutation safety", () => {
  test("uses the shared Back predicate for every action-flow phase", () => {
    const phases: readonly ActionFlowPhase[] = [
      "review",
      "unlocking",
      "refreshing",
      "reserving",
      "signing",
      "submission_start",
      "submitting",
      "reconciling",
      "accepted",
      "rejected",
      "expired",
      "ambiguous",
      "failed_before_submission",
    ];
    for (const actionPhase of phases) {
      const gate = accountMutationGate({
        operation: "switch",
        actionPhase,
        actionStatus: { known: false },
        riskAcknowledged: false,
      });
      expect(gate.allowed).toBe(!actionFlowConsumesBack(actionPhase));
      if (actionFlowConsumesBack(actionPhase)) {
        expect(gate).toEqual({
          allowed: false,
          reason: "action_in_flight",
        });
      }
    }
  });

  test("allows switching without trusting persisted reconciliation metadata", () => {
    expect(
      accountMutationGate({
        operation: "switch",
        actionPhase: "reconciling",
        actionStatus: { known: false },
        riskAcknowledged: false,
      }),
    ).toEqual({ allowed: true, reason: null });
  });

  test("fails destructive operations closed without authoritative journal status", () => {
    for (const operation of [
      "rotate",
      "repair",
      "unlink_verified",
      "unlink_local",
    ] as const) {
      expect(
        accountMutationGate({
          operation,
          actionPhase: "review",
          actionStatus: { known: false },
          riskAcknowledged: true,
        }),
      ).toEqual({ allowed: false, reason: "action_status_unavailable" });
    }
  });

  test("requires durable and terminal authoritative actions for ordinary changes", () => {
    expect(
      accountMutationGate({
        operation: "rotate",
        actionPhase: "reconciling",
        actionStatus: {
          known: true,
          pendingCount: 1,
          allPendingDurable: false,
        },
        riskAcknowledged: false,
      }),
    ).toEqual({ allowed: false, reason: "action_not_durable" });
    for (const operation of ["rotate", "repair", "unlink_verified"] as const) {
      expect(
        accountMutationGate({
          operation,
          actionPhase: "reconciling",
          actionStatus: {
            known: true,
            pendingCount: 1,
            allPendingDurable: true,
          },
          riskAcknowledged: false,
        }),
      ).toEqual({ allowed: false, reason: "action_unresolved" });
    }
    expect(
      accountMutationGate({
        operation: "unlink_local",
        actionPhase: "reconciling",
        actionStatus: {
          known: true,
          pendingCount: 1,
          allPendingDurable: true,
        },
        riskAcknowledged: false,
      }),
    ).toEqual({ allowed: false, reason: "risk_acknowledgement_required" });
    expect(
      accountMutationGate({
        operation: "unlink_local",
        actionPhase: "reconciling",
        actionStatus: {
          known: true,
          pendingCount: 1,
          allPendingDurable: true,
        },
        riskAcknowledged: true,
      }),
    ).toEqual({ allowed: true, reason: null });
  });

  test("never reports rotation or revocation complete without authoritative old-agent inactivity", () => {
    const started = reduceAccountOperation(INITIAL_ACCOUNT_OPERATION, {
      type: "START",
      operation: "rotate",
    });
    const locked = reduceAccountOperation(started, { type: "LOCAL_LOCKED" });
    const approved = reduceAccountOperation(locked, {
      type: "EXTERNAL_STEP_RETURNED",
    });
    const unverified = reduceAccountOperation(approved, {
      type: "AUTHORITATIVE_PROOF",
      newAgentActive: true,
      oldAgentInactive: false,
    });

    expect(unverified.phase).toBe("restricted");
    expect(unverified.completed).toBe(false);

    const verified = reduceAccountOperation(unverified, {
      type: "AUTHORITATIVE_PROOF",
      newAgentActive: true,
      oldAgentInactive: true,
    });
    const tombstoned = reduceAccountOperation(verified, {
      type: "NONCE_SCOPE_TOMBSTONED",
    });
    const cleaned = reduceAccountOperation(tombstoned, {
      type: "LOCAL_SECRET_DELETED",
    });

    expect(cleaned).toMatchObject({ phase: "complete", completed: true });
  });

  test("keeps unlink restricted when alert deletion partially fails", () => {
    let state: AccountOperationState = reduceAccountOperation(
      INITIAL_ACCOUNT_OPERATION,
      { type: "START", operation: "unlink_verified" },
    );
    state = reduceAccountOperation(state, { type: "LOCAL_LOCKED" });
    state = reduceAccountOperation(state, { type: "EXTERNAL_STEP_RETURNED" });
    state = reduceAccountOperation(state, {
      type: "AUTHORITATIVE_PROOF",
      newAgentActive: false,
      oldAgentInactive: true,
    });
    state = reduceAccountOperation(state, { type: "NONCE_SCOPE_TOMBSTONED" });
    state = reduceAccountOperation(state, { type: "LOCAL_SECRET_DELETED" });
    state = reduceAccountOperation(state, {
      type: "ALERT_DATA_DELETION_FAILED",
      reason: "server unavailable",
    });

    expect(state).toMatchObject({
      phase: "restricted",
      completed: false,
      alertDeletion: "failed",
    });
  });

  test("cannot erase or restart a restricted unverified operation", () => {
    let state = reduceAccountOperation(INITIAL_ACCOUNT_OPERATION, {
      type: "START",
      operation: "rotate",
    });
    state = reduceAccountOperation(state, { type: "LOCAL_LOCKED" });
    state = reduceAccountOperation(state, { type: "EXTERNAL_STEP_RETURNED" });
    state = reduceAccountOperation(state, {
      type: "AUTHORITATIVE_PROOF",
      newAgentActive: true,
      oldAgentInactive: false,
    });
    const restricted = state;

    expect(reduceAccountOperation(restricted, { type: "RESET" })).toBe(
      restricted,
    );
    expect(
      reduceAccountOperation(restricted, {
        type: "START",
        operation: "repair",
      }),
    ).toBe(restricted);
    expect(
      reduceAccountOperation(restricted, {
        type: "AUTHORITATIVE_PROOF",
        newAgentActive: true,
        oldAgentInactive: true,
      }),
    ).toMatchObject({
      phase: "tombstoning",
      oldAgentInactive: true,
      newAgentActive: true,
    });
  });

  test("allows only explicit safe restart and reset phases", () => {
    const locking = reduceAccountOperation(INITIAL_ACCOUNT_OPERATION, {
      type: "START",
      operation: "rotate",
    });
    expect(
      reduceAccountOperation(locking, {
        type: "START",
        operation: "repair",
      }),
    ).toBe(locking);
    expect(reduceAccountOperation(locking, { type: "RESET" })).toBe(locking);

    const completed = {
      ...INITIAL_ACCOUNT_OPERATION,
      operation: "rotate" as const,
      phase: "complete" as const,
      completed: true,
    };
    expect(
      reduceAccountOperation(completed, {
        type: "START",
        operation: "repair",
      }),
    ).toMatchObject({ phase: "locking", operation: "repair" });
    expect(reduceAccountOperation(completed, { type: "RESET" })).toMatchObject({
      phase: "idle",
      operation: null,
    });
  });

  test("only a pre-external failure can be reset without authoritative proof", () => {
    const locking = reduceAccountOperation(INITIAL_ACCOUNT_OPERATION, {
      type: "START",
      operation: "rotate",
    });
    const preExternalFailure = reduceAccountOperation(locking, {
      type: "FAIL",
      reason: "local lock failed",
    });
    expect(preExternalFailure.phase).toBe("failed");
    expect(
      reduceAccountOperation(preExternalFailure, { type: "RESET" }).phase,
    ).toBe("idle");

    const external = reduceAccountOperation(locking, { type: "LOCAL_LOCKED" });
    const uncertainExternalFailure = reduceAccountOperation(external, {
      type: "FAIL",
      reason: "wallet return uncertain",
    });
    expect(uncertainExternalFailure.phase).toBe("restricted");
    expect(
      reduceAccountOperation(uncertainExternalFailure, { type: "RESET" }),
    ).toBe(uncertainExternalFailure);
  });

  test("local unlink remains restricted until late authoritative revocation proof", () => {
    let state: AccountOperationState = reduceAccountOperation(
      INITIAL_ACCOUNT_OPERATION,
      { type: "START", operation: "unlink_local" },
    );
    state = reduceAccountOperation(state, { type: "LOCAL_LOCKED" });
    state = reduceAccountOperation(state, {
      type: "ACKNOWLEDGE_UNVERIFIED_LOCAL_UNLINK",
    });
    state = reduceAccountOperation(state, { type: "NONCE_SCOPE_TOMBSTONED" });
    state = reduceAccountOperation(state, { type: "LOCAL_SECRET_DELETED" });
    state = reduceAccountOperation(state, { type: "ALERT_DATA_DELETED" });

    expect(state).toMatchObject({
      phase: "restricted",
      completed: false,
      localCleanupComplete: true,
      oldAgentInactive: false,
    });
    state = reduceAccountOperation(state, {
      type: "AUTHORITATIVE_PROOF",
      newAgentActive: false,
      oldAgentInactive: true,
    });
    expect(state).toMatchObject({
      phase: "complete",
      completed: true,
      oldAgentInactive: true,
      localCleanupComplete: true,
    });
  });
});
