import type { MarketSummary } from "@hyper-trader/hyperliquid/public";

const MARKET_ICON_ORIGIN =
  "https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/128/color";

export function marketIconSymbol(market: MarketSummary): string | null {
  if (market.family === "spot") return market.baseToken.name;
  if (market.family === "perp") return market.displaySymbol;
  return null;
}

export function marketIconUri(market: MarketSummary): string | null {
  const symbol = marketIconSymbol(market);
  if (symbol === null || !/^[A-Za-z0-9]{1,16}$/.test(symbol)) return null;
  return `${MARKET_ICON_ORIGIN}/${symbol.toLowerCase()}.png`;
}
