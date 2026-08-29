import type {
  AccountTarget,
  Cloid,
  TradingActionIntent,
  TradingActionValidationInput,
} from "@hyper-trader/hyperliquid";
import type { DecimalString, Market } from "@hyper-trader/hyperliquid/public";

import { marketMetadataFingerprint } from "../../core/actions/metadata-fingerprint";
import type { NormalizedTradingContext } from "../../core/context/supervisor";
import {
  type ActionReviewSnapshot,
  createActionReview,
} from "../actions/orchestrator";
import { marketPairLabel } from "../markets/discovery";
import { signerBindingForTradeContext } from "../trade/trade-model";
import {
  buildCancelIntent,
  buildCloseIntent,
  buildLeverageIntent,
  buildPositionTpslIntent,
  type CloseDraft,
  type NormalizedPortfolio,
  type PortfolioOpenOrderRow,
  type PortfolioPositionRow,
  type PositionTpslDraft,
  portfolioMarketClosePrice,
  portfolioOwnerKey,
} from "./portfolio-model";

const REVIEW_WINDOW_MS = 30_000;
const ACCOUNT_FRESHNESS_WINDOW_MS = 30_000;

function targetMasterAddress(target: AccountTarget): string | null {
  return target.kind === "master" ? null : (target.masterAddress ?? null);
}

function assertPortfolioReviewOwner(input: {
  readonly portfolio: NormalizedPortfolio;
  readonly context: NormalizedTradingContext;
  readonly target: AccountTarget;
  readonly nowMs: number;
}): void {
  if (
    !Number.isSafeInteger(input.nowMs) ||
    input.nowMs < 0 ||
    !Number.isSafeInteger(input.portfolio.observedAtMs) ||
    input.portfolio.observedAtMs < 0 ||
    input.portfolio.observedAtMs > input.nowMs + 5_000 ||
    input.nowMs - input.portfolio.observedAtMs > ACCOUNT_FRESHNESS_WINDOW_MS
  ) {
    throw new Error(
      "This account snapshot is no longer current. Refresh Portfolio and try again.",
    );
  }
  if (
    input.context.masterAccount === null ||
    input.context.targetAccount === null
  ) {
    throw new Error("Connect the exact account before opening review.");
  }
  const expectedOwner = {
    network: input.context.network,
    masterAccount: input.context.masterAccount,
    target: input.target,
  } as const;
  const expectedKey = portfolioOwnerKey(expectedOwner);
  if (
    input.portfolio.ownerKey !== expectedKey ||
    portfolioOwnerKey(input.portfolio.owner) !== expectedKey ||
    input.target.address.trim().toLowerCase() !== input.context.targetAccount ||
    (input.target.kind === "master" &&
      input.target.address.trim().toLowerCase() !==
        input.context.masterAccount) ||
    (input.target.kind !== "master" &&
      targetMasterAddress(input.target)?.trim().toLowerCase() !==
        input.context.masterAccount)
  ) {
    throw new Error(
      "This Portfolio snapshot does not belong to the active account and target.",
    );
  }
}

function currentPosition(
  portfolio: NormalizedPortfolio,
  candidate: PortfolioPositionRow,
): PortfolioPositionRow {
  const current = portfolio.positions.find((row) => row.id === candidate.id);
  if (current === undefined) {
    throw new Error("This position is no longer present. Refresh Portfolio.");
  }
  if (current !== candidate) {
    throw new Error(
      "This position changed since this snapshot. Reopen the position action.",
    );
  }
  return current;
}

function currentOrder(
  portfolio: NormalizedPortfolio,
  candidate: PortfolioOpenOrderRow,
): PortfolioOpenOrderRow {
  const current = portfolio.openOrders.find((row) => row.id === candidate.id);
  if (current === undefined) {
    throw new Error("This order is no longer open. Refresh Portfolio.");
  }
  if (current !== candidate) {
    throw new Error(
      "This order changed since this snapshot. Reopen the order action.",
    );
  }
  return current;
}

function positionScopeFields(position: PortfolioPositionRow) {
  return [
    position.id,
    position.canonicalMarketId,
    position.venue,
    position.coin,
    position.size,
    position.absoluteSize,
    position.side,
    position.entryPrice,
    position.liquidationPrice,
    position.positionValue,
    position.unrealizedPnl,
    position.returnOnEquity,
    position.leverage,
    position.marginMode,
    position.maxLeverage,
    position.onlyIsolated,
    position.availableMargin,
    position.accountVersion,
    position.actionsEnabled,
    position.closeEnabled,
    position.marginActionEnabled,
    position.protectionEnabled,
    position.takeProfit?.oid ?? null,
    position.takeProfit?.triggerPrice ?? null,
    position.stopLoss?.oid ?? null,
    position.stopLoss?.triggerPrice ?? null,
  ] as const;
}

