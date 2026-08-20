import {
  type AccountTarget,
  createHyperliquidClient,
} from "@hyper-trader/hyperliquid";
import type { Market } from "@hyper-trader/hyperliquid/public";
import { useQuery } from "@tanstack/react-query";
import { useIsFocused } from "expo-router";

import type { NormalizedTradingContext } from "../../core/context/supervisor";
import { queryKeys } from "../../core/query/keys";
import {
  tradePerpAccountSnapshot,
  tradeSpotAccountSnapshot,
} from "./trade-account-snapshot";
import type { TradeAccountSnapshot } from "./trade-model";

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

async function loadTradeAccountSnapshot(input: {
  readonly context: NormalizedTradingContext;
  readonly target: AccountTarget;
  readonly market: Market;
  readonly signal: AbortSignal;
}): Promise<TradeAccountSnapshot | null> {
  const client = createHyperliquidClient({ network: input.context.network });
  if (input.market.family === "perp") {
    const [result, activeAsset] = await Promise.all([
      client.accounts.getClearinghouseState(
        input.target,
        input.market.dexName,
        { signal: input.signal },
      ),
      client.accounts.getActiveAssetData(input.target, input.market.coin, {
        signal: input.signal,
      }),
    ]);
    return tradePerpAccountSnapshot({
      state: result.data,
      activeAsset: activeAsset.data,
      market: input.market,
      observedAtMs: Date.now(),
    });
  }
  if (input.market.family === "spot") {
    const result = await client.accounts.getSpotClearinghouseState(
      input.target,
      { signal: input.signal },
    );
    return tradeSpotAccountSnapshot({
      state: result.data,
      market: input.market,
      observedAtMs: Date.now(),
    });
  }
  return null;
}

export function useTradeAccountSnapshot(
  context: NormalizedTradingContext,
  target: AccountTarget | null,
  market: Market | null,
) {
  const isFocused = useIsFocused();
  return useQuery<TradeAccountSnapshot | null>({
    queryKey: [
      ...queryKeys.private.accountSnapshot(context),
      "trade-order-entry",
      target === null ? null : accountTargetKey(target),
      market === null ? null : marketAccountKey(market),
    ],
    enabled: target !== null && market !== null && market.family !== "outcome",
    queryFn: ({ signal }) => {
      if (target === null || market === null) {
        throw new Error("An exact account target and market are required.");
      }
      return loadTradeAccountSnapshot({ context, target, market, signal });
    },
    refetchInterval: 20_000,
    staleTime: 15_000,
    subscribed: isFocused,
  });
}
