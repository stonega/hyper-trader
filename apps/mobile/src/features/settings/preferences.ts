import type { HyperliquidNetwork } from "@hyper-trader/hyperliquid/public";

import {
  accountPreferenceKey,
  type SavedAccountTarget,
} from "../accounts/account-scope";

export type DefaultChartRange = "24h" | "7d" | "30d" | "all";

export interface ScopedTradingPreferences {
  readonly version: 1;
  readonly defaultOrderType: "market" | "limit";
  readonly defaultSlippageBps: number;
  readonly defaultChartRange: DefaultChartRange;
}

export const DEFAULT_SCOPED_TRADING_PREFERENCES: ScopedTradingPreferences = {
  version: 1,
  defaultOrderType: "market",
  defaultSlippageBps: 50,
  defaultChartRange: "24h",
};

export interface TradingPreferenceScope {
  readonly network: HyperliquidNetwork;
  readonly masterAccount: string;
  readonly target: SavedAccountTarget;
}

export function preferenceStorageKey(scope: TradingPreferenceScope): string {
  return accountPreferenceKey(scope);
}

export function updateScopedTradingPreferences(
  current: ScopedTradingPreferences,
  patch: Partial<
    Pick<
      ScopedTradingPreferences,
      "defaultOrderType" | "defaultSlippageBps" | "defaultChartRange"
    >
  >,
): ScopedTradingPreferences {
  const next = { ...current, ...patch, version: 1 as const };
  if (next.defaultOrderType !== "market" && next.defaultOrderType !== "limit") {
    throw new TypeError("The default order type is unsupported.");
  }
  if (
    !Number.isSafeInteger(next.defaultSlippageBps) ||
    next.defaultSlippageBps < 0 ||
    next.defaultSlippageBps > 500
  ) {
    throw new TypeError("Default slippage must be between 0 and 500 bps.");
  }
  if (!["24h", "7d", "30d", "all"].includes(next.defaultChartRange)) {
    throw new TypeError("The default chart range is unsupported.");
  }
  return next;
}

export function resetScopedTradingPreferences(): ScopedTradingPreferences {
  return { ...DEFAULT_SCOPED_TRADING_PREFERENCES };
}

export function parseScopedTradingPreferences(
  value: string | null,
): ScopedTradingPreferences {
  if (value === null) return resetScopedTradingPreferences();
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (parsed.version !== 1) throw new TypeError("Unsupported version.");
    return updateScopedTradingPreferences(DEFAULT_SCOPED_TRADING_PREFERENCES, {
      defaultOrderType: parsed.defaultOrderType as "market" | "limit",
      defaultSlippageBps: parsed.defaultSlippageBps as number,
      defaultChartRange: parsed.defaultChartRange as DefaultChartRange,
    });
  } catch {
    return resetScopedTradingPreferences();
  }
}
