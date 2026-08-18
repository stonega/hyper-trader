import { describe, expect, test } from "bun:test";

import { assertSecretFreeIntent, createRedactedActionEvent } from "./redaction";
import {
  assertJournalResultClass,
  assertJournalTransition,
  mayMarkSubmissionStarted,
  restartRecoveryDecision,
} from "./state";
import type { PreparedActionRecord } from "./types";

const record: PreparedActionRecord = {
  journalId: "journal-1",
  correlationId: "correlation-1",
  network: "testnet",
  masterAccount: "0x1111111111111111111111111111111111111111",
  targetAccount: "0x2222222222222222222222222222222222222222",
  agentAddress: "0x3333333333333333333333333333333333333333",
  signerGeneration: 1,
  capturedContextEpoch: 2,
  actionType: "market_order",
  intentVersion: 1,
  normalizedSecretFreeIntent: { side: "buy", size: "1" },
  intentDigest: `0x${"1".repeat(64)}`,
  equivalenceFingerprint: `0x${"2".repeat(64)}`,
  nonce: 100,
  expiresAfterMs: 200,
  cloid: "0x00000000000000000000000000000001",
  assetId: 1,
  targetOid: null,
  reconciliationKey: "cloid:0x00000000000000000000000000000001",
  preparedAt: 100,
  state: "prepared",
  submissionStartedAt: null,
  lastResultClass: null,
  leaseOwner: null,
  leaseExpiresAt: null,
  reconciliationAttempts: 0,
  nextReconciliationAt: 100,
  createdAt: 100,
  updatedAt: 100,
};

describe("journal state rules", () => {
  test("allows one durable submission marker and never derives transport authority from a record", async () => {
    expect(mayMarkSubmissionStarted(record, 150)).toBe(true);
    const started = {
      ...record,
      state: "submission_started" as const,
      submissionStartedAt: 150,
    };
    expect(restartRecoveryDecision(started)).toEqual({
      kind: "transition",
      state: "unresolved",
    });
    expect(() => assertJournalTransition("accepted", "prepared")).toThrow(
      "forbidden",
    );
    expect("mayStartTransport" in (await import("./state"))).toBe(false);
  });

  test("abandons every recovered prepared record and preserves terminal records", () => {
    expect(restartRecoveryDecision(record)).toEqual({
      kind: "transition",
      state: "abandoned_before_submission",
    });
    expect(restartRecoveryDecision(record)).toEqual({
      kind: "transition",
      state: "abandoned_before_submission",
    });
    expect(
      restartRecoveryDecision({
        ...record,
        state: "accepted",
        submissionStartedAt: 150,
        lastResultClass: "accepted",
      }),
    ).toEqual({ kind: "unchanged" });
  });

  test("couples terminal and unresolved states to their exact result class", () => {
    expect(() => assertJournalResultClass("accepted", "rejected")).toThrow(
      "invalid for state accepted",
    );
    expect(() => assertJournalResultClass("unresolved", null)).toThrow(
      "invalid for state unresolved",
    );
    expect(() => assertJournalResultClass("expired", "expired")).not.toThrow();
  });
});

describe("secret-safe journal and diagnostics boundary", () => {
  test("rejects signing material recursively and emits only an explicit redacted event", () => {
    expect(() =>
      assertSecretFreeIntent({ order: { privateKey: "forbidden" } }),
    ).toThrow("forbidden signing or secret material");
    expect(() =>
      assertSecretFreeIntent({ order: { signature: "forbidden" } }),
    ).toThrow("forbidden signing or secret material");
    const event = createRedactedActionEvent({
      correlationId: `act_${"a".repeat(32)}`,
      actionType: "market_order",
      state: "unresolved",
      intentDigest: `0x${"1".repeat(64)}`,
      network: "testnet",
      agentAddressSuffix: "0x33333333",
      timestamp: 100,
    });
    expect(Object.keys(event).sort()).toEqual([
      "actionType",
      "agentAddressSuffix",
      "correlationId",
      "intentDigest",
      "network",
      "state",
      "timestamp",
    ]);
    expect(() =>
      createRedactedActionEvent({
        ...event,
        correlationId: "secret-looking-free-form-text",
      }),
    ).toThrow("opaque action correlation ID");
  });
});
