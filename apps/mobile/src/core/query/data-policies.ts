export type DataPersistence = "memory" | "public-device" | "secure";

export interface MobileDataPolicy {
  readonly scope: "network" | "market" | "account" | "installation";
  readonly baseline: "backend" | "hyperliquid-rest" | "local";
  readonly realtime:
    | "none"
    | "candle"
    | "activeAssetCtx"
    | "l2Book"
    | "trades"
    | "account-events";
  readonly persistence: DataPersistence;
  readonly staleTimeMs: number;
  readonly reconcileIntervalMs: number | false;
  readonly mayAuthorizeAction: boolean;
}

const SECOND = 1_000;
const MINUTE = 60 * SECOND;

export const ACCOUNT_EVENT_COALESCE_MS = 250;

/**
 * One auditable policy table for mobile server state. A displayed cached value
 * is never action authority: confirmation performs its own authoritative
 * refresh through the action orchestrator.
 */
export const mobileDataPolicies = {
  marketCatalog: {
    scope: "network",
    baseline: "backend",
    realtime: "none",
    persistence: "public-device",
    staleTimeMs: 2 * MINUTE,
    reconcileIntervalMs: 5 * MINUTE,
    mayAuthorizeAction: false,
  },
  candles: {
    scope: "market",
    baseline: "hyperliquid-rest",
    realtime: "candle",
    persistence: "memory",
    staleTimeMs: 15 * SECOND,
    reconcileIntervalMs: false,
    mayAuthorizeAction: false,
  },
  marketContext: {
    scope: "market",
    baseline: "backend",
    realtime: "activeAssetCtx",
    persistence: "memory",
    staleTimeMs: 15 * SECOND,
    reconcileIntervalMs: false,
    mayAuthorizeAction: false,
  },
  orderBook: {
    scope: "market",
    baseline: "hyperliquid-rest",
    realtime: "l2Book",
    persistence: "memory",
    staleTimeMs: 5 * SECOND,
    reconcileIntervalMs: false,
    mayAuthorizeAction: false,
  },
  recentTrades: {
    scope: "market",
    baseline: "hyperliquid-rest",
    realtime: "trades",
    persistence: "memory",
    staleTimeMs: 5 * SECOND,
    reconcileIntervalMs: false,
    mayAuthorizeAction: false,
  },
  tradeAccount: {
    scope: "account",
    baseline: "hyperliquid-rest",
    realtime: "account-events",
    persistence: "memory",
    staleTimeMs: 15 * SECOND,
    reconcileIntervalMs: false,
    mayAuthorizeAction: false,
  },
  portfolioLive: {
    scope: "account",
    baseline: "backend",
    realtime: "account-events",
    persistence: "memory",
    staleTimeMs: 15 * SECOND,
    reconcileIntervalMs: false,
    mayAuthorizeAction: false,
  },
  portfolioHistory: {
    scope: "account",
    baseline: "backend",
    realtime: "account-events",
    persistence: "memory",
    staleTimeMs: 5 * MINUTE,
    reconcileIntervalMs: false,
    mayAuthorizeAction: false,
  },
  localPreferences: {
    scope: "installation",
    baseline: "local",
    realtime: "none",
    persistence: "public-device",
    staleTimeMs: Number.POSITIVE_INFINITY,
    reconcileIntervalMs: false,
    mayAuthorizeAction: false,
  },
  signingState: {
    scope: "account",
    baseline: "local",
    realtime: "none",
    persistence: "secure",
    staleTimeMs: 0,
    reconcileIntervalMs: false,
    mayAuthorizeAction: true,
  },
} as const satisfies Readonly<Record<string, MobileDataPolicy>>;
