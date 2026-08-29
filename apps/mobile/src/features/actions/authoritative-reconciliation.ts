import {
  type AccountTarget,
  createHyperliquidClient,
  type HyperliquidClient,
  type PreparedActionRecord,
  parseAuthoritativeOrderStatus,
  type ReconciliationEvidence,
} from "@hyper-trader/hyperliquid";
import type { Market } from "@hyper-trader/hyperliquid/public";

import type { AuthoritativeServerClock } from "./authoritative-order-refresh";
import type { ReconciliationEvidenceSource } from "./reconciler";

function accountTarget(record: PreparedActionRecord): AccountTarget {
  return record.masterAccount === record.targetAccount
    ? { kind: "master", address: record.targetAccount }
    : {
        kind: "vault",
        address: record.targetAccount,
        masterAddress: record.masterAccount,
      };
}

function currentServerTime(clock: AuthoritativeServerClock): number {
  const sample = clock.read();
  const elapsed = sample.monotonicTimeMs - sample.serverSampledAtMonotonicMs;
  const current = sample.serverTimeMs + elapsed;
  if (
    !Number.isSafeInteger(sample.serverTimeMs) ||
    sample.serverTimeMs < 0 ||
    !Number.isSafeInteger(sample.monotonicTimeMs) ||
    !Number.isSafeInteger(sample.serverSampledAtMonotonicMs) ||
    sample.serverSampledAtMonotonicMs < 0 ||
    elapsed < 0 ||
    !Number.isSafeInteger(current) ||
    current < 0
  ) {
    throw new Error(
      "Hyperliquid server time is unavailable for reconciliation.",
    );
  }
  return current;
}

function baseEvidence(
  record: PreparedActionRecord,
  serverTimeMs: number,
): Pick<
  ReconciliationEvidence,
  | "context"
  | "serverTimeMs"
  | "complete"
  | "openOrders"
  | "fills"
  | "position"
  | "stateVersion"
> {
  return {
    context: {
      network: record.network,
      masterAccount: record.masterAccount,
      targetAccount: record.targetAccount,
      assetId: record.assetId,
    },
    serverTimeMs,
    // `orderStatus` is an authoritative lookup by this journal's immutable
    // cloid/oid. The collection fields remain available for supplementary
    // evidence, but an undocumented heuristic match must never fill them.
    complete: true,
    openOrders: [],
    fills: [],
    position: null,
    stateVersion: serverTimeMs,
  };
}

async function loadOrderEvidence(input: {
  readonly client: HyperliquidClient;
  readonly clock: AuthoritativeServerClock;
  readonly record: PreparedActionRecord;
}): Promise<ReconciliationEvidence> {
  const { record } = input;
  if (record.assetId === null) {
    throw new Error("Order reconciliation requires an asset ID.");
  }
  const oid = record.cloid ?? record.targetOid;
  if (oid === null) {
    throw new Error("Order reconciliation requires an order identity.");
  }
  const result = await input.client.accounts.getOrderStatus(
    accountTarget(record),
    oid,
  );
  const serverTimeMs = currentServerTime(input.clock);
  const order = parseAuthoritativeOrderStatus(result.data.raw, {
    assetId: record.assetId,
    oid: record.targetOid,
    cloid: record.cloid,
  });
  return {
    ...baseEvidence(record, serverTimeMs),
    order,
    openOrders:
      order.kind === "order" && order.status === "open"
        ? [
            {
              assetId: order.assetId,
              oid: order.oid,
              cloid: order.cloid,
            },
          ]
        : [],
  };
}

async function loadPerpMarket(input: {
  readonly client: HyperliquidClient;
  readonly record: PreparedActionRecord;
}): Promise<Extract<Market, { readonly family: "perp" }>> {
  const { record } = input;
  const marketCanonicalId = record.normalizedSecretFreeIntent.marketCanonicalId;
  if (record.assetId === null || typeof marketCanonicalId !== "string") {
    throw new Error("Reconciliation requires an exact perpetual market.");
  }
  const catalog = await input.client.getMarketCatalog({
    scope: marketCanonicalId.startsWith("perp:0:") ? "native" : "complete",
  });
  const matches = catalog.markets.filter(
    (market) =>
      market.family === "perp" &&
      market.canonicalId === marketCanonicalId &&
      market.orderAssetId === record.assetId,
  );
  const market = matches.length === 1 ? matches[0] : null;
  if (market?.family !== "perp") {
    throw new Error("The perpetual market is unavailable for reconciliation.");
  }
  return market;
}

async function loadReduceCloseEvidence(input: {
  readonly client: HyperliquidClient;
  readonly clock: AuthoritativeServerClock;
  readonly record: PreparedActionRecord;
}): Promise<ReconciliationEvidence> {
  const evidence = await loadOrderEvidence(input);
  if (
    evidence.order.kind !== "unknown" ||
    evidence.serverTimeMs <= input.record.expiresAfterMs
  ) {
    return evidence;
  }
  const market = await loadPerpMarket({
    client: input.client,
    record: input.record,
  });
  const state = await input.client.accounts.getClearinghouseState(
    accountTarget(input.record),
    market.dexName,
  );
  const position = state.data.positions.find(
    ({ coin }) => coin === market.coin,
  );
  const serverTimeMs = currentServerTime(input.clock);
  return {
    ...evidence,
    serverTimeMs,
    position: {
      assetId: market.orderAssetId,
      size: position?.size ?? "0",
    },
    stateVersion: serverTimeMs,
  };
}

async function loadLeverageEvidence(input: {
  readonly client: HyperliquidClient;
  readonly clock: AuthoritativeServerClock;
  readonly record: PreparedActionRecord;
}): Promise<ReconciliationEvidence> {
  const { record } = input;
  const market = await loadPerpMarket({ client: input.client, record });
  const activeAsset = await input.client.accounts.getActiveAssetData(
    accountTarget(record),
    market.coin,
  );
  const serverTimeMs = currentServerTime(input.clock);
  return {
    ...baseEvidence(record, serverTimeMs),
    order: { kind: "unknown" },
    leverage: {
      assetId: market.orderAssetId,
      leverage: activeAsset.data.leverage.value,
      marginMode: activeAsset.data.leverage.type,
      // An indistinguishable external update can match the requested value, so
      // state observation alone cannot prove this submission caused the change.
      causallyAttributed: false,
    },
  };
}

export function createHyperliquidReconciliationEvidenceSource(input: {
  readonly clock: AuthoritativeServerClock;
  readonly client?: HyperliquidClient;
}): ReconciliationEvidenceSource {
  return Object.freeze({
    async load(record: PreparedActionRecord): Promise<ReconciliationEvidence> {
      const client =
        input.client ??
        createHyperliquidClient({
          network: record.network,
          fetch: input.clock.fetch,
        });
      if (client.network !== record.network) {
        throw new Error(
          "The reconciliation client must match the journal network.",
        );
      }
      switch (record.actionType) {
        case "market_order":
        case "limit_order":
        case "position_tpsl":
        case "cancel":
          return loadOrderEvidence({ client, clock: input.clock, record });
        case "reduce_only_close":
          return loadReduceCloseEvidence({
            client,
            clock: input.clock,
            record,
          });
        case "update_leverage":
          return loadLeverageEvidence({ client, clock: input.clock, record });
        case "bulk_cancel":
          throw new Error("Bulk cancel reconciliation is unavailable.");
      }
    },
  });
}
