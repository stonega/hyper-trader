import { describe, expect, test } from "bun:test";
import {
  type AtomicActionReservationInput,
  createExchangeClient,
  type PreparedActionRecord,
  type SignerBinding,
  type TradingActionValidationInput,
} from "@hyper-trader/hyperliquid";

import { createActionOrchestrator, createActionReview } from "./orchestrator";

const NOW = 1_725_000_000_000;
const binding: SignerBinding = {
  network: "testnet",
  masterAccount: "0x1111111111111111111111111111111111111111",
  targetAccount: "0x2222222222222222222222222222222222222222",
  agentAddress: "0x3333333333333333333333333333333333333333",
  generation: 1,
};

function validation(
  network: "mainnet" | "testnet" = "testnet",
): TradingActionValidationInput {
  return {
    context: {
      network,
      masterAccount: binding.masterAccount,
      targetAccount: binding.targetAccount,
      capturedContextEpoch: 4,
      currentContextEpoch: 4,
      currentNetwork: network,
      currentMasterAccount: binding.masterAccount,
      currentTargetAccount: binding.targetAccount,
      reviewedAtMs: NOW - 1_000,
      reviewExpiresAtMs: NOW + 30_000,
      nowMs: NOW,
    },
    market: {
      canonicalId: "perp:BTC",
      metadataFingerprint: "metadata-v1",
      orderAssetId: 0,
      family: "perp",
      lifecycle: "active",
      orderAvailability: "enabled",
      sizeDecimals: 3,
      pricePrecision: { maxSignificantFigures: 5, maxDecimalPlaces: 2 },
      maxLeverage: 25,
      referencePrice: "100",
      minimumNotional: "10",
    },
    account: {
      availableMargin: "1000",
      leverage: 5,
      marginMode: "cross",
      positionSize: "0",
      version: 8,
    },
    controls: { slippageBps: null, trigger: null },
    intent: {
      type: "limit_order",
      assetId: 0,
      side: "buy",
      size: "0.1",
      limitPrice: "100",
      timeInForce: "Gtc",
      reduceOnly: false,
      cloid: "0x00000000000000000000000000000001",
    },
  };
}

