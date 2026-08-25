import type { AccountTarget } from "@hyper-trader/hyperliquid";
import type { Market } from "@hyper-trader/hyperliquid/public";

import type { NormalizedTradingContext } from "../../core/context/supervisor";
import { queryKeys } from "../../core/query/keys";

function accountTargetKey(target: AccountTarget): string {
  return JSON.stringify([
    target.kind,
    target.address.trim().toLowerCase(),
    target.kind === "master"
      ? null
      : (target.masterAddress?.trim().toLowerCase() ?? null),
  ]);
}

function marketAccountKey(market: Market): string {
  return JSON.stringify([
    market.canonicalId,
    market.family,
    market.coin,
    market.family === "perp" ? market.dexName : null,
    market.family === "spot" ? market.baseToken.index : null,
    market.family === "spot" ? market.quoteToken.index : null,
  ]);
}

export function tradeAccountSnapshotQueryKey(
  context: NormalizedTradingContext,
  target: AccountTarget | null,
  market: Market | null,
) {
  return [
    ...queryKeys.private.accountSnapshot(context),
    "trade-order-entry",
    target === null ? null : accountTargetKey(target),
    market === null ? null : marketAccountKey(market),
  ] as const;
}

export function tradeAccountQueryIsEnabled(
  target: AccountTarget | null,
  market: Market | null,
  isFocused: boolean,
): boolean {
  return (
    isFocused &&
    target !== null &&
    market !== null &&
    market.family !== "outcome"
  );
}

export { accountTargetKey, marketAccountKey };
