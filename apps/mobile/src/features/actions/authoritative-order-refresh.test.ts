import { describe, expect, test } from "bun:test";
import type {
  AccountTarget,
  ActiveAssetData,
  ClearinghouseState,
  HyperliquidClient,
  Market,
  MarketCatalogRequestOptions,
  OpenOrder,
  SignerBinding,
  TradingActionIntent,
} from "@hyper-trader/hyperliquid";
import { validateTradingAction } from "@hyper-trader/hyperliquid";

import { NATIVE_DUPLICATE } from "../markets/fixture";
import { PORTFOLIO_FIXTURE } from "../portfolio/portfolio.fixture";
import { tradeMarketFingerprint } from "../trade/trade-model";
import {
  createTestnetServerClock,
  isActionReviewContextCurrent,
  refreshReviewedOrder,
  type TestnetServerClock,
} from "./authoritative-order-refresh";
import { createActionReview } from "./orchestrator";

const NOW = 1_720_000_050_000;
const binding: SignerBinding = {
  network: "testnet",
  masterAccount: "0x1111111111111111111111111111111111111111",
  targetAccount: "0x1111111111111111111111111111111111111111",
  agentAddress: "0x3333333333333333333333333333333333333333",
  generation: 1,
};

function review(
  intent: TradingActionIntent = {
    type: "limit_order",
    assetId: NATIVE_DUPLICATE.orderAssetId,
    side: "buy",
    size: "1",
    limitPrice: "10",
    timeInForce: "Gtc",
    reduceOnly: false,
    cloid: "0x00000000000000000000000000000001",
  },
  slippageBps: number | null = null,
) {
  return createActionReview({
    binding,
    capturedContextEpoch: 4,
    validation: {
      context: {
        network: "testnet",
        masterAccount: binding.masterAccount,
        targetAccount: binding.targetAccount,
        capturedContextEpoch: 4,
        currentContextEpoch: 4,
        currentNetwork: "testnet",
        currentMasterAccount: binding.masterAccount,
        currentTargetAccount: binding.targetAccount,
        reviewedAtMs: NOW,
        reviewExpiresAtMs: NOW + 30_000,
        nowMs: NOW,
      },
      market: {
        canonicalId: NATIVE_DUPLICATE.canonicalId,
        metadataFingerprint: tradeMarketFingerprint(NATIVE_DUPLICATE),
        orderAssetId: NATIVE_DUPLICATE.orderAssetId,
        family: "perp",
        lifecycle: "active",
        orderAvailability: "enabled",
        sizeDecimals: NATIVE_DUPLICATE.sizeDecimals,
        pricePrecision: NATIVE_DUPLICATE.pricePrecision,
        maxLeverage: NATIVE_DUPLICATE.maxLeverage,
        onlyIsolated: NATIVE_DUPLICATE.onlyIsolated,
        referencePrice: "10",
      },
      account: {
        availableMargin: "118",
        leverage: 5,
        marginMode: "cross",
        positionSize: "2.5",
        version: 1_720_000_030_000,
        ...(intent.type === "cancel"
          ? {
              openOrders: [
                intent.target.kind === "oid"
                  ? { assetId: intent.assetId, oid: intent.target.oid }
                  : { assetId: intent.assetId, cloid: intent.target.cloid },
              ],
            }
          : {}),
      },
      controls: { slippageBps, trigger: null },
      intent,
    },
  });
}

function client(
  state: ClearinghouseState,
  availableToTrade: ActiveAssetData["availableToTrade"] = ["118", "117"],
  catalogScopes?: string[],
  market: Market = NATIVE_DUPLICATE,
  openOrders: readonly OpenOrder[] = PORTFOLIO_FIXTURE.perpStates[0].openOrders,
): HyperliquidClient {
  return {
    network: "testnet",
    async getMarketCatalog(options?: MarketCatalogRequestOptions) {
      if (options?.scope !== undefined) catalogScopes?.push(options.scope);
      return {
        markets: [market],
        quarantined: [],
        sourceErrors: [],
      };
    },
    accounts: {
      async getClearinghouseState(target: AccountTarget) {
        return { target, sourceDex: "", data: state };
      },
      async getActiveAssetData(target: AccountTarget) {
        return {
          target,
          sourceDex: null,
          data: {
            user: target.address,
            coin: market.coin,
            leverage: { type: "cross", value: 5 },
            maxTradeSizes: ["23", "22"],
            availableToTrade,
            markPrice: market.markPx ?? "10",
          },
        };
      },
      async getOpenOrders(target: AccountTarget, dex: string) {
        return { target, sourceDex: dex, data: openOrders };
      },
    },
  } as unknown as HyperliquidClient;
}

