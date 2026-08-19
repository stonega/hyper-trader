import {
  type AccountTarget,
  assertSignerBinding,
  assertTestnetSigningCapability,
  type ClockGateInput,
  createHyperliquidClient,
  type HyperliquidClient,
  type SignerBinding,
  type TradingActionValidationInput,
} from "@hyper-trader/hyperliquid";
import type { DecimalString, Market } from "@hyper-trader/hyperliquid/public";

import type { NormalizedTradingContext } from "../../core/context/supervisor";
import {
  tradePerpAccountSnapshot,
  tradeSpotAccountSnapshot,
} from "../trade/trade-account-snapshot";
import {
  type TradeAccountSnapshot,
  tradeMarketFingerprint,
  tradeReferencePrice,
} from "../trade/trade-model";
import type { ActionReviewSnapshot } from "./orchestrator";

export interface TestnetServerClock {
  readonly fetch: typeof globalThis.fetch;
  read(): ClockGateInput;
}

export interface CurrentActionContext {
  readonly context: NormalizedTradingContext;
  readonly epoch: number;
}

function safeMilliseconds(value: number, label: string): number {
  const milliseconds = Math.floor(value);
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
    throw new Error(`${label} is unavailable.`);
  }
  return milliseconds;
}

export function createTestnetServerClock(
  options: {
    readonly fetch?: typeof globalThis.fetch;
    readonly wallNow?: () => number;
    readonly monotonicNow?: () => number;
  } = {},
): TestnetServerClock {
  const fetchRequest = options.fetch ?? globalThis.fetch.bind(globalThis);
  const wallNow = options.wallNow ?? Date.now;
  const monotonicNow =
    options.monotonicNow ?? (() => globalThis.performance.now());
  let sample: {
    readonly serverTimeMs: number;
    readonly sampledAtMonotonicMs: number;
  } | null = null;

  const timedFetch = (async (input, init) => {
    const response = await fetchRequest(input, init);
    const serverDate = response.headers.get("date");
    if (serverDate !== null) {
      const parsed = Date.parse(serverDate);
      if (Number.isSafeInteger(parsed) && parsed >= 0) {
        sample = {
          serverTimeMs: parsed,
          sampledAtMonotonicMs: safeMilliseconds(
            monotonicNow(),
            "The monotonic clock",
          ),
        };
      }
    }
    return response;
  }) as typeof globalThis.fetch;

  return Object.freeze({
    fetch: timedFetch,
    read(): ClockGateInput {
      if (sample === null) {
        throw new Error(
          "Hyperliquid server time is unavailable. Refresh before signing.",
        );
      }
      return {
        wallTimeMs: safeMilliseconds(wallNow(), "The device clock"),
        monotonicTimeMs: safeMilliseconds(
          monotonicNow(),
          "The monotonic clock",
        ),
        serverTimeMs: sample.serverTimeMs,
        serverSampledAtMonotonicMs: sample.sampledAtMonotonicMs,
        lastObservedWallMs: null,
      };
    },
  });
}

function bindingForContext(context: NormalizedTradingContext): SignerBinding {
  if (
    context.network !== "testnet" ||
    context.masterAccount === null ||
    context.targetAccount === null ||
    context.signer === null
  ) {
    throw new Error("The exact testnet signing context is unavailable.");
  }
  return {
    network: "testnet",
    masterAccount: context.masterAccount,
    targetAccount: context.targetAccount,
    agentAddress: context.signer.agentAddress,
    generation: context.signer.generation,
  };
}

export function isActionReviewContextCurrent(
  review: ActionReviewSnapshot,
  current: CurrentActionContext,
): boolean {
  try {
    if (
      current.epoch !== review.validation.context.capturedContextEpoch ||
      review.validation.context.currentContextEpoch !==
        review.validation.context.capturedContextEpoch
    ) {
      return false;
    }
    assertSignerBinding(review.binding, bindingForContext(current.context));
    return true;
  } catch {
    return false;
  }
}

function accountTarget(binding: SignerBinding): AccountTarget {
  return binding.masterAccount === binding.targetAccount
    ? { kind: "master", address: binding.targetAccount }
    : {
        kind: "vault",
        address: binding.targetAccount,
        masterAddress: binding.masterAccount,
      };
}

