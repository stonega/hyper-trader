import {
  type AccountTarget,
  assertSignerBinding,
  assertTradingActionCapability,
  type ClockGateInput,
  createHyperliquidClient,
  type FrontendOpenOrder,
  type HyperliquidClient,
  MINIMUM_ORDER_NOTIONAL,
  type OpenOrder,
  type SignerBinding,
  type TradingActionIntent,
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
import { aggressiveOrderPrice } from "./aggressive-order-price";
import type { ActionReviewSnapshot } from "./orchestrator";

export interface AuthoritativeServerClock {
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

export function createAuthoritativeServerClock(
  options: {
    readonly fetch?: typeof globalThis.fetch;
    readonly wallNow?: () => number;
    readonly monotonicNow?: () => number;
  } = {},
): AuthoritativeServerClock {
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
    context.masterAccount === null ||
    context.targetAccount === null ||
    context.signer === null
  ) {
    throw new Error("The exact signing context is unavailable.");
  }
  return {
    network: context.network,
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
    const [state, activeAsset] = await Promise.all([
      input.client.accounts.getClearinghouseState(
        input.target,
        input.market.dexName,
      ),
      input.client.accounts.getActiveAssetData(input.target, input.market.coin),
    ]);
    const snapshot = tradePerpAccountSnapshot({
      state: state.data,
      activeAsset: activeAsset.data,
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
  // Available margin moves with mark price and funding. The caller validates
  // the freshly fetched value for buying power, so it is not an identity fence.
  return (
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
    minimumNotional: MINIMUM_ORDER_NOTIONAL,
  };
}

function refreshedOrderIntent(
  review: ActionReviewSnapshot,
  market: TradingActionValidationInput["market"],
): TradingActionIntent {
  const intent = review.validated.intent;
  if (intent.type !== "market_order" && intent.type !== "reduce_only_close") {
    return intent;
  }
  const slippageBps = review.validation.controls.slippageBps;
  const referencePrice = market.referencePrice;
  if (
    slippageBps === null ||
    market.pricePrecision === null ||
    typeof referencePrice !== "string"
  ) {
    throw new Error(
      "Current slippage and price precision are required for a market order.",
    );
  }
  return {
    ...intent,
    aggressiveLimitPrice: aggressiveOrderPrice({
      referencePrice,
      side: intent.side,
      slippageBps,
      precision: market.pricePrecision,
    }),
  };
}

function catalogScopeForReview(
  review: ActionReviewSnapshot,
): "complete" | "native" | "spot" {
  if (review.validation.market.family === "spot") return "spot";
  if (
    review.validated.intent.type === "cancel" &&
    !review.validated.marketCanonicalId.startsWith("perp:0:")
  ) {
    return "complete";
  }
  return "native";
}

function cancelOpenOrderEvidence(input: {
  readonly review: ActionReviewSnapshot;
  readonly market: Market;
  readonly openOrders: readonly OpenOrder[];
}): NonNullable<TradingActionValidationInput["account"]["openOrders"]> {
  const intent = input.review.validated.intent;
  if (intent.type !== "cancel") return [];
  if (intent.target.kind !== "oid") {
    throw new Error(
      "Current exact open-order evidence for client order ID cancellation is unavailable.",
    );
  }
  const targetOid = intent.target.oid;
  const matches = input.openOrders.filter(
    (order) => order.coin === input.market.coin && order.oid === targetOid,
  );
  if (matches.length === 0) {
    throw Object.assign(new Error("The reviewed order is no longer open."), {
      code: "cancel_target_not_open",
    });
  }
  if (matches.length !== 1) {
    throw new Error("The reviewed open-order evidence is ambiguous.");
  }
  return [{ assetId: input.market.orderAssetId, oid: targetOid }];
}

function positionTpslOpenOrderEvidence(input: {
  readonly review: ActionReviewSnapshot;
  readonly market: Market;
  readonly openOrders: readonly FrontendOpenOrder[];
}): NonNullable<TradingActionValidationInput["account"]["openOrders"]> {
  const intent = input.review.validated.intent;
  if (intent.type !== "position_tpsl" || intent.existingOid === null) {
    return [];
  }
  const expectedOrderType =
    intent.triggerKind === "take_profit" ? "Take Profit" : "Stop";
  const expectedSide = intent.side === "buy" ? "B" : "A";
  const matches = input.openOrders.filter(
    (order) =>
      order.coin === input.market.coin &&
      order.oid === intent.existingOid &&
      order.side === expectedSide &&
      order.isPositionTpsl &&
      order.isTrigger &&
      order.reduceOnly &&
      order.orderType.startsWith(expectedOrderType),
  );
  if (matches.length === 0) {
    throw Object.assign(new Error("The protective order is no longer open."), {
      code: "position_tpsl_target_not_open",
    });
  }
  if (matches.length !== 1) {
    throw new Error("The protective-order evidence is ambiguous.");
  }
  return [{ assetId: input.market.orderAssetId, oid: intent.existingOid }];
}

export async function refreshReviewedOrder(input: {
  readonly review: ActionReviewSnapshot;
  readonly clock: AuthoritativeServerClock;
  readonly readCurrentContext: () => CurrentActionContext;
  readonly client?: HyperliquidClient;
  readonly now?: () => number;
}): Promise<TradingActionValidationInput> {
  const { review } = input;
  assertTradingActionCapability(review.binding.network);
  if (
    review.validated.intent.type !== "market_order" &&
    review.validated.intent.type !== "limit_order" &&
    review.validated.intent.type !== "reduce_only_close" &&
    review.validated.intent.type !== "position_tpsl" &&
    review.validated.intent.type !== "cancel"
  ) {
    throw new Error(
      "This runtime currently submits reviewed market, limit, protective, full reduce-only close, and order cancellation actions only.",
    );
  }
  const client =
    input.client ??
    createHyperliquidClient({
      network: review.binding.network,
      fetch: input.clock.fetch,
    });
  if (client.network !== review.binding.network) {
    throw new Error(
      "The authoritative refresh client must match the review network.",
    );
  }
  const catalog = await client.getMarketCatalog({
    scope: catalogScopeForReview(review),
  });
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
  const target = accountTarget(review.binding);
  const intent = review.validated.intent;
  let refreshedAccount: TradingActionValidationInput["account"];
  if (intent.type === "cancel") {
    refreshedAccount = {
      availableMargin: review.validation.account.availableMargin,
      version: review.validation.account.version,
      openOrders: cancelOpenOrderEvidence({
        review,
        market,
        openOrders: (
          await client.accounts.getOpenOrders(
            target,
            market.family === "perp" ? market.dexName : "",
          )
        ).data,
      }),
    };
  } else {
    const [account, positionTpslOrders] = await Promise.all([
      loadAccountSnapshot({ client, target, market }),
      intent.type === "position_tpsl" && intent.existingOid !== null
        ? client.accounts
            .getFrontendOpenOrders(
              target,
              market.family === "perp" ? market.dexName : "",
            )
            .then(({ data }) => data)
        : Promise.resolve([]),
    ]);
    const accountVersion = sameReviewedAccount(review, market, account)
      ? review.validation.account.version
      : changedVersion(review.validation.account.version);
    refreshedAccount = {
      availableMargin: account.availableFunds[intent.side],
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
      ...(intent.type === "position_tpsl" && intent.existingOid !== null
        ? {
            openOrders: positionTpslOpenOrderEvidence({
              review,
              market,
              openOrders: positionTpslOrders,
            }),
          }
        : {}),
    };
  }
  const current = input.readCurrentContext();
  const currentBinding = bindingForContext(current.context);
  assertSignerBinding(review.binding, currentBinding);
  const nowMs = safeMilliseconds(
    (input.now ?? Date.now)(),
    "The refresh clock",
  );
  const marketValidation = refreshedMarketValidation(market);
  return {
    context: {
      ...review.validation.context,
      currentContextEpoch: current.epoch,
      currentNetwork: current.context.network,
      currentMasterAccount: currentBinding.masterAccount,
      currentTargetAccount: currentBinding.targetAccount,
      nowMs,
    },
    market: marketValidation,
    account: refreshedAccount,
    controls: review.validation.controls,
    intent: refreshedOrderIntent(review, marketValidation),
  };
}

/** @deprecated Use AuthoritativeServerClock. */
export type TestnetServerClock = AuthoritativeServerClock;

/** @deprecated Use createAuthoritativeServerClock. */
export const createTestnetServerClock = createAuthoritativeServerClock;