export function portfolioCloseScopeKey(input: {
  readonly portfolio: NormalizedPortfolio;
  readonly position: PortfolioPositionRow;
  readonly draft: CloseDraft;
  readonly context: NormalizedTradingContext;
  readonly target: AccountTarget;
}): string {
  const market = input.position.market;
  return JSON.stringify([
    input.portfolio.ownerKey,
    input.portfolio.version,
    input.portfolio.observedAtMs,
    input.context.network,
    input.context.masterAccount,
    input.context.targetAccount,
    input.context.signer?.agentAddress ?? null,
    input.context.signer?.generation ?? null,
    input.target.kind,
    input.target.address,
    targetMasterAddress(input.target),
    market === null ? null : marketRules(market).metadataFingerprint,
    market?.midPx ?? market?.markPx ?? null,
    ...positionScopeFields(input.position),
    input.draft.positionId,
    input.draft.behavior,
    input.draft.size,
    input.draft.limitPrice,
    input.draft.timeInForce,
    input.draft.slippageBps,
  ]);
}

export function portfolioPositionTpslScopeKey(input: {
  readonly portfolio: NormalizedPortfolio;
  readonly position: PortfolioPositionRow;
  readonly draft: PositionTpslDraft;
  readonly context: NormalizedTradingContext;
  readonly target: AccountTarget;
}): string {
  const market = input.position.market;
  return JSON.stringify([
    input.portfolio.ownerKey,
    input.portfolio.version,
    input.portfolio.observedAtMs,
    input.context.network,
    input.context.masterAccount,
    input.context.targetAccount,
    input.context.signer?.agentAddress ?? null,
    input.context.signer?.generation ?? null,
    input.target.kind,
    input.target.address,
    targetMasterAddress(input.target),
    market === null ? null : marketRules(market).metadataFingerprint,
    market?.midPx ?? market?.markPx ?? null,
    ...positionScopeFields(input.position),
    input.draft.positionId,
    input.draft.kind,
    input.draft.triggerPrice,
    input.draft.existingOid,
  ]);
}

function marketRules(market: Market) {
  return {
    canonicalId: market.canonicalId,
    metadataFingerprint: marketMetadataFingerprint({
      canonicalId: market.canonicalId,
      orderAssetId: market.orderAssetId,
      family: market.family,
      pricePrecision: market.pricePrecision,
      sizeDecimals: market.sizeDecimals,
      ...(market.family === "perp"
        ? {
            maxLeverage: market.maxLeverage,
            onlyIsolated: market.onlyIsolated,
            marginMode: market.marginMode,
            marginTableId: market.marginTableId,
          }
        : {}),
      lifecycle: market.lifecycle,
      orderAvailability: market.orderAvailability,
    }),
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
    referencePrice: (market.midPx ??
      market.markPx ??
      null) as DecimalString | null,
  } as const;
}

function validationContext(
  context: NormalizedTradingContext,
  capturedContextEpoch: number,
  nowMs: number,
) {
  const binding = signerBindingForTradeContext(context);
  return {
    binding,
    context: {
      network: binding.network,
      masterAccount: binding.masterAccount,
      targetAccount: binding.targetAccount,
      capturedContextEpoch,
      currentContextEpoch: capturedContextEpoch,
      currentNetwork: binding.network,
      currentMasterAccount: binding.masterAccount,
      currentTargetAccount: binding.targetAccount,
      reviewedAtMs: nowMs,
      reviewExpiresAtMs: nowMs + REVIEW_WINDOW_MS,
      nowMs,
    },
  } as const;
}

function review(input: {
  readonly context: NormalizedTradingContext;
  readonly capturedContextEpoch: number;
  readonly nowMs: number;
  readonly market: Market;
  readonly account: TradingActionValidationInput["account"];
  readonly intent: TradingActionIntent;
  readonly slippageBps: number | null;
  readonly trigger: TradingActionValidationInput["controls"]["trigger"];
}): ActionReviewSnapshot {
  const scoped = validationContext(
    input.context,
    input.capturedContextEpoch,
    input.nowMs,
  );
  return createActionReview({
    binding: scoped.binding,
    capturedContextEpoch: input.capturedContextEpoch,
    marketLabel: marketPairLabel(input.market),
    validation: {
      context: scoped.context,
      market: marketRules(input.market),
      account: input.account,
      controls: { slippageBps: input.slippageBps, trigger: input.trigger },
      intent: input.intent,
    },
  });
}