function harness(
  providerResponse: unknown,
  reviewValidation: TradingActionValidationInput = validation(),
) {
  const calls: string[] = [];
  let record: PreparedActionRecord | null = null;
  let contextCurrent = true;
  let switchOnSign = false;
  let refreshedValidation = validation();
  let throwAfterMarker = false;
  let raceTerminalTransition = false;
  let throwDuringTransport = false;
  const repository: Parameters<
    typeof createActionOrchestrator
  >[0]["repository"] = {
    reservePreparedAction(
      input: AtomicActionReservationInput,
    ): PreparedActionRecord {
      calls.push("reserve");
      record = {
        ...input.preparedAction,
        network: binding.network,
        masterAccount: binding.masterAccount.toLowerCase(),
        targetAccount: binding.targetAccount.toLowerCase(),
        agentAddress: binding.agentAddress.toLowerCase(),
        signerGeneration: 1,
        capturedContextEpoch: 4,
        nonce: NOW,
        expiresAfterMs: NOW + 15_000,
        preparedAt: NOW,
        state: "prepared",
        submissionStartedAt: null,
        lastResultClass: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        reconciliationAttempts: 0,
        nextReconciliationAt: NOW,
        createdAt: NOW,
        updatedAt: NOW,
      };
      return record as PreparedActionRecord;
    },
    markSubmissionStarted(journalId: string) {
      calls.push("submission_start");
      if (record === null || record.journalId !== journalId)
        throw new Error("missing");
      record = {
        ...record,
        state: "submission_started",
        submissionStartedAt: NOW + 1,
        updatedAt: NOW + 1,
      };
      if (throwAfterMarker) {
        throw new Error("simulated termination after durable marker");
      }
      let available = true;
      return {
        record,
        transportPermit: {
          journalId,
          consume<T>(write: () => T): T {
            if (!available) throw new Error("permit consumed");
            available = false;
            return write();
          },
        },
      };
    },
    transitionAction(
      journalId: string,
      state: PreparedActionRecord["state"],
      result: PreparedActionRecord["lastResultClass"],
    ) {
      calls.push(`transition:${state}`);
      if (record === null || record.journalId !== journalId)
        throw new Error("missing");
      record = { ...record, state, lastResultClass: result };
      if (raceTerminalTransition && state === "accepted") {
        throw new Error("another reconciler committed this terminal state");
      }
      return record;
    },
    getAction() {
      return record;
    },
  };
  const review = createActionReview({
    binding,
    capturedContextEpoch: 4,
    validation: reviewValidation,
  });
  const orchestrator = createActionOrchestrator({
    repository,
    session: {
      async unlock() {
        calls.push("unlock");
        return { status: "unlocked" as const };
      },
      async signTypedData() {
        calls.push("sign");
        if (switchOnSign) contextCurrent = false;
        return {
          r: `0x${"11".repeat(32)}` as `0x${string}`,
          s: `0x${"22".repeat(32)}` as `0x${string}`,
          v: 27 as const,
        };
      },
    },
    exchange: createExchangeClient({
      network: "testnet",
      fetch: (async () => {
        calls.push("submit");
        if (throwDuringTransport) {
          throw new Error("simulated connection loss after write start");
        }
        return new Response(JSON.stringify(providerResponse), {
          headers: { "Content-Type": "application/json" },
        });
      }) as unknown as typeof fetch,
    }),
    refresh: async () => {
      calls.push("refresh");
      return refreshedValidation;
    },
    isContextCurrent: () => contextCurrent,
    clock: () => ({
      wallTimeMs: NOW,
      monotonicTimeMs: NOW,
      serverTimeMs: NOW,
      serverSampledAtMonotonicMs: NOW,
      lastObservedWallMs: null,
    }),
    now: () => NOW + 1,
    ids: {
      journalId: () => "jrn_00000000000000000000000000000001",
      correlationId: () => "act_00000000000000000000000000000001",
    },
  });
  return {
    calls,
    orchestrator,
    review,
    currentRecord: () => record,
    switchContext: () => {
      contextCurrent = false;
    },
    switchContextDuringSign: () => {
      switchOnSign = true;
    },
    setRefreshedValidation: (next: TradingActionValidationInput) => {
      refreshedValidation = next;
    },
    throwAfterSubmissionMarker: () => {
      throwAfterMarker = true;
    },
    raceAcceptedTransition: () => {
      raceTerminalTransition = true;
    },
    loseTransportResponse: () => {
      throwDuringTransport = true;
    },
  };
}

