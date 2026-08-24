import { describe, expect, test } from "bun:test";
import {
  type AccountTarget,
  decideReconciliation,
  type HyperliquidClient,
  type PreparedActionRecord,
} from "@hyper-trader/hyperliquid";

import type { TestnetServerClock } from "./authoritative-order-refresh";
import { createHyperliquidReconciliationEvidenceSource } from "./authoritative-reconciliation";

const CLOID = "0x00000000000000000000000000000001";

function record(
  overrides: Partial<PreparedActionRecord> = {},
): PreparedActionRecord {
  return {
    journalId: "jrnl_00000000000000000000000000000001",
    correlationId: "act_00000000000000000000000000000001",
    network: "testnet",
    masterAccount: "0x1111111111111111111111111111111111111111",
    targetAccount: "0x2222222222222222222222222222222222222222",
    agentAddress: "0x3333333333333333333333333333333333333333",
    signerGeneration: 1,
    capturedContextEpoch: 4,
    actionType: "limit_order",
    intentVersion: 1,
    normalizedSecretFreeIntent: { marketCanonicalId: "perp:0:0" },
    intentDigest: `0x${"11".repeat(32)}`,
    equivalenceFingerprint: `0x${"22".repeat(32)}`,
    nonce: 1_000,
    expiresAfterMs: 2_000,
    cloid: CLOID,
    assetId: 0,
    targetOid: null,
    reconciliationKey: `order:0:cloid:${CLOID}`,
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
    ...overrides,
  };
}

function clock(): TestnetServerClock {
  return {
    fetch: globalThis.fetch,
    read: () => ({
      wallTimeMs: 2_100,
      monotonicTimeMs: 150,
      serverTimeMs: 2_000,
      serverSampledAtMonotonicMs: 100,
      lastObservedWallMs: null,
    }),
  };
}

function client(input: {
  readonly response: Readonly<Record<string, unknown>>;
  readonly observed: {
    target: AccountTarget | null;
    oid: number | string | null;
  };
}): HyperliquidClient {
  return {
    network: "testnet",
    accounts: {
      async getOrderStatus(target: AccountTarget, oid: number | string) {
        input.observed.target = target;
        input.observed.oid = oid;
        return {
          target,
          sourceDex: null,
          data: { status: String(input.response.status), raw: input.response },
        };
      },
    },
  } as unknown as HyperliquidClient;
}

describe("Hyperliquid reconciliation evidence", () => {
  test("queries orderStatus by cloid and accepts the exact documented order", async () => {
    const observed = { target: null, oid: null } as {
      target: AccountTarget | null;
      oid: number | string | null;
    };
    const candidate = record();
    const source = createHyperliquidReconciliationEvidenceSource({
      clock: clock(),
      client: client({
        observed,
        response: {
          status: "order",
          order: {
            order: { oid: 42, cloid: CLOID },
            status: "filled",
            statusTimestamp: 2_020,
          },
        },
      }),
    });

    const evidence = await source.load(candidate);

    expect(observed).toEqual({
      target: {
        kind: "vault",
        address: candidate.targetAccount,
        masterAddress: candidate.masterAccount,
      },
      oid: CLOID,
    });
    expect(evidence).toMatchObject({
      complete: true,
      serverTimeMs: 2_050,
      stateVersion: 2_050,
      order: {
        kind: "order",
        assetId: 0,
        oid: 42,
        cloid: CLOID,
        status: "filled",
      },
    });
    expect(decideReconciliation({ record: candidate, evidence })).toEqual({
      kind: "terminal",
      state: "accepted",
    });
  });

  test("expires only after authoritative orderStatus still reports unknown", async () => {
    const candidate = record();
    const evidence = await createHyperliquidReconciliationEvidenceSource({
      clock: clock(),
      client: client({
        observed: { target: null, oid: null },
        response: { status: "unknownOid" },
      }),
    }).load(candidate);

    expect(evidence.order).toEqual({ kind: "unknown" });
    expect(decideReconciliation({ record: candidate, evidence })).toEqual({
      kind: "terminal",
      state: "expired",
    });
  });

  test("treats an exact still-open cancel target as expired after its deadline", async () => {
    const candidate = record({
      actionType: "cancel",
      normalizedSecretFreeIntent: {
        marketCanonicalId: "perp:0:0",
        targetObservedBeforeSubmission: true,
      },
    });
    const evidence = await createHyperliquidReconciliationEvidenceSource({
      clock: clock(),
      client: client({
        observed: { target: null, oid: null },
        response: {
          status: "order",
          order: {
            order: { oid: 42, cloid: CLOID },
            status: "open",
            statusTimestamp: 2_020,
          },
        },
      }),
    }).load(candidate);

    expect(evidence.openOrders).toEqual([
      { assetId: 0, oid: 42, cloid: CLOID },
    ]);
    expect(decideReconciliation({ record: candidate, evidence })).toEqual({
      kind: "terminal",
      state: "expired",
    });
  });

  test("marks an unattributed closed position ambiguous when close order status is unknown", async () => {
    const candidate = record({
      actionType: "reduce_only_close",
      normalizedSecretFreeIntent: {
        marketCanonicalId: "perp:0:0",
        reviewedPositionSize: "2.5",
      },
    });
    const target = {
      kind: "vault" as const,
      address: candidate.targetAccount,
      masterAddress: candidate.masterAccount,
    };
    const closeClient = {
      network: "testnet",
      async getMarketCatalog() {
        return {
          markets: [
            {
              family: "perp",
              canonicalId: "perp:0:0",
              orderAssetId: 0,
              coin: "BTC",
              dexName: "",
            },
          ],
          quarantined: [],
          sourceErrors: [],
          discoveredDexes: [],
        };
      },
      accounts: {
        async getOrderStatus() {
          return {
            target,
            sourceDex: null,
            data: { status: "unknownOid", raw: { status: "unknownOid" } },
          };
        },
        async getClearinghouseState() {
          return {
            target,
            sourceDex: "",
            data: { positions: [{ coin: "BTC", size: "0" }] },
          };
        },
      },
    } as unknown as HyperliquidClient;

    const evidence = await createHyperliquidReconciliationEvidenceSource({
      clock: clock(),
      client: closeClient,
    }).load(candidate);

    expect(evidence.position).toEqual({ assetId: 0, size: "0" });
    expect(decideReconciliation({ record: candidate, evidence })).toEqual({
      kind: "terminal",
      state: "reconciled_ambiguous",
    });
  });
});
