export const INITIAL_TAB_ROUTE = "trade" as const;
export const TRADE_ROUTE = "/(tabs)/trade" as const;
export const ONBOARDING_ROUTE = "/onboarding" as const;
export const SETUP_ROUTE = "/setup" as const;

export function tradeMarketRoute(canonicalId: string) {
  return {
    pathname: TRADE_ROUTE,
    params: { market: canonicalId },
  } as const;
}