describe("shared action orchestrator", () => {
  test("runs unlock, authoritative refresh, reserve, sign, marker, and one submit in order", async () => {
    const h = harness({
      status: "ok",
      response: {
        type: "order",
        data: { statuses: [{ resting: { oid: 42 } }] },
      },
    });
    const result = await h.orchestrator.confirm(h.review);
    expect(result.phase).toBe("accepted");
    expect(h.calls).toEqual([
      "unlock",
      "refresh",
      "reserve",
      "sign",
      "submission_start",
      "submit",
      "transition:accepted",
    ]);
  });

  test("runs every U7 action family through the same write-once pipeline", async () => {
    const base = validation();
    const workflows: readonly {
      readonly input: TradingActionValidationInput;
      readonly response: unknown;
      readonly actionType: PreparedActionRecord["actionType"];
    }[] = [
      {
        input: {
          ...base,
          controls: { slippageBps: 100, trigger: null },
          intent: {
            type: "market_order",
            assetId: 0,
            side: "buy",
            size: "0.1",
            aggressiveLimitPrice: "100",
            cloid: "0x00000000000000000000000000000010",
          },
        },
        response: {
          status: "ok",
          response: {
            type: "order",
            data: { statuses: [{ resting: { oid: 43 } }] },
          },
        },
        actionType: "market_order",
      },
      {
        input: {
          ...base,
          account: {
            ...base.account,
            openOrders: [{ assetId: 0, oid: 77 }],
          },
          intent: {
            type: "cancel",
            assetId: 0,
            target: { kind: "oid", oid: 77 },
          },
        },
        response: {
          status: "ok",
          response: {
            type: "cancel",
            data: { statuses: ["success"] },
          },
        },
        actionType: "cancel",
      },
      {
        input: {
          ...base,
          account: { ...base.account, positionSize: "2" },
          controls: { slippageBps: 100, trigger: null },
          intent: {
            type: "reduce_only_close",
            assetId: 0,
            side: "sell",
            size: "2",
            aggressiveLimitPrice: "99",
            cloid: "0x00000000000000000000000000000011",
          },
        },
        response: {
          status: "ok",
          response: {
            type: "order",
            data: {
              statuses: [{ filled: { totalSz: "2", avgPx: "99", oid: 44 } }],
            },
          },
        },
        actionType: "reduce_only_close",
      },
      {
        input: {
          ...base,
          intent: {
            type: "update_leverage",
            assetId: 0,
            leverage: 4,
            marginMode: "cross",
          },
        },
        response: { status: "ok", response: { type: "default" } },
        actionType: "update_leverage",
      },
    ];

    for (const workflow of workflows) {
      const h = harness(workflow.response, workflow.input);
      h.setRefreshedValidation(workflow.input);
      expect((await h.orchestrator.confirm(h.review)).phase).toBe("accepted");
      expect(h.currentRecord()?.actionType).toBe(workflow.actionType);
      expect(h.calls.filter((call) => call === "submit")).toHaveLength(1);
    }
  });

  test.each([
    [{ status: "err", response: "bad order" }, "rejected"],
    [
      { status: "err", response: "expiresAfter timestamp has passed" },
      "expired",
    ],
    [{ status: "wat" }, "reconciling"],
  ] as const)(
    "classifies provider outcome without resubmission",
    async (response, phase) => {
      const h = harness(response);
      const result = await h.orchestrator.confirm(h.review);
      expect(result.phase).toBe(phase);
      expect(h.calls.filter((call) => call === "submit")).toHaveLength(1);
    },
  );

  test("abandons a reserved action when context changes before signing completes", async () => {
    const h = harness({ status: "ok", response: { type: "default" } });
    h.switchContextDuringSign();
    const result = await h.orchestrator.confirm(h.review);
    expect(result.phase).toBe("failed_before_submission");
    expect(h.currentRecord()?.state).toBe("abandoned_before_submission");
    expect(h.calls).not.toContain("submit");
  });

  test("denies mainnet review before session access", () => {
    expect(() =>
      createActionReview({
        binding: { ...binding, network: "mainnet" },
        capturedContextEpoch: 4,
        validation: validation("mainnet"),
      }),
    ).toThrow("mainnet");
  });

  test("owns an immutable review snapshot after caller mutation", async () => {
    const mutable = validation();
    const h = harness(
      {
        status: "ok",
        response: {
          type: "order",
          data: { statuses: [{ resting: { oid: 42 } }] },
        },
      },
      mutable,
    );
    (mutable.intent as { size: string }).size = "9";
    (mutable.market as { metadataFingerprint: string }).metadataFingerprint =
      "forged-after-review";
    (mutable.account as { version: number }).version = 99;

    expect(
      h.review.validated.intent.type === "limit_order" &&
        h.review.validated.intent.size,
    ).toBe("0.1");
    expect(h.review.validation.market.metadataFingerprint).toBe("metadata-v1");
    expect(h.review.validated.accountStateVersion).toBe(8);
    expect((await h.orchestrator.confirm(h.review)).phase).toBe("accepted");
    expect(h.currentRecord()?.normalizedSecretFreeIntent.size).toBe("0.1");
  });

  test.each(["metadata", "account", "market", "epoch"] as const)(
    "fails stale %s evidence before reservation",
    async (kind) => {
      const h = harness({ status: "ok", response: { type: "default" } });
      const fresh = validation();
      h.setRefreshedValidation(
        kind === "metadata"
          ? {
              ...fresh,
              market: { ...fresh.market, metadataFingerprint: "metadata-v2" },
            }
          : kind === "account"
            ? {
                ...fresh,
                account: {
                  ...fresh.account,
                  version: fresh.account.version + 1,
                },
              }
            : kind === "market"
              ? {
                  ...fresh,
                  market: { ...fresh.market, canonicalId: "perp:ETH" },
                }
              : {
                  ...fresh,
                  context: {
                    ...fresh.context,
                    capturedContextEpoch: 5,
                    currentContextEpoch: 5,
                  },
                },
      );
      expect((await h.orchestrator.confirm(h.review)).phase).toBe(
        "failed_before_submission",
      );
      expect(h.calls).not.toContain("reserve");
    },
  );

  test("observer failures cannot interrupt the single transport write", async () => {
    const h = harness({
      status: "ok",
      response: {
        type: "order",
        data: { statuses: [{ resting: { oid: 42 } }] },
      },
    });
    h.orchestrator.subscribe(() => {
      throw new Error("presentation observer failed");
    });
    expect((await h.orchestrator.confirm(h.review)).phase).toBe("accepted");
    expect(h.calls.filter((call) => call === "submit")).toHaveLength(1);
    expect(h.currentRecord()?.state).toBe("accepted");
  });

  test("reflects a concurrent terminal journal transition after the write", async () => {
    const h = harness({
      status: "ok",
      response: {
        type: "order",
        data: { statuses: [{ resting: { oid: 42 } }] },
      },
    });
    h.raceAcceptedTransition();
    expect((await h.orchestrator.confirm(h.review)).phase).toBe("accepted");
    expect(h.currentRecord()?.state).toBe("accepted");
    expect(h.calls.filter((call) => call === "submit")).toHaveLength(1);
  });

  test("treats an exception after the durable marker as unresolved", async () => {
    const h = harness({ status: "ok", response: { type: "default" } });
    h.throwAfterSubmissionMarker();
    expect((await h.orchestrator.confirm(h.review)).phase).toBe("reconciling");
    expect(h.currentRecord()?.state).toBe("unresolved");
    expect(h.calls).not.toContain("submit");
  });

  test("treats response loss after transport starts as unresolved", async () => {
    const h = harness({ status: "ok", response: { type: "default" } });
    h.loseTransportResponse();
    expect((await h.orchestrator.confirm(h.review)).phase).toBe("reconciling");
    expect(h.currentRecord()?.state).toBe("unresolved");
    expect(h.calls.filter((call) => call === "submit")).toHaveLength(1);
  });

  test("a duplicate confirmation cannot create a second write", async () => {
    const h = harness({ status: "ok", response: { type: "default" } });
    const first = h.orchestrator.confirm(h.review);
    await expect(h.orchestrator.confirm(h.review)).rejects.toThrow(
      "already in progress",
    );
    expect((await first).phase).toBe("accepted");
    expect(h.calls.filter((call) => call === "submit")).toHaveLength(1);
  });

  test("derives the exact vault target and rejects a forged target", () => {
    const review = createActionReview({
      binding,
      capturedContextEpoch: 4,
      validation: validation(),
    });
    expect(review.vaultAddress).toBe(binding.targetAccount as `0x${string}`);
    expect(() =>
      createActionReview({
        binding,
        capturedContextEpoch: 4,
        validation: validation(),
        vaultAddress: binding.masterAccount as `0x${string}`,
      }),
    ).toThrow("vault");
  });
});