async function loadAccountSnapshot(input: {
  readonly client: HyperliquidClient;
  readonly target: AccountTarget;
  readonly market: Market;
}): Promise<TradeAccountSnapshot> {
  if (input.market.family === "perp") {
    const state = await input.client.accounts.getClearinghouseState(
      input.target,
      input.market.dexName,
    );
    const snapshot = tradePerpAccountSnapshot({
      state: state.data,
      market: input.market,
      observedAtMs: Date.now(),
    });
    if (snapshot !== null) return snapshot;
  } else if (input.market.family === "spot") {
    const state = await input.client.accounts.getSpotClearinghouseState(
      input.target,
    );
    const snapshot = tradeSpotAccountSnapshot({
      state: state.data,
      market: input.market,
      observedAtMs: Date.now(),
    });
    if (snapshot !== null) return snapshot;
  }
  throw new Error("The refreshed account snapshot is unavailable.");
}

function sameReviewedAccount(
  review: ActionReviewSnapshot,
  market: Market,
  refreshed: TradeAccountSnapshot,
): boolean {
  const expectedLeverage = market.family === "spot" ? 1 : refreshed.leverage;
  const expectedMarginMode =
    market.family === "spot" ? undefined : (refreshed.marginMode ?? undefined);
  return (
    review.validation.account.availableMargin === refreshed.availableFunds &&
    review.validation.account.leverage === (expectedLeverage ?? undefined) &&
    review.validation.account.marginMode === expectedMarginMode &&
    review.validation.account.positionSize === refreshed.positionSize
  );
}

function changedVersion(reviewedVersion: number): number {
  return reviewedVersion === Number.MAX_SAFE_INTEGER ? 0 : reviewedVersion + 1;
}

function refreshedMarketValidation(
  market: Market,
): TradingActionValidationInput["market"] {
  const referencePrice = tradeReferencePrice(market);
  if (referencePrice === "") {
    throw new Error("The refreshed market reference price is unavailable.");
  }
  return {
    canonicalId: market.canonicalId,
    metadataFingerprint: tradeMarketFingerprint(market),
    orderAssetId: market.orderAssetId,
    family: market.family,
    lifecycle: market.lifecycle,
    orderAvailability: market.orderAvailability,
    sizeDecimals: market.sizeDecimals,
    pricePrecision: market.pricePrecision,
    ...(market.family === "perp"
      ? {
          maxLeverage: market.maxLeverage,
          onlyIsolated: market.onlyIsolated,
        }
      : {}),
    referencePrice: referencePrice as DecimalString,
  };
}

export async function refreshReviewedOrder(input: {
  readonly review: ActionReviewSnapshot;
  readonly clock: TestnetServerClock;
  readonly readCurrentContext: () => CurrentActionContext;
  readonly client?: HyperliquidClient;
  readonly now?: () => number;
}): Promise<TradingActionValidationInput> {
  const { review } = input;
  assertTestnetSigningCapability(review.binding.network);
  if (
    review.validated.intent.type !== "market_order" &&
    review.validated.intent.type !== "limit_order"
  ) {
    throw new Error(
      "This development runtime currently submits reviewed market and limit orders only.",
    );
  }
  const client =
    input.client ??
    createHyperliquidClient({ network: "testnet", fetch: input.clock.fetch });
  if (client.network !== "testnet") {
    throw new Error("The authoritative refresh client must use testnet.");
  }
  const catalog = await client.getMarketCatalog({ scope: "core" });
  const markets = catalog.markets.filter(
    (market) => market.canonicalId === review.validated.marketCanonicalId,
  );
  if (markets.length !== 1) {
    throw new Error("The exact reviewed market is no longer authoritative.");
  }
  const market = markets[0];
  if (!market) {
    throw new Error("The exact reviewed market is unavailable.");
  }
  const account = await loadAccountSnapshot({
    client,
    target: accountTarget(review.binding),
    market,
  });
  const current = input.readCurrentContext();
  const currentBinding = bindingForContext(current.context);
  assertSignerBinding(review.binding, currentBinding);
  const nowMs = safeMilliseconds(
    (input.now ?? Date.now)(),
    "The refresh clock",
  );
  const accountVersion = sameReviewedAccount(review, market, account)
    ? review.validation.account.version
    : changedVersion(review.validation.account.version);
  return {
    context: {
      ...review.validation.context,
      currentContextEpoch: current.epoch,
      currentNetwork: current.context.network,
      currentMasterAccount: currentBinding.masterAccount,
      currentTargetAccount: currentBinding.targetAccount,
      nowMs,
    },
    market: refreshedMarketValidation(market),
    account: {
      availableMargin: account.availableFunds,
      ...(market.family === "spot"
        ? { leverage: 1 }
        : account.leverage === null
          ? {}
          : { leverage: account.leverage }),
      ...(market.family === "perp" && account.marginMode !== null
        ? { marginMode: account.marginMode }
        : {}),
      positionSize: account.positionSize,
      version: accountVersion,
    },
    controls: review.validation.controls,
    intent: review.validation.intent,
  };
}