const unusedClock: TestnetServerClock = {
  fetch: globalThis.fetch,
  read() {
    throw new Error("not used by refresh");
  },
};

describe("development authoritative order refresh", () => {
  test("captures bounded Hyperliquid server time from response headers", async () => {
    let monotonic = 100;
    const clock = createTestnetServerClock({
      fetch: (async () =>
        new Response("{}", {
          headers: { date: "Tue, 20 Aug 2024 00:00:00 GMT" },
        })) as unknown as typeof fetch,
      wallNow: () => 1_724_112_000_250,
      monotonicNow: () => monotonic,
    });
    await clock.fetch("https://api.hyperliquid-testnet.xyz/info");
    monotonic = 150;
    expect(clock.read()).toEqual({
      wallTimeMs: 1_724_112_000_250,
      monotonicTimeMs: 150,
      serverTimeMs: 1_724_112_000_000,
      serverSampledAtMonotonicMs: 100,
      lastObservedWallMs: null,
    });
  });

  test("revalidates volatile margin without treating it as a stale account", async () => {
    const candidate = review();
    const current = {
      context: {
        network: "testnet" as const,
        masterAccount: binding.masterAccount,
        targetAccount: binding.targetAccount,
        signer: {
          agentAddress: binding.agentAddress,
          generation: binding.generation,
        },
      },
      epoch: 4,
    };
    const unchanged = await refreshReviewedOrder({
      review: candidate,
      clock: unusedClock,
      client: client(PORTFOLIO_FIXTURE.perpStates[0].state),
      readCurrentContext: () => current,
      now: () => NOW + 1_000,
    });
    expect(unchanged.account.version).toBe(
      candidate.validation.account.version,
    );
    expect(unchanged.market.metadataFingerprint).toBe(
      candidate.validation.market.metadataFingerprint,
    );
    expect(isActionReviewContextCurrent(candidate, current)).toBe(true);

    const changed = await refreshReviewedOrder({
      review: candidate,
      clock: unusedClock,
      client: client(PORTFOLIO_FIXTURE.perpStates[0].state, ["117", "116"]),
      readCurrentContext: () => current,
      now: () => NOW + 1_000,
    });
    expect(changed.account.availableMargin).toBe("117");
    expect(changed.account.version).toBe(candidate.validation.account.version);
    expect(validateTradingAction(changed).accountStateVersion).toBe(
      candidate.validation.account.version,
    );

    const insufficient = await refreshReviewedOrder({
      review: candidate,
      clock: unusedClock,
      client: client(PORTFOLIO_FIXTURE.perpStates[0].state, ["0.01", "0.02"]),
      readCurrentContext: () => current,
      now: () => NOW + 1_000,
    });
    expect(() => validateTradingAction(insufficient)).toThrow(
      "insufficient current margin for this action",
    );
  });

  test("refreshes only native perpetual metadata for a perpetual order", async () => {
    const scopes: string[] = [];
    await refreshReviewedOrder({
      review: review(),
      clock: unusedClock,
      client: client(
        PORTFOLIO_FIXTURE.perpStates[0].state,
        ["118", "117"],
        scopes,
      ),
      readCurrentContext: () => ({
        context: {
          network: "testnet",
          masterAccount: binding.masterAccount,
          targetAccount: binding.targetAccount,
          signer: {
            agentAddress: binding.agentAddress,
            generation: binding.generation,
          },
        },
        epoch: 4,
      }),
      now: () => NOW + 1_000,
    });

    expect(scopes).toEqual(["native"]);
  });

  test("changes the account version when a position field changes", async () => {
    const candidate = review();
    const current = {
      context: {
        network: "testnet" as const,
        masterAccount: binding.masterAccount,
        targetAccount: binding.targetAccount,
        signer: {
          agentAddress: binding.agentAddress,
          generation: binding.generation,
        },
      },
      epoch: 4,
    };
    const state = PORTFOLIO_FIXTURE.perpStates[0].state;
    const position = state.positions[0];
    if (!position) throw new Error("The fixture position is unavailable.");
    const changed = await refreshReviewedOrder({
      review: candidate,
      clock: unusedClock,
      client: client({
        ...state,
        positions: [{ ...position, size: "2.6" }],
      }),
      readCurrentContext: () => current,
      now: () => NOW + 1_000,
    });
    expect(changed.account.version).not.toBe(
      candidate.validation.account.version,
    );
  });

  test("revalidates a full reduce-only close against the current position", async () => {
    const candidate = review(
      {
        type: "reduce_only_close",
        assetId: NATIVE_DUPLICATE.orderAssetId,
        side: "sell",
        size: "2.5",
        aggressiveLimitPrice: "9.95",
        cloid: "0x00000000000000000000000000000002",
      },
      50,
    );
    const current = {
      context: {
        network: "testnet" as const,
        masterAccount: binding.masterAccount,
        targetAccount: binding.targetAccount,
        signer: {
          agentAddress: binding.agentAddress,
          generation: binding.generation,
        },
      },
      epoch: 4,
    };

    const refreshed = await refreshReviewedOrder({
      review: candidate,
      clock: unusedClock,
      client: client(PORTFOLIO_FIXTURE.perpStates[0].state),
      readCurrentContext: () => current,
      now: () => NOW + 1_000,
    });

    expect(validateTradingAction(refreshed)).toMatchObject({
      intent: candidate.validated.intent,
      accountStateVersion: candidate.validated.accountStateVersion,
      marketCanonicalId: candidate.validated.marketCanonicalId,
    });
  });

  test("rebases a full close IOC bound to the authoritative market price", async () => {
    const candidate = review(
      {
        type: "reduce_only_close",
        assetId: NATIVE_DUPLICATE.orderAssetId,
        side: "sell",
        size: "2.5",
        aggressiveLimitPrice: "9.95",
        cloid: "0x00000000000000000000000000000003",
      },
      50,
    );
    const movedMarket = {
      ...NATIVE_DUPLICATE,
      markPx: "10.1",
    } satisfies Market;

    const refreshed = await refreshReviewedOrder({
      review: candidate,
      clock: unusedClock,
      client: client(
        PORTFOLIO_FIXTURE.perpStates[0].state,
        ["118", "117"],
        undefined,
        movedMarket,
      ),
      readCurrentContext: () => ({
        context: {
          network: "testnet",
          masterAccount: binding.masterAccount,
          targetAccount: binding.targetAccount,
          signer: {
            agentAddress: binding.agentAddress,
            generation: binding.generation,
          },
        },
        epoch: 4,
      }),
      now: () => NOW + 1_000,
    });

    expect(refreshed.market.referencePrice).toBe("10.1");
    expect(refreshed.intent).toMatchObject({
      type: "reduce_only_close",
      aggressiveLimitPrice: "10.05",
    });
    expect(validateTradingAction(refreshed).intent).toEqual(refreshed.intent);
  });

  test("revalidates cancellation against the exact current open order", async () => {
    const candidate = review({
      type: "cancel",
      assetId: NATIVE_DUPLICATE.orderAssetId,
      target: { kind: "oid", oid: 71 },
    });
    const refreshed = await refreshReviewedOrder({
      review: candidate,
      clock: unusedClock,
      client: client(PORTFOLIO_FIXTURE.perpStates[0].state),
      readCurrentContext: () => ({
        context: {
          network: "testnet",
          masterAccount: binding.masterAccount,
          targetAccount: binding.targetAccount,
          signer: {
            agentAddress: binding.agentAddress,
            generation: binding.generation,
          },
        },
        epoch: 4,
      }),
      now: () => NOW + 1_000,
    });

    expect(refreshed.account).toEqual({
      availableMargin: "118",
      version: candidate.validation.account.version,
      openOrders: [{ assetId: NATIVE_DUPLICATE.orderAssetId, oid: 71 }],
    });
    expect(validateTradingAction(refreshed)).toMatchObject({
      intent: candidate.validated.intent,
      accountStateVersion: candidate.validated.accountStateVersion,
    });
  });

  test("stops a cancellation when the exact order is no longer open", async () => {
    const candidate = review({
      type: "cancel",
      assetId: NATIVE_DUPLICATE.orderAssetId,
      target: { kind: "oid", oid: 71 },
    });

    await expect(
      refreshReviewedOrder({
        review: candidate,
        clock: unusedClock,
        client: client(
          PORTFOLIO_FIXTURE.perpStates[0].state,
          ["118", "117"],
          undefined,
          NATIVE_DUPLICATE,
          [],
        ),
        readCurrentContext: () => ({
          context: {
            network: "testnet",
            masterAccount: binding.masterAccount,
            targetAccount: binding.targetAccount,
            signer: {
              agentAddress: binding.agentAddress,
              generation: binding.generation,
            },
          },
          epoch: 4,
        }),
        now: () => NOW + 1_000,
      }),
    ).rejects.toMatchObject({
      code: "cancel_target_not_open",
      message: "The reviewed order is no longer open.",
    });
  });

  test("rejects a review after the context epoch changes", () => {
    const candidate = review();
    expect(
      isActionReviewContextCurrent(candidate, {
        context: {
          network: "testnet",
          masterAccount: binding.masterAccount,
          targetAccount: binding.targetAccount,
          signer: {
            agentAddress: binding.agentAddress,
            generation: binding.generation,
          },
        },
        epoch: 5,
      }),
    ).toBe(false);
  });
});
