import type { WelcomeChoice } from "./state";

export const INITIAL_TAB_ROUTE = "trade" as const;
export const TRADE_ROUTE = "/(tabs)/trade" as const;
export const SETUP_ROUTE = "/setup" as const;
export const WELCOME_ROUTE = "/welcome" as const;

export function welcomeChoiceRoute(choice: WelcomeChoice) {
  return choice === "setup" ? SETUP_ROUTE : TRADE_ROUTE;
}

export function tradeMarketRoute(canonicalId: string) {
  return {
    pathname: TRADE_ROUTE,
    params: { market: canonicalId },
  } as const;
}
