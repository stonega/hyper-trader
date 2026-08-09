import {
  createPublicHyperliquidClient,
  type HyperliquidNetwork,
  type MarketCatalog,
} from "@hyper-trader/hyperliquid/public";
import { onlineManager, useQuery } from "@tanstack/react-query";
import { useIsFocused } from "expo-router";
import { useMemo, useSyncExternalStore } from "react";

import { queryKeys } from "../../core/query/keys";
import { deriveCatalogPresentationState } from "./catalog-state";

function useMarketCatalog(network: HyperliquidNetwork) {
  const isFocused = useIsFocused();
  const client = useMemo(
    () => createPublicHyperliquidClient({ network }),
    [network],
  );
  return useQuery<MarketCatalog>({
    queryKey: queryKeys.public.marketCatalog(network),
    queryFn: ({ signal }) => client.getMarketCatalog({ signal }),
    refetchInterval: 60_000,
    subscribed: isFocused,
    staleTime: 30_000,
  });
}

function useOnlineStatus(): boolean {
  return useSyncExternalStore(
    (onStoreChange) => onlineManager.subscribe(onStoreChange),
    () => onlineManager.isOnline(),
    () => true,
  );
}

export function useMarketCatalogPresentation(network: HyperliquidNetwork) {
  const catalogQuery = useMarketCatalog(network);
  const isOnline = useOnlineStatus();
  const catalog = catalogQuery.data;
  const presentation = deriveCatalogPresentationState({
    hasData: catalog !== undefined,
    marketCount: catalog?.markets.length ?? 0,
    isPending: catalogQuery.isPending,
    isPaused: catalogQuery.isPaused,
    isFetching: catalogQuery.isFetching,
    hasError: catalogQuery.isError || catalogQuery.isRefetchError,
    isStale: catalogQuery.isStale,
    isOnline,
    sourceErrorCount: catalog?.sourceErrors.length ?? 0,
    quarantinedCount: catalog?.quarantined.length ?? 0,
  });
  return { catalog, catalogQuery, presentation };
}
