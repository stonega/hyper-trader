import { describe, expect, test } from "bun:test";
import type {
  PreparedActionRecord,
  ReconciliationEvidence,
  ReconciliationLease,
} from "@hyper-trader/hyperliquid";

import { createActionReconciler } from "./reconciler";

const record: PreparedActionRecord = {
  journalId: "jrn_00000000000000000000000000000001",
  correlationId: "act_00000000000000000000000000000001",
  network: "testnet",
  masterAccount: "0x1111111111111111111111111111111111111111",
  targetAccount: "0x2222222222222222222222222222222222222222",
  agentAddress: "0x3333333333333333333333333333333333333333",
  signerGeneration: 1,
  capturedContextEpoch: 4,
  actionType: "limit_order",
  intentVersion: 1,
  normalizedSecretFreeIntent: {},
  intentDigest: `0x${"11".repeat(32)}`,
  equivalenceFingerprint: `0x${"22".repeat(32)}`,
  nonce: 1_000,
  expiresAfterMs: 2_000,
  cloid: "0x00000000000000000000000000000001",
  assetId: 0,
  targetOid: null,
  reconciliationKey: "order:0:cloid:0x00000000000000000000000000000001",
  preparedAt: 1_000,
  state: "unresolved",
  submissionStartedAt: 1_001,
  lastResultClass: "unresolved",
  leaseOwner: null,
  leaseExpiresAt: null,
  reconciliationAttempts: 0,
  nextReconciliationAt: 1_001,
  createdAt: 1_000,
  updatedAt: 1_001,
};

function evidence(): ReconciliationEvidence {
  return {
    context: {
      network: "testnet",
      masterAccount: record.masterAccount,
      targetAccount: record.targetAccount,
      assetId: 0,
    },
    serverTimeMs: 1_500,
    complete: true,
    order: {
      kind: "order",
      assetId: 0,
      oid: 42,
      cloid: record.cloid,
      status: "open",
    },
    openOrders: [],
    fills: [],
    position: null,
    stateVersion: 10,
  };
}

describe("signer-free reconciliation worker", () => {
  test("commits journal evidence but fences active-context cache writes", async () => {
    let current = record;
    let cacheWrites = 0;
    const lease: ReconciliationLease = {
      journalId: record.journalId,
      owner: "worker_01",
      expiresAt: 31_000,
    };
    const reconciler = createActionReconciler({
      owner: lease.owner,
      now: () => 1_100,
      repository: {
        getAction: () => current,
        claimReconciliationLease: () => lease,
        claimNextReconciliation: () => ({ record: current, lease }),
        renewReconciliationLease: () => ({ ...lease, expiresAt: 31_100 }),
        releaseReconciliationLease: () => true,
        scheduleReconciliation: () => current,
        transitionAction: (_id, state, result) => {
          current = { ...current, state, lastResultClass: result };
          return current;
        },
        markSubmissionStarted: () => {
          throw new Error("reconciliation has no transport authority");
        },
        recoverAfterRestart: () => [],
      },
      evidence: { load: async () => evidence() },
      isActiveContext: () => false,
      publishToActiveContext: () => {
        cacheWrites += 1;
      },
    });

    expect(await reconciler.reconcile(record.journalId)).toEqual({
      kind: "terminal",
      state: "accepted",
    });
    expect(current.state).toBe("accepted");
    expect(cacheWrites).toBe(0);
  });

  test("a lease owner cannot update after takeover", async () => {
    let now = 1_100;
    const lease: ReconciliationLease = {
      journalId: record.journalId,
      owner: "worker_01",
      expiresAt: 1_200,
    };
    let scheduled = 0;
    const reconciler = createActionReconciler({
      owner: lease.owner,
      now: () => now,
      repository: {
        getAction: () => record,
        claimReconciliationLease: () => lease,
        claimNextReconciliation: () => ({ record, lease }),
        renewReconciliationLease: () => null,
        releaseReconciliationLease: () => false,
        scheduleReconciliation: () => {
          scheduled += 1;
          return record;
        },
        transitionAction: () => {
          throw new Error("stale lease must not commit");
        },
        markSubmissionStarted: () => {
          throw new Error("not used");
        },
        recoverAfterRestart: () => [],
      },
      evidence: {
        load: async () => {
          now = 1_300;
          return evidence();
        },
      },
      isActiveContext: () => true,
      publishToActiveContext: () => undefined,
    });
    expect(await reconciler.reconcile(record.journalId)).toEqual({
      kind: "lease_lost",
    });
    expect(scheduled).toBe(0);
  });

  test("denies mainnet records at both public worker entries", async () => {
    const mainnetRecord = { ...record, network: "mainnet" as const };
    const lease: ReconciliationLease = {
      journalId: record.journalId,
      owner: "worker_01",
      expiresAt: 31_000,
    };
    let evidenceLoads = 0;
    let releases = 0;
    const reconciler = createActionReconciler({
      owner: lease.owner,
      now: () => 1_100,
      repository: {
        getAction: () => mainnetRecord,
        claimReconciliationLease: () => {
          throw new Error("reconcile must deny before claiming");
        },
        claimNextReconciliation: () => ({ record: mainnetRecord, lease }),
        renewReconciliationLease: () => {
          throw new Error("mainnet must not renew");
        },
        releaseReconciliationLease: () => {
          releases += 1;
          return true;
        },
        scheduleReconciliation: () => {
          throw new Error("mainnet must not schedule");
        },
        transitionAction: () => {
          throw new Error("mainnet must not transition");
        },
        markSubmissionStarted: () => {
          throw new Error("mainnet must not submit");
        },
        recoverAfterRestart: () => [],
      },
      evidence: {
        load: async () => {
          evidenceLoads += 1;
          return evidence();
        },
      },
      isActiveContext: () => true,
      publishToActiveContext: () => undefined,
    });
    await expect(reconciler.reconcile(record.journalId)).rejects.toThrow(
      "mainnet",
    );
    await expect(reconciler.reconcileNext()).rejects.toThrow("mainnet");
    expect(evidenceLoads).toBe(0);
    expect(releases).toBe(1);
  });
});
