import { describe, expect, test } from "bun:test";
import type {
  AccountTarget,
  ActiveAssetData,
  ClearinghouseState,
  HyperliquidClient,
  SignerBinding,
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

function review() {
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
      },
      controls: { slippageBps: null, trigger: null },
      intent: {
        type: "limit_order",
        assetId: NATIVE_DUPLICATE.orderAssetId,
        side: "buy",
        size: "1",
        limitPrice: "10",
        timeInForce: "Gtc",
        reduceOnly: false,
        cloid: "0x00000000000000000000000000000001",
      },
    },
  });
}

function client(
  state: ClearinghouseState,
  availableToTrade: ActiveAssetData["availableToTrade"] = ["118", "117"],
): HyperliquidClient {
  return {
    network: "testnet",
    async getMarketCatalog() {
      return {
        markets: [NATIVE_DUPLICATE],
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
            coin: NATIVE_DUPLICATE.coin,
            leverage: { type: "cross", value: 5 },
            maxTradeSizes: ["23", "22"],
            availableToTrade,
            markPrice: "10",
          },
        };
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
