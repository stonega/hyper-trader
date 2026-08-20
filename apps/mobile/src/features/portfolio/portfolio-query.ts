import {
  type AccountTarget,
  createAccountDataClient,
} from "@hyper-trader/hyperliquid";
import type { Market } from "@hyper-trader/hyperliquid/public";
import { onlineManager, useQuery } from "@tanstack/react-query";
import { useIsFocused } from "expo-router";
import { useMemo, useSyncExternalStore } from "react";

import type { NormalizedTradingContext } from "../../core/context/supervisor";
import { queryKeys } from "../../core/query/keys";
import {
  loadPortfolioAccountSnapshot,
  loadPortfolioHistorySnapshot,
  mergePortfolioSnapshots,
  type PortfolioAccountSnapshot,
  type PortfolioHistorySnapshot,
} from "./portfolio-loader";
import {
  type NormalizedPortfolio,
  normalizePortfolioSnapshot,
} from "./portfolio-model";
import {
  portfolioCatalogCacheKey,
  portfolioQueryKey,
} from "./portfolio-query-key";

export type PortfolioTargetResolution =
  | { readonly target: AccountTarget; readonly reason: null }
  | { readonly target: null; readonly reason: string };

export type PortfolioFreshness = "fresh" | "refreshing" | "stale" | "offline";

export function resolvePortfolioTarget(
  context: NormalizedTradingContext,
): PortfolioTargetResolution {
  if (context.masterAccount === null || context.targetAccount === null) {
    return {
      target: null,
      reason: "Connect an account to load private portfolio data.",
    };
  }
  if (context.masterAccount !== context.targetAccount) {
    return {
      target: null,
      reason:
        "The active target type is unavailable. Hyper Trader will not guess whether this address is a subaccount or vault.",
    };
  }
  return {
    target: { kind: "master", address: context.targetAccount },
    reason: null,
  };
}

function useOnlineStatus(): boolean {
  return useSyncExternalStore(
    (onStoreChange) => onlineManager.subscribe(onStoreChange),
    () => onlineManager.isOnline(),
    () => true,
  );
}

export function usePortfolioData(
  context: NormalizedTradingContext,
  target: AccountTarget | null,
  markets: readonly Market[] | undefined,
): {
  readonly portfolio: NormalizedPortfolio | null;
  readonly query: ReturnType<typeof useQuery<PortfolioAccountSnapshot>>;
  readonly historyQuery: ReturnType<typeof useQuery<PortfolioHistorySnapshot>>;
  readonly freshness: PortfolioFreshness;
} {
  const isFocused = useIsFocused();
  const isOnline = useOnlineStatus();
  const accounts = useMemo(
    () => createAccountDataClient({ network: context.network }),
    [context.network],
  );
  const catalogFingerprint = useMemo(
    () => portfolioCatalogCacheKey(markets),
    [markets],
  );
  const baseQueryKey =
    target === null
      ? [
          ...queryKeys.private.accountSnapshot(context),
          "portfolio-screen",
          "no-exact-target",
          catalogFingerprint,
        ]
      : portfolioQueryKey(context, target, catalogFingerprint);
  const query = useQuery<PortfolioAccountSnapshot>({
    queryKey: [...baseQueryKey, "account"],
    enabled: target !== null && markets !== undefined,
    queryFn: ({ signal }) => {
      if (
        target === null ||
        markets === undefined ||
        context.masterAccount === null ||
        context.targetAccount === null
      ) {
        throw new Error("An exact account target and catalog are required.");
      }
      return loadPortfolioAccountSnapshot({
        accounts,
        network: context.network,
        masterAccount: context.masterAccount,
        target,
        markets,
        signal,
        now: Date.now(),
      });
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
    subscribed: isFocused,
  });
  const historyQuery = useQuery<PortfolioHistorySnapshot>({
    queryKey: [...baseQueryKey, "history"],
    enabled:
      target !== null && markets !== undefined && query.data !== undefined,
    queryFn: ({ signal }) => {
      if (
        target === null ||
        markets === undefined ||
        context.masterAccount === null ||
        context.targetAccount === null
      ) {
        throw new Error("An exact account target and catalog are required.");
      }
      return loadPortfolioHistorySnapshot({
        accounts,
        network: context.network,
        masterAccount: context.masterAccount,
        target,
        markets,
        signal,
        now: Date.now(),
      });
    },
    refetchInterval: 120_000,
    staleTime: 60_000,
    subscribed: isFocused,
  });
  const portfolio = useMemo(
    () =>
      query.data === undefined
        ? null
        : normalizePortfolioSnapshot(
            mergePortfolioSnapshots(query.data, historyQuery.data),
          ),
    [historyQuery.data, query.data],
  );
  const freshness: PortfolioFreshness = !isOnline
    ? "offline"
    : query.isRefetching
      ? "refreshing"
      : query.isStale
        ? "stale"
        : "fresh";
  return { portfolio, query, historyQuery, freshness };
}
