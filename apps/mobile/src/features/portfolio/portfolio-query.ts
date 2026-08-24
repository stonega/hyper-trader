import {
  type AccountTarget,
  createAccountDataClient,
} from "@hyper-trader/hyperliquid";
import type { Market } from "@hyper-trader/hyperliquid/public";
import { onlineManager, useQuery, useQueryClient } from "@tanstack/react-query";
import Constants from "expo-constants";
import { useIsFocused } from "expo-router";
import { useEffect, useMemo, useSyncExternalStore } from "react";

import type { NormalizedTradingContext } from "../../core/context/supervisor";
import { createCoalescedTask } from "../../core/query/coalesced-task";
import {
  ACCOUNT_EVENT_COALESCE_MS,
  mobileDataPolicies,
} from "../../core/query/data-policies";
import { queryKeys } from "../../core/query/keys";
import {
  type AccountEventChannel,
  accountEventStreamKey,
  createAccountEventWire,
} from "../../core/streams/account-events";
import { useStreamRuntime } from "../../core/streams/provider";
import {
  createPortfolioBackendClient,
  type PortfolioBackendClient,
} from "./backend-client";
import {
  loadPortfolioAccountSnapshot,
  loadPortfolioHistorySnapshot,
  type PortfolioAccountSnapshot,
  type PortfolioHistorySnapshot,
} from "./portfolio-loader";
import {
  combineNormalizedPortfolio,
  type NormalizedPortfolio,
  normalizePortfolioHistorySnapshot,
  normalizePortfolioLiveSnapshot,
} from "./portfolio-model";
import {
  portfolioCatalogCacheKey,
  portfolioQueryKey,
} from "./portfolio-query-key";

export type PortfolioTargetResolution =
  | { readonly target: AccountTarget; readonly reason: null }
  | { readonly target: null; readonly reason: string };

export type PortfolioFreshness = "fresh" | "refreshing" | "stale" | "offline";

export interface PortfolioQuerySource {
  readonly accounts: ReturnType<typeof createAccountDataClient>;
  readonly backend: PortfolioBackendClient | null;
  readonly backendConfigured: boolean;
}

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

export function createPortfolioQuerySource(
  network: NormalizedTradingContext["network"],
): PortfolioQuerySource {
  const accounts = createAccountDataClient({ network });
  const origin =
    process.env.EXPO_PUBLIC_BACKEND_ORIGIN ??
    process.env.EXPO_PUBLIC_NOTIFICATION_SERVICE_ORIGIN ??
    Constants.expoConfig?.extra?.backendOrigin ??
    Constants.expoConfig?.extra?.notificationServiceOrigin;
  if (typeof origin !== "string" || origin.length === 0) {
    return { accounts, backend: null, backendConfigured: false };
  }
  try {
    return {
      accounts,
      backend: createPortfolioBackendClient({ origin }),
      backendConfigured: true,
    };
  } catch {
    return { accounts, backend: null, backendConfigured: true };
  }
}

interface PortfolioQueryOptionsInput {
  readonly context: NormalizedTradingContext;
  readonly target: AccountTarget;
  readonly markets: readonly Market[];
  readonly source: PortfolioQuerySource;
}

export function portfolioAccountQueryOptions(
  input: PortfolioQueryOptionsInput,
) {
  const { context, markets, source, target } = input;
  const masterAccount = context.masterAccount;
  if (masterAccount === null || context.targetAccount === null) {
    throw new Error("An exact account target and catalog are required.");
  }
  const baseQueryKey = portfolioQueryKey(
    context,
    target,
    portfolioCatalogCacheKey(markets),
  );
  return {
    queryKey: [...baseQueryKey, "account"] as const,
    queryFn: ({ signal }: { readonly signal: AbortSignal }) => {
      if (source.backend) {
        return source.backend
          .readLive(context.network, target.address.toLowerCase(), signal)
          .then((snapshot) => ({
            owner: {
              network: context.network,
              masterAccount,
              target,
            },
            markets,
            perpStates: snapshot.dexes.map((portfolioSource) => {
              const market = markets.find(
                (candidate) =>
                  candidate.family === "perp" &&
                  candidate.dexName === portfolioSource.dex,
              );
              return {
                dexName: portfolioSource.dex,
                dexFullName:
                  market?.family === "perp" ? market.dexFullName : null,
                state: portfolioSource.clearinghouse,
                openOrders: portfolioSource.openOrders,
              };
            }),
            spotState: snapshot.spot,
            observedAtMs: snapshot.generatedAtMs,
            sourceGaps: snapshot.sourceGaps,
          }));
      }
      if (
        !source.backendConfigured &&
        typeof __DEV__ !== "undefined" &&
        __DEV__
      ) {
        return loadPortfolioAccountSnapshot({
          accounts: source.accounts,
          network: context.network,
          masterAccount,
          target,
          markets,
          signal,
          now: Date.now(),
        });
      }
      throw new Error("The Portfolio backend is not configured.");
    },
    staleTime: mobileDataPolicies.portfolioLive.staleTimeMs,
  };
}