export function buildPortfolioCancelReview(input: {
  readonly portfolio: NormalizedPortfolio;
  readonly order: PortfolioOpenOrderRow;
  readonly target: AccountTarget;
  readonly context: NormalizedTradingContext;
  readonly capturedContextEpoch: number;
  readonly nowMs: number;
}): ActionReviewSnapshot {
  assertPortfolioReviewOwner(input);
  const order = currentOrder(input.portfolio, input.order);
  if (order.market === null) {
    throw new Error("Current validated market metadata is required.");
  }
  return review({
    context: input.context,
    capturedContextEpoch: input.capturedContextEpoch,
    nowMs: input.nowMs,
    market: order.market,
    intent: buildCancelIntent(order),
    slippageBps: null,
    trigger: null,
    account: {
      availableMargin: order.availableMargin,
      version: order.accountVersion,
      openOrders: input.portfolio.openOrders.flatMap((order) =>
        order.market === null
          ? []
          : [{ assetId: order.market.orderAssetId, oid: order.oid }],
      ),
    },
  });
}

export function buildPortfolioCloseReview(input: {
  readonly portfolio: NormalizedPortfolio;
  readonly position: PortfolioPositionRow;
  readonly draft: CloseDraft;
  readonly cloid: Cloid;
  readonly target: AccountTarget;
  readonly context: NormalizedTradingContext;
  readonly capturedContextEpoch: number;
  readonly nowMs: number;
}): ActionReviewSnapshot {
  assertPortfolioReviewOwner(input);
  const position = currentPosition(input.portfolio, input.position);
  if (position.market === null || position.market.family !== "perp") {
    throw new Error("Current validated market metadata is required.");
  }
  const side = position.side === "long" ? "sell" : "buy";
  const slippageBps =
    input.draft.behavior === "market" ? Number(input.draft.slippageBps) : null;
  const intent = buildCloseIntent(input.draft, position, {
    cloid: input.cloid,
    aggressiveLimitPrice:
      input.draft.behavior === "market"
        ? portfolioMarketClosePrice({
            market: position.market,
            side,
            slippageBps: input.draft.slippageBps,
          })
        : (position.market.midPx ?? position.market.markPx ?? "1"),
  });
  return review({
    context: input.context,
    capturedContextEpoch: input.capturedContextEpoch,
    nowMs: input.nowMs,
    market: position.market,
    intent,
    slippageBps,
    trigger: null,
    account: {
      availableMargin: position.availableMargin,
      leverage: position.leverage,
      ...(position.marginMode === null
        ? {}
        : { marginMode: position.marginMode }),
      positionSize: position.size,
      version: position.accountVersion,
    },
  });
}

export function buildPortfolioPositionTpslReview(input: {
  readonly portfolio: NormalizedPortfolio;
  readonly position: PortfolioPositionRow;
  readonly draft: PositionTpslDraft;
  readonly cloid: Cloid;
  readonly target: AccountTarget;
  readonly context: NormalizedTradingContext;
  readonly capturedContextEpoch: number;
  readonly nowMs: number;
}): ActionReviewSnapshot {
  assertPortfolioReviewOwner(input);
  const position = currentPosition(input.portfolio, input.position);
  if (position.market === null || position.market.family !== "perp") {
    throw new Error("Current validated market metadata is required.");
  }
  const intent = buildPositionTpslIntent(input.draft, position, input.cloid);
  const direction =
    position.side === "long"
      ? input.draft.kind === "take_profit"
        ? "above"
        : "below"
      : input.draft.kind === "take_profit"
        ? "below"
        : "above";
  return review({
    context: input.context,
    capturedContextEpoch: input.capturedContextEpoch,
    nowMs: input.nowMs,
    market: position.market,
    intent,
    slippageBps: 500,
    trigger: { price: intent.triggerPrice, direction },
    account: {
      availableMargin: position.availableMargin,
      leverage: position.leverage,
      ...(position.marginMode === null
        ? {}
        : { marginMode: position.marginMode }),
      positionSize: position.size,
      version: position.accountVersion,
      ...(input.draft.existingOid === null
        ? {}
        : {
            openOrders: [
              {
                assetId: position.market.orderAssetId,
                oid: input.draft.existingOid,
              },
            ],
          }),
    },
  });
}

export function buildPortfolioLeverageReview(input: {
  readonly portfolio: NormalizedPortfolio;
  readonly position: PortfolioPositionRow;
  readonly leverage: number;
  readonly marginMode: "cross" | "isolated";
  readonly target: AccountTarget;
  readonly context: NormalizedTradingContext;
  readonly capturedContextEpoch: number;
  readonly nowMs: number;
}): ActionReviewSnapshot {
  assertPortfolioReviewOwner(input);
  const position = currentPosition(input.portfolio, input.position);
  if (position.market === null) {
    throw new Error("Current validated market metadata is required.");
  }
  return review({
    context: input.context,
    capturedContextEpoch: input.capturedContextEpoch,
    nowMs: input.nowMs,
    market: position.market,
    intent: buildLeverageIntent(position, input.leverage, input.marginMode),
    slippageBps: null,
    trigger: null,
    account: {
      availableMargin: position.availableMargin,
      leverage: position.leverage,
      ...(position.marginMode === null
        ? {}
        : { marginMode: position.marginMode }),
      positionSize: position.size,
      version: position.accountVersion,
    },
  });
}
