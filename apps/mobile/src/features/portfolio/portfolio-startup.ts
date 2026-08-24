import type { AccountTarget } from "@hyper-trader/hyperliquid";
import type { MarketCatalog } from "@hyper-trader/hyperliquid/public";

import type { NormalizedTradingContext } from "../../core/context/supervisor";
import { accountTargetIdentityKey } from "./portfolio-model";

interface PortfolioStartupSteps {
  readonly catalog: () => Promise<MarketCatalog>;
  readonly account: (catalog: MarketCatalog) => Promise<unknown>;
  readonly history: (catalog: MarketCatalog) => Promise<unknown>;
}

export async function runPortfolioStartupLoad(
  steps: PortfolioStartupSteps,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  const catalog = await steps.catalog();
  if (!isCurrent()) return;
  await steps.account(catalog);
  if (!isCurrent()) return;
  await steps.history(catalog);
}

export function portfolioStartupOwnerKey(
  context: NormalizedTradingContext,
  target: AccountTarget,
): string {
  return JSON.stringify([
    context.network,
    context.masterAccount,
    accountTargetIdentityKey(target),
  ]);
}