export function portfolioHistoryQueryOptions(
  input: PortfolioQueryOptionsInput,
) {
  const { context, markets, source, target } = input;
  const masterAccount = context.masterAccount;
  if (masterAccount === null || context.targetAccount === null) {
    throw new Error("An exact account target and catalog are required.");
  }
  const baseQueryKey = portfolioQueryKey(
    context,
    target,
    portfolioCatalogCacheKey(markets),
  );
  return {
    queryKey: [...baseQueryKey, "history"] as const,
    queryFn: ({ signal }: { readonly signal: AbortSignal }) => {
      if (source.backend) {
        return source.backend
          .readHistory(context.network, target.address.toLowerCase(), signal)
          .then((snapshot) => ({
            fills: snapshot.fills,
            funding: snapshot.funding,
            periods: snapshot.periods,
            sourceGaps: snapshot.sourceGaps,
          }));
      }
      if (
        !source.backendConfigured &&
        typeof __DEV__ !== "undefined" &&
        __DEV__
      ) {
        return loadPortfolioHistorySnapshot({
          accounts: source.accounts,
          network: context.network,
          masterAccount,
          target,
          markets,
          signal,
          now: Date.now(),
        });
      }
      throw new Error("The Portfolio backend is not configured.");
    },
    staleTime: mobileDataPolicies.portfolioHistory.staleTimeMs,
  };
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
  const queryClient = useQueryClient();
  const streams = useStreamRuntime();
  const targetIdentity =
    target === null
      ? null
      : JSON.stringify([
          target.kind,
          target.address.trim().toLowerCase(),
          target.kind === "master"
            ? null
            : (target.masterAddress?.trim().toLowerCase() ?? null),
        ]);
  const targetUser = target?.address.trim().toLowerCase() ?? null;
  const source = useMemo(
    () => createPortfolioQuerySource(context.network),
    [context.network],
  );
  const catalogFingerprint = useMemo(
    () => portfolioCatalogCacheKey(markets),
    [markets],
  );
  const baseQueryKey = useMemo(
    () =>
      targetIdentity === null
        ? [
            ...queryKeys.private.accountSnapshot(context),
            "portfolio-screen",
            "no-exact-target",
            catalogFingerprint,
          ]
        : [
            ...queryKeys.private.accountSnapshot(context),
            "portfolio-screen",
            targetIdentity,
            catalogFingerprint,
          ],
    [catalogFingerprint, context, targetIdentity],
  );
  const accountQueryKey = useMemo(
    () => [...baseQueryKey, "account"],
    [baseQueryKey],
  );
  const historyQueryKey = useMemo(
    () => [...baseQueryKey, "history"],
    [baseQueryKey],
  );
  const accountOptions = useMemo(
    () =>
      target === null || markets === undefined
        ? null
        : portfolioAccountQueryOptions({ context, target, markets, source }),
    [context, markets, source, target],
  );
  const query = useQuery<PortfolioAccountSnapshot>({
    ...(accountOptions ?? {
      queryKey: accountQueryKey,
      queryFn: async () => {
        throw new Error("An exact account target and catalog are required.");
      },
      staleTime: mobileDataPolicies.portfolioLive.staleTimeMs,
    }),
    enabled: accountOptions !== null,
    refetchOnMount: true,
    refetchInterval: mobileDataPolicies.portfolioLive.reconcileIntervalMs,
    subscribed: isFocused,
  });
  const historyOptions = useMemo(
    () =>
      target === null || markets === undefined
        ? null
        : portfolioHistoryQueryOptions({ context, target, markets, source }),
    [context, markets, source, target],
  );
  const historyQuery = useQuery<PortfolioHistorySnapshot>({
    ...(historyOptions ?? {
      queryKey: historyQueryKey,
      queryFn: async () => {
        throw new Error("An exact account target and catalog are required.");
      },
      staleTime: mobileDataPolicies.portfolioHistory.staleTimeMs,
    }),
    enabled: historyOptions !== null && query.data !== undefined,
    refetchOnMount: true,
    subscribed: isFocused,
  });
  useEffect(() => {
    if (!isFocused || targetUser === null || markets === undefined) return;
    const user = targetUser;
    const channels: readonly AccountEventChannel[] = [
      "allDexsClearinghouseState",
      "orderUpdates",
      "userFills",
      "userFundings",
    ];
    let active = true;
    const liveInvalidation = createCoalescedTask(() => {
      if (!active) return;
      void queryClient.invalidateQueries(
        {
          queryKey: accountQueryKey,
          exact: true,
          refetchType: "active",
        },
        { cancelRefetch: false },
      );
    }, ACCOUNT_EVENT_COALESCE_MS);
    const historyInvalidation = createCoalescedTask(() => {
      if (!active) return;
      void queryClient.invalidateQueries(
        {
          queryKey: historyQueryKey,
          exact: true,
          refetchType: "active",
        },
        { cancelRefetch: false },
      );
    }, ACCOUNT_EVENT_COALESCE_MS);
    const cleanups = channels.map((channel) =>
      streams.declare({
        wire: createAccountEventWire(
          accountEventStreamKey(context.network, user, channel),
          user,
          channel,
        ),
        loadBaseline: async () => ({ data: null }),
        applyBaseline: () => undefined,
        applyDelta: () => {
          liveInvalidation.schedule();
          if (channel === "userFills" || channel === "userFundings") {
            historyInvalidation.schedule();
          }
        },
      }),
    );
    return () => {
      active = false;
      liveInvalidation.cancel();
      historyInvalidation.cancel();
      for (const cleanup of cleanups) cleanup();
    };
  }, [
    accountQueryKey,
    context.network,
    historyQueryKey,
    isFocused,
    markets,
    queryClient,
    streams,
    targetUser,
  ]);
  const livePortfolio = useMemo(
    () =>
      query.data === undefined
        ? null
        : normalizePortfolioLiveSnapshot(query.data),
    [query.data],
  );
  const portfolioHistory = useMemo(
    () =>
      historyQuery.data === undefined
        ? null
        : normalizePortfolioHistorySnapshot(historyQuery.data),
    [historyQuery.data],
  );
  const portfolio = useMemo(
    () =>
      livePortfolio === null
        ? null
        : combineNormalizedPortfolio(livePortfolio, portfolioHistory),
    [livePortfolio, portfolioHistory],
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
