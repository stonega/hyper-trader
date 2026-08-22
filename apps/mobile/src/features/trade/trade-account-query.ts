import {
  type AccountTarget,
  createHyperliquidClient,
  type FrontendOpenOrder,
} from "@hyper-trader/hyperliquid";
import type { Market } from "@hyper-trader/hyperliquid/public";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useIsFocused } from "expo-router";
import { useEffect, useMemo } from "react";

import type { NormalizedTradingContext } from "../../core/context/supervisor";
import { createCoalescedTask } from "../../core/query/coalesced-task";
import {
  ACCOUNT_EVENT_COALESCE_MS,
  mobileDataPolicies,
} from "../../core/query/data-policies";
import { queryKeys } from "../../core/query/keys";
import {
  accountEventStreamKey,
  createAccountEventWire,
} from "../../core/streams/account-events";
import { useStreamRuntime } from "../../core/streams/provider";
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
  const queryClient = useQueryClient();
  const streams = useStreamRuntime();
  const targetIdentity = target === null ? null : accountTargetKey(target);
  const marketIdentity = market === null ? null : marketAccountKey(market);
  const eventUser = target?.address.trim().toLowerCase() ?? null;
  const eventChannel =
    market?.family === "perp"
      ? ("allDexsClearinghouseState" as const)
      : market?.family === "spot"
        ? ("userEvents" as const)
        : null;
  const orderDex = market?.family === "perp" ? market.dexName : "";
  const openOrdersQueryPrefix = useMemo(
    () => queryKeys.private.openOrders(context, orderDex),
    [context, orderDex],
  );
  const queryKey = useMemo(
    () => [
      ...queryKeys.private.accountSnapshot(context),
      "trade-order-entry",
      targetIdentity,
      marketIdentity,
    ],
    [context, marketIdentity, targetIdentity],
  );
  const enabled =
    target !== null && market !== null && market.family !== "outcome";
  const query = useQuery<TradeAccountSnapshot | null>({
    queryKey,
    enabled,
    queryFn: ({ signal }) => {
      if (target === null || market === null) {
        throw new Error("An exact account target and market are required.");
      }
      return loadTradeAccountSnapshot({
        context,
        target,
        market,
        signal,
      });
    },
    refetchOnMount: "always",
    staleTime: mobileDataPolicies.tradeAccount.staleTimeMs,
    subscribed: isFocused,
  });
  useEffect(() => {
    if (!enabled || !isFocused || eventUser === null || eventChannel === null)
      return;
    const key = accountEventStreamKey(context.network, eventUser, eventChannel);
    let active = true;
    const invalidation = createCoalescedTask(() => {
      if (!active) return;
      void Promise.all([
        queryClient.invalidateQueries(
          {
            queryKey,
            exact: true,
            refetchType: "active",
          },
          { cancelRefetch: false },
        ),
        queryClient.invalidateQueries(
          {
            queryKey: openOrdersQueryPrefix,
            refetchType: "active",
          },
          { cancelRefetch: false },
        ),
      ]);
    }, ACCOUNT_EVENT_COALESCE_MS);
    const cleanup = streams.declare({
      wire: createAccountEventWire(key, eventUser, eventChannel),
      loadBaseline: async () => ({ data: null }),
      applyBaseline: () => undefined,
      applyDelta: invalidation.schedule,
    });
    return () => {
      active = false;
      invalidation.cancel();
      cleanup();
    };
  }, [
    context.network,
    enabled,
    eventChannel,
    eventUser,
    isFocused,
    openOrdersQueryPrefix,
    queryClient,
    queryKey,
    streams,
  ]);
  return query;
}

export function useTradeOpenOrders(
  context: NormalizedTradingContext,
  target: AccountTarget | null,
  market: Market | null,
) {
  const isFocused = useIsFocused();
  const client = useMemo(
    () => createHyperliquidClient({ network: context.network }),
    [context.network],
  );
  const targetIdentity = target === null ? null : accountTargetKey(target);
  const marketIdentity = market === null ? null : marketAccountKey(market);
  const dex = market?.family === "perp" ? market.dexName : "";
  const queryKey = useMemo(
    () => [
      ...queryKeys.private.openOrders(context, dex),
      "trade-chart",
      targetIdentity,
      marketIdentity,
    ],
    [context, dex, marketIdentity, targetIdentity],
  );
  return useQuery<readonly FrontendOpenOrder[]>({
    queryKey,
    enabled: target !== null && market !== null && market.family !== "outcome",
    queryFn: async ({ signal }) => {
      if (target === null || market === null) {
        throw new Error("An exact account target and market are required.");
      }
      const result = await client.accounts.getFrontendOpenOrders(target, dex, {
        signal,
      });
      return result.data.filter((order) => order.coin === market.coin);
    },
    refetchOnMount: "always",
    staleTime: mobileDataPolicies.tradeAccount.staleTimeMs,
    subscribed: isFocused,
  });
}
