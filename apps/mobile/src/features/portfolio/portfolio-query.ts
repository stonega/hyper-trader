import {
  type AccountTarget,
  createHyperliquidClient,
} from "@hyper-trader/hyperliquid";
import type { Market } from "@hyper-trader/hyperliquid/public";
import { onlineManager, useQuery } from "@tanstack/react-query";
import { useIsFocused } from "expo-router";
import { useMemo, useSyncExternalStore } from "react";

import type { NormalizedTradingContext } from "../../core/context/supervisor";
import { queryKeys } from "../../core/query/keys";
import {
  type NormalizedPortfolio,
  normalizePortfolioSnapshot,
  type PortfolioPerpSource,
  type PortfolioSourceSnapshot,
} from "./portfolio-model";
import {
  portfolioCatalogCacheKey,
  portfolioQueryKey,
} from "./portfolio-query-key";

const EMPTY_SPOT_STATE = { balances: [] } as const;
const FUNDING_WINDOW_MS = 30 * 24 * 60 * 60 * 1_000;

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

function dexSources(markets: readonly Market[]): readonly {
  readonly dexName: string;
  readonly dexFullName: string | null;
}[] {
  const sources = new Map<string, string | null>();
  for (const market of markets) {
    if (market.family === "perp" && !sources.has(market.dexName)) {
      sources.set(market.dexName, market.dexFullName);
    }
  }
  return [...sources.entries()].map(([dexName, dexFullName]) => ({
    dexName,
    dexFullName,
  }));
}

async function loadSnapshot(input: {
  readonly context: NormalizedTradingContext;
  readonly target: AccountTarget;
  readonly markets: readonly Market[];
  readonly signal: AbortSignal;
  readonly now: number;
}): Promise<PortfolioSourceSnapshot> {
  if (
    input.context.masterAccount === null ||
    input.context.targetAccount === null
  ) {
    throw new Error("An exact account owner is required.");
  }
  const client = createHyperliquidClient({ network: input.context.network });
  const sources = dexSources(input.markets);
  const perpResults = await Promise.all(
    sources.map(
      async (
        source,
      ): Promise<{
        readonly data: PortfolioPerpSource | null;
        readonly gaps: readonly string[];
      }> => {
        const [state, orders] = await Promise.allSettled([
          client.accounts.getClearinghouseState(input.target, source.dexName, {
            signal: input.signal,
          }),
          client.accounts.getOpenOrders(input.target, source.dexName, {
            signal: input.signal,
          }),
        ]);
        const label = source.dexName || "native";
        if (state.status !== "fulfilled") {
          return {
            data: null,
            gaps: [`Perpetual account source ${label} was unavailable.`],
          };
        }
        return {
          data: {
            ...source,
            state: state.value.data,
            openOrders: orders.status === "fulfilled" ? orders.value.data : [],
          },
          gaps:
            orders.status === "fulfilled"
              ? []
              : [`Open orders for perpetual source ${label} were unavailable.`],
        };
      },
    ),
  );
  if (input.signal.aborted) {
    throw new Error("Portfolio refresh was canceled.");
  }
  const [spot, fills, funding, periods] = await Promise.allSettled([
    client.accounts.getSpotClearinghouseState(input.target, {
      signal: input.signal,
    }),
    client.accounts.getFills(input.target, {
      signal: input.signal,
      aggregateByTime: true,
    }),
    client.accounts.getFunding(
      input.target,
      { startTime: Math.max(0, input.now - FUNDING_WINDOW_MS) },
      { signal: input.signal },
    ),
    client.accounts.getPortfolio(input.target, { signal: input.signal }),
  ]);
  const sourceGaps = [
    ...perpResults.flatMap((result) => result.gaps),
    ...(spot.status === "fulfilled" ? [] : ["Spot balances were unavailable."]),
    ...(fills.status === "fulfilled" ? [] : ["Fill history was unavailable."]),
    ...(funding.status === "fulfilled"
      ? []
      : ["Funding history was unavailable."]),
    ...(periods.status === "fulfilled"
      ? []
      : ["Performance history was unavailable."]),
  ];
  if (input.signal.aborted) {
    throw new Error("Portfolio refresh was canceled.");
  }
  return {
    owner: {
      network: input.context.network,
      masterAccount: input.context.masterAccount,
      target: input.target,
    },
    markets: input.markets,
    perpStates: perpResults.flatMap((value) =>
      value.data === null ? [] : [value.data],
    ),
    spotState: spot.status === "fulfilled" ? spot.value.data : EMPTY_SPOT_STATE,
    fills: fills.status === "fulfilled" ? fills.value.data : [],
    funding: funding.status === "fulfilled" ? funding.value.data : [],
    periods: periods.status === "fulfilled" ? periods.value.data : [],
    observedAtMs: input.now,
    sourceGaps,
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
  readonly query: ReturnType<typeof useQuery<NormalizedPortfolio>>;
  readonly freshness: PortfolioFreshness;
} {
  const isFocused = useIsFocused();
  const isOnline = useOnlineStatus();
  const catalogFingerprint = useMemo(
    () => portfolioCatalogCacheKey(markets),
    [markets],
  );
  const query = useQuery<NormalizedPortfolio>({
    queryKey:
      target === null
        ? [
            ...queryKeys.private.accountSnapshot(context),
            "portfolio-screen",
            "no-exact-target",
            catalogFingerprint,
          ]
        : portfolioQueryKey(context, target, catalogFingerprint),
    enabled: target !== null && markets !== undefined,
    queryFn: ({ signal }) => {
      if (target === null || markets === undefined) {
        throw new Error("An exact account target and catalog are required.");
      }
      return loadSnapshot({
        context,
        target,
        markets,
        signal,
        now: Date.now(),
      }).then(normalizePortfolioSnapshot);
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
    subscribed: isFocused,
  });
  const portfolio = query.data ?? null;
  const freshness: PortfolioFreshness = !isOnline
    ? "offline"
    : query.isRefetching
      ? "refreshing"
      : query.isStale
        ? "stale"
        : "fresh";
  return { portfolio, query, freshness };
}
