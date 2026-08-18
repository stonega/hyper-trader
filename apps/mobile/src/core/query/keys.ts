import type {
  CandleInterval,
  HyperliquidNetwork,
} from "@hyper-trader/hyperliquid/public";

import {
  normalizeTradingContext,
  type TradingContextCore,
} from "../context/supervisor";

export type PublicQueryFamily =
  | "marketCatalog"
  | "midPrices"
  | "marketContext"
  | "candles"
  | "l2Book"
  | "recentTrades";

export type PrivateQueryFamily =
  | "accountSnapshot"
  | "clearinghouseState"
  | "openOrders"
  | "orderHistory"
  | "fills"
  | "funding"
  | "portfolio";

function normalizeOwner(context: TradingContextCore) {
  const normalized = normalizeTradingContext(context);
  return [
    normalized.network,
    normalized.masterAccount,
    normalized.targetAccount,
  ] as const;
}

const publicKey = (
  network: HyperliquidNetwork,
  family: PublicQueryFamily,
  ...parts: readonly unknown[]
) => ["public", network, family, ...parts] as const;

const privateKey = (
  context: TradingContextCore,
  family: PrivateQueryFamily,
  ...parts: readonly unknown[]
) => ["private", ...normalizeOwner(context), family, ...parts] as const;

export const queryKeys = {
  public: {
    marketCatalog: (network: HyperliquidNetwork) =>
      publicKey(network, "marketCatalog"),
    midPrices: (network: HyperliquidNetwork, dex?: string) =>
      publicKey(network, "midPrices", dex ?? null),
    marketContext: (network: HyperliquidNetwork, canonicalId: string) =>
      publicKey(network, "marketContext", canonicalId),
    candles: (
      network: HyperliquidNetwork,
      canonicalId: string,
      interval: CandleInterval,
    ) => publicKey(network, "candles", canonicalId, interval),
    l2Book: (network: HyperliquidNetwork, canonicalId: string) =>
      publicKey(network, "l2Book", canonicalId),
    recentTrades: (network: HyperliquidNetwork, canonicalId: string) =>
      publicKey(network, "recentTrades", canonicalId),
  },
  private: {
    accountSnapshot: (context: TradingContextCore) =>
      privateKey(context, "accountSnapshot"),
    clearinghouseState: (context: TradingContextCore, dex: string) =>
      privateKey(context, "clearinghouseState", dex),
    openOrders: (context: TradingContextCore, dex: string) =>
      privateKey(context, "openOrders", dex),
    orderHistory: (context: TradingContextCore) =>
      privateKey(context, "orderHistory"),
    fills: (context: TradingContextCore) => privateKey(context, "fills"),
    funding: (context: TradingContextCore) => privateKey(context, "funding"),
    portfolio: (context: TradingContextCore, period: string) =>
      privateKey(context, "portfolio", period),
  },
} as const;

export function isPublicQueryKey(key: readonly unknown[]): boolean {
  return key[0] === "public";
}

export function isPrivateQueryKey(key: readonly unknown[]): boolean {
  return key[0] === "private";
}

export function isPrivateQueryOwnedBy(
  key: readonly unknown[],
  context: TradingContextCore,
): boolean {
  const owner = normalizeOwner(context);
  return (
    isPrivateQueryKey(key) &&
    key[1] === owner[0] &&
    key[2] === owner[1] &&
    key[3] === owner[2]
  );
}
