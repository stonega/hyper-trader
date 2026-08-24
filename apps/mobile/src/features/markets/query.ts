import {
  type HyperliquidNetwork,
  type MarketCatalog,
  type MarketFamily,
  type MarketLifecycle,
  type MarketOrderAvailability,
  type MarketSummary,
  MarketSummaryGenerationChangedError,
  type MarketSummarySort,
} from "@hyper-trader/hyperliquid/public";
import {
  onlineManager,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import Constants from "expo-constants";
import { useIsFocused } from "expo-router";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { createMarketLoadTrace } from "../../core/performance/market-load-timing";
import { mobileDataPolicies } from "../../core/query/data-policies";
import { queryKeys } from "../../core/query/keys";
import {
  createDevelopmentTestnetMarketCatalogClient,
  createMarketCatalogBackendClient,
  loadMarketCatalog,
} from "./catalog-client";
import {
  deriveCatalogPresentationState,
  selectUsableMarketCatalog,
} from "./catalog-state";
import {
  createDevelopmentMarketSummaryClient,
  createMarketSummaryBackendClient,
  type MarketSummaryClient,
} from "./summary-client";

const MARKET_SUMMARY_PAGE_SIZE = 24;
const INITIAL_MARKET_SUMMARY_PAGE: MarketSummaryPageParam = {
  cursor: null,
  idOffset: 0,
};

export interface MarketSummaryDiscoveryOptions {
  readonly query: string;
  readonly family: MarketFamily | null;
  readonly includeHip3: boolean;
  readonly availability: MarketOrderAvailability | "all";
  readonly lifecycle: MarketLifecycle | "all";
  readonly sort: MarketSummarySort;
  readonly restrictToIds: boolean;
  readonly ids: readonly string[];
}

interface MarketSummaryPageParam {
  readonly cursor: string | null;
  readonly idOffset: number;
}

export function marketSummaryDiscoveryKey(
  options: MarketSummaryDiscoveryOptions,
): string {
  if (
    options.query === "" &&
    options.family === null &&
    !options.includeHip3 &&
    options.availability === "enabled" &&
    options.lifecycle === "active" &&
    options.sort === "volume" &&
    !options.restrictToIds &&
    options.ids.length === 0
  ) {
    return "default";
  }
  return JSON.stringify([
    options.query,
    options.family,
    options.includeHip3,
    options.availability,
    options.lifecycle,
    options.sort,
    options.restrictToIds,
    options.ids,
  ]);
}

function configuredBackendOrigin(): string | null {
  const origin =
    process.env.EXPO_PUBLIC_BACKEND_ORIGIN ??
    process.env.EXPO_PUBLIC_NOTIFICATION_SERVICE_ORIGIN ??
    Constants.expoConfig?.extra?.backendOrigin ??
    Constants.expoConfig?.extra?.notificationServiceOrigin;
  return typeof origin === "string" && origin.length > 0 ? origin : null;
}

export interface MarketCatalogQuerySource {
  readonly backend: ReturnType<typeof createMarketCatalogBackendClient> | null;
  readonly development: ReturnType<
    typeof createDevelopmentTestnetMarketCatalogClient
  > | null;
}

export function createMarketCatalogQuerySource(
  network: HyperliquidNetwork,
): MarketCatalogQuerySource {
  const origin = configuredBackendOrigin();
  if (origin === null) {
    return {
      backend: null,
      development:
        typeof __DEV__ !== "undefined" && __DEV__ && network === "testnet"
          ? createDevelopmentTestnetMarketCatalogClient()
          : null,
    };
  }
  try {
    return {
      backend: createMarketCatalogBackendClient({ origin }),
      development: null,
    };
  } catch {
    return { backend: null, development: null };
  }
}

export function marketCatalogQueryOptions(
  network: HyperliquidNetwork,
  source: MarketCatalogQuerySource,
) {
  return {
    queryKey: queryKeys.public.marketCatalog(network),
    queryFn: async ({ signal }: { readonly signal: AbortSignal }) => {
      const timing = createMarketLoadTrace({
        network,
        source: "catalog-query",
      });
      const span = timing.startStep("query:resolve");
      try {
        const catalog = await loadMarketCatalog({
          network,
          ...source,
          signal,
          timing,
        });
        span.finish({
          outcome: "success",
          marketCount: catalog.markets.length,
        });
        return catalog;
      } catch (error) {
        span.finish({ outcome: "error" });
        throw error;
      }
    },
    staleTime: mobileDataPolicies.marketCatalog.staleTimeMs,
  };
}

function useMarketCatalog(network: HyperliquidNetwork) {
  const isFocused = useIsFocused();
  const source = useMemo(
    () => createMarketCatalogQuerySource(network),
    [network],
  );
  const catalogQuery = useQuery<MarketCatalog>({
    ...marketCatalogQueryOptions(network, source),
    refetchInterval: mobileDataPolicies.marketCatalog.reconcileIntervalMs,
    subscribed: isFocused,
  });
  const bootstrapQuery = useQuery<MarketCatalog>({
    queryKey: queryKeys.public.marketCatalogBootstrap(network),
    queryFn: async ({ signal }) => {
      const timing = createMarketLoadTrace({
        network,
        source: "bootstrap-query",
      });
      const span = timing.startStep("query:resolve");
      if (!source.development) {
        span.finish({ outcome: "error" });
        throw new Error("development market catalog is not configured");
      }
      try {
        const catalog = await source.development.readBootstrap(
          network,
          signal,
          timing,
        );
        span.finish({
          outcome: "success",
          marketCount: catalog.markets.length,
        });
        return catalog;
      } catch (error) {
        span.finish({ outcome: "error" });
        throw error;
      }
    },
    enabled: source.development !== null && catalogQuery.data === undefined,
    subscribed: isFocused,
    staleTime: mobileDataPolicies.marketCatalog.staleTimeMs,
  });
  return { bootstrapQuery, catalogQuery };
}

function useOnlineStatus(): boolean {
  return useSyncExternalStore(
    (onStoreChange) => onlineManager.subscribe(onStoreChange),
    () => onlineManager.isOnline(),
    () => true,
  );
}

export function useMarketCatalogPresentation(network: HyperliquidNetwork) {
  const { bootstrapQuery, catalogQuery } = useMarketCatalog(network);
  const isOnline = useOnlineStatus();
  const { catalog, rejectedEmptyCatalog, usingBootstrap } =
    selectUsableMarketCatalog(catalogQuery.data, bootstrapQuery.data);
  const presentation = deriveCatalogPresentationState({
    hasData: catalog !== undefined,
    marketCount: catalog?.markets.length ?? 0,
    isPending: catalogQuery.isPending && bootstrapQuery.isPending,
    isPaused: catalogQuery.isPaused && bootstrapQuery.isPaused,
    isFetching: catalogQuery.isFetching || bootstrapQuery.isFetching,
    hasError:
      catalogQuery.isError ||
      catalogQuery.isRefetchError ||
      (bootstrapQuery.isError && catalog === undefined) ||
      rejectedEmptyCatalog,
    isStale: usingBootstrap ? bootstrapQuery.isStale : catalogQuery.isStale,
    isOnline,
    sourceErrorCount: catalog?.sourceErrors.length ?? 0,
    quarantinedCount: catalog?.quarantined.length ?? 0,
  });
  return { catalog, catalogQuery, isBootstrap: usingBootstrap, presentation };
}

export function useMarketSummaryPages(
  network: HyperliquidNetwork,
  options: MarketSummaryDiscoveryOptions,
) {
  const queryClient = useQueryClient();
  const isFocused = useIsFocused();
  const isOnline = useOnlineStatus();
  const emptyIdFilter = options.restrictToIds && options.ids.length === 0;
  const discoveryKey = marketSummaryDiscoveryKey(options);
  const client = useMemo<MarketSummaryClient | null>(() => {
    const origin = configuredBackendOrigin();
    if (origin === null) {
      if (typeof __DEV__ !== "undefined" && __DEV__ && network === "testnet") {
        const development = createDevelopmentTestnetMarketCatalogClient();
        const source = { backend: null, development };
        return createDevelopmentMarketSummaryClient(
          development,
          Date.now,
          async (requestedNetwork, _signal, timing) => {
            if (requestedNetwork !== network) {
              throw new Error("development market catalog network changed");
            }
            const queryKey = queryKeys.public.marketCatalog(network);
            const existing = queryClient.getQueryState(queryKey);
            timing?.mark("development:shared-catalog-query", {
              cacheHit: existing?.data !== undefined,
              requestAlreadyInFlight: existing?.fetchStatus === "fetching",
            });
            return queryClient.fetchQuery(
              marketCatalogQueryOptions(network, source),
            );
          },
        );
      }
      return null;
    }
    try {
      return createMarketSummaryBackendClient({ origin });
    } catch {
      return null;
    }
  }, [network, queryClient]);
  const query = useInfiniteQuery({
    queryKey: queryKeys.public.marketSummaries(network, discoveryKey),
    initialPageParam: INITIAL_MARKET_SUMMARY_PAGE,
    queryFn: async ({ pageParam, signal }) => {
      if (!client) throw new Error("market summaries are not configured");
      const timing = createMarketLoadTrace({
        network,
        source: "market-summary-query",
      });
      const span = timing.startStep("query:resolve-page", {
        cursor: pageParam.cursor ?? "first",
        idOffset: pageParam.idOffset,
      });
      const pageIds = !options.restrictToIds
        ? []
        : options.ids.slice(
            pageParam.idOffset,
            pageParam.idOffset + MARKET_SUMMARY_PAGE_SIZE,
          );
      try {
        const page = await client.read(
          network,
          {
            query: options.query,
            family: options.family,
            includeHip3: options.includeHip3,
            availability: options.availability,
            lifecycle: options.lifecycle,
            sort: options.sort,
            ids: pageIds,
            cursor: options.restrictToIds ? null : pageParam.cursor,
            limit: MARKET_SUMMARY_PAGE_SIZE,
          },
          signal,
          timing,
        );
        span.finish({
          outcome: "success",
          itemCount: page.items.length,
          total: page.total,
        });
        return page;
      } catch (error) {
        span.finish({ outcome: "error" });
        throw error;
      }
    },
    getNextPageParam: (lastPage, _pages, lastPageParam) => {
      if (options.restrictToIds) {
        const nextOffset = lastPageParam.idOffset + MARKET_SUMMARY_PAGE_SIZE;
        return nextOffset < options.ids.length
          ? { cursor: null, idOffset: nextOffset }
          : undefined;
      }
      return lastPage.nextCursor === null
        ? undefined
        : { cursor: lastPage.nextCursor, idOffset: 0 };
    },
    enabled: client !== null && !emptyIdFilter,
    refetchInterval: mobileDataPolicies.marketSummaries.reconcileIntervalMs,
    retry: (failureCount, error) =>
      error instanceof MarketSummaryGenerationChangedError
        ? false
        : failureCount < 2,
    subscribed: isFocused,
    staleTime: mobileDataPolicies.marketSummaries.staleTimeMs,
  });
  const markets = useMemo(() => {
    const byId = new Map<string, MarketSummary>();
    for (const page of query.data?.pages ?? []) {
      for (const market of page.items) byId.set(market.canonicalId, market);
    }
    return [...byId.values()];
  }, [query.data]);
  const firstPage = query.data?.pages[0];
  const total = !options.restrictToIds
    ? (firstPage?.total ?? 0)
    : (query.data?.pages.reduce((sum, page) => sum + page.total, 0) ?? 0);
  const presentation = deriveCatalogPresentationState({
    hasData: emptyIdFilter || firstPage !== undefined,
    marketCount: total,
    isPending: client !== null && !emptyIdFilter && query.isPending,
    isPaused: query.isPaused,
    isFetching: query.isFetching,
    hasError:
      !emptyIdFilter &&
      (client === null || query.isError || query.isRefetchError),
    isStale: query.isStale,
    isOnline,
    sourceErrorCount: firstPage?.sourceErrorCount ?? 0,
    quarantinedCount: firstPage?.quarantinedCount ?? 0,
  });
  const fetchNextPage = query.fetchNextPage;
  const refetch = query.refetch;
  const loadNextPage = useCallback(async () => {
    const result = await fetchNextPage();
    if (result.error instanceof MarketSummaryGenerationChangedError) {
      await refetch();
    }
  }, [fetchNextPage, refetch]);
  return {
    loadNextPage,
    markets,
    presentation,
    query,
    total,
  };
}
