import { describe, expect, test } from "bun:test";

import { decideReconciliation } from "./policy";

const base = {
  network: "testnet" as const,
  masterAccount: "0x1111111111111111111111111111111111111111",
  targetAccount: "0x2222222222222222222222222222222222222222",
  assetId: 0,
  expiresAfterMs: 2_000,
};

describe("action-specific reconciliation", () => {
  test("uses cloid as the authoritative create identity, including fill-before-response", () => {
    expect(
      decideReconciliation({
        record: {
          ...base,
          actionType: "market_order",
          cloid: "0x00000000000000000000000000000001",
          targetOid: null,
          normalizedSecretFreeIntent: {},
        },
        evidence: {
          context: base,
          serverTimeMs: 1_500,
          complete: true,
          order: { kind: "unknown" },
          openOrders: [],
          fills: [
            {
              assetId: 0,
              cloid: "0x00000000000000000000000000000001",
              oid: 44,
            },
          ],
          position: null,
          stateVersion: 8,
        },
      }),
    ).toEqual({ kind: "terminal", state: "accepted" });
  });

  test("marks contradictory create evidence ambiguous", () => {
    expect(
      decideReconciliation({
        record: {
          ...base,
          actionType: "market_order",
          cloid: "0x00000000000000000000000000000001",
          targetOid: null,
          normalizedSecretFreeIntent: {},
        },
        evidence: {
          context: base,
          serverTimeMs: 1_500,
          complete: true,
          order: {
            kind: "order",
            assetId: 0,
            oid: 44,
            cloid: "0x00000000000000000000000000000001",
            status: "rejected",
          },
          openOrders: [],
          fills: [
            {
              assetId: 0,
              cloid: "0x00000000000000000000000000000001",
              oid: 44,
            },
          ],
          position: null,
          stateVersion: 8,
        },
      }),
    ).toEqual({ kind: "terminal", state: "reconciled_ambiguous" });
  });

  test("requires fresh complete absence after expiry and never guesses from malformed evidence", () => {
    expect(
      decideReconciliation({
        record: {
          ...base,
          actionType: "limit_order",
          cloid: "0x00000000000000000000000000000002",
          targetOid: null,
          normalizedSecretFreeIntent: {},
        },
        evidence: {
          context: base,
          serverTimeMs: 2_001,
          complete: true,
          order: { kind: "unknown" },
          openOrders: [],
          fills: [],
          position: null,
          stateVersion: 9,
        },
      }),
    ).toEqual({ kind: "terminal", state: "expired" });

    expect(
      decideReconciliation({
        record: {
          ...base,
          actionType: "limit_order",
          cloid: "0x00000000000000000000000000000002",
          targetOid: null,
          normalizedSecretFreeIntent: {},
        },
        evidence: {
          context: base,
          serverTimeMs: 2_001,
          complete: false,
          order: { kind: "malformed" },
          openOrders: [],
          fills: [],
          position: null,
          stateVersion: 9,
        },
      }),
    ).toEqual({ kind: "unresolved", reason: "incomplete_evidence" });
  });

  test("reconciles cancel only from the immutable target identity", () => {
    expect(
      decideReconciliation({
        record: {
          ...base,
          actionType: "cancel",
          cloid: null,
          targetOid: 77,
          normalizedSecretFreeIntent: {
            targetObservedBeforeSubmission: true,
          },
        },
        evidence: {
          context: base,
          serverTimeMs: 1_500,
          complete: true,
          order: {
            kind: "order",
            assetId: 0,
            oid: 77,
            cloid: null,
            status: "canceled",
          },
          openOrders: [],
          fills: [],
          position: null,
          stateVersion: 10,
        },
      }),
    ).toEqual({ kind: "terminal", state: "accepted" });

    expect(
      decideReconciliation({
        record: {
          ...base,
          actionType: "cancel",
          cloid: null,
          targetOid: 77,
          normalizedSecretFreeIntent: {
            targetObservedBeforeSubmission: true,
          },
        },
        evidence: {
          context: base,
          serverTimeMs: 2_001,
          complete: true,
          order: {
            kind: "order",
            assetId: 0,
            oid: 77,
            cloid: null,
            status: "open",
          },
          openOrders: [{ assetId: 0, oid: 77, cloid: null }],
          fills: [],
          position: null,
          stateVersion: 11,
        },
      }),
    ).toEqual({ kind: "terminal", state: "expired" });
  });

  test("accepts a close by cloid fill and marks uncorrelated position closure ambiguous", () => {
    const closeRecord = {
      ...base,
      actionType: "reduce_only_close" as const,
      cloid: "0x00000000000000000000000000000003",
      targetOid: null,
      normalizedSecretFreeIntent: { reviewedPositionSize: "2" },
    };
    expect(
      decideReconciliation({
        record: closeRecord,
        evidence: {
          context: base,
          serverTimeMs: 1_500,
          complete: true,
          order: { kind: "unknown" },
          openOrders: [],
          fills: [
            {
              assetId: 0,
              oid: 88,
              cloid: "0x00000000000000000000000000000003",
            },
          ],
          position: { assetId: 0, size: "0" },
          stateVersion: 12,
        },
      }),
    ).toEqual({ kind: "terminal", state: "accepted" });
    expect(
      decideReconciliation({
        record: closeRecord,
        evidence: {
          context: base,
          serverTimeMs: 2_001,
          complete: true,
          order: { kind: "unknown" },
          openOrders: [],
          fills: [],
          position: { assetId: 0, size: "0" },
          stateVersion: 13,
        },
      }),
    ).toEqual({ kind: "terminal", state: "reconciled_ambiguous" });
  });

  test("requires causal evidence for leverage acceptance", () => {
    const leverageRecord = {
      ...base,
      actionType: "update_leverage" as const,
      cloid: null,
      targetOid: null,
      normalizedSecretFreeIntent: {
        leverage: 5,
        marginMode: "cross",
        reviewedAccountStateVersion: 14,
      },
    };
    const common = {
      context: base,
      serverTimeMs: 1_500,
      complete: true,
      order: { kind: "unknown" as const },
      openOrders: [],
      fills: [],
      position: null,
      stateVersion: 14,
    };
    expect(
      decideReconciliation({
        record: leverageRecord,
        evidence: {
          ...common,
          leverage: {
            assetId: 0,
            leverage: 5,
            marginMode: "cross",
            causallyAttributed: true,
          },
        },
      }),
    ).toEqual({ kind: "terminal", state: "accepted" });
    expect(
      decideReconciliation({
        record: leverageRecord,
        evidence: {
          ...common,
          leverage: {
            assetId: 0,
            leverage: 5,
            marginMode: "cross",
            causallyAttributed: false,
          },
        },
      }),
    ).toEqual({ kind: "terminal", state: "reconciled_ambiguous" });

    expect(
      decideReconciliation({
        record: leverageRecord,
        evidence: {
          ...common,
          serverTimeMs: 2_001,
          leverage: {
            assetId: 0,
            leverage: 4,
            marginMode: "cross",
            causallyAttributed: true,
          },
        },
      }),
    ).toEqual({ kind: "unresolved", reason: "incomplete_evidence" });
    expect(
      decideReconciliation({
        record: leverageRecord,
        evidence: {
          ...common,
          serverTimeMs: 2_001,
          stateVersion: 15,
          leverage: {
            assetId: 0,
            leverage: 4,
            marginMode: "cross",
            causallyAttributed: true,
          },
        },
      }),
    ).toEqual({ kind: "terminal", state: "expired" });
  });

  test("reconciles a network-matched mainnet record without signer capability", () => {
    expect(
      decideReconciliation({
        record: {
          ...base,
          network: "mainnet",
          actionType: "limit_order",
          cloid: "0x00000000000000000000000000000004",
          targetOid: null,
          normalizedSecretFreeIntent: {},
        },
        evidence: {
          context: { ...base, network: "mainnet" },
          serverTimeMs: 2_001,
          complete: true,
          order: { kind: "unknown" },
          openOrders: [],
          fills: [],
          position: null,
          stateVersion: 15,
        },
      }),
    ).toEqual({ kind: "terminal", state: "expired" });
  });
});
