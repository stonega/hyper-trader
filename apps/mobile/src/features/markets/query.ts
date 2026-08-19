import type {
  HyperliquidNetwork,
  MarketCatalog,
} from "@hyper-trader/hyperliquid/public";
import { onlineManager, useQuery } from "@tanstack/react-query";
import Constants from "expo-constants";
import { useIsFocused } from "expo-router";
import { useMemo, useSyncExternalStore } from "react";

import { queryKeys } from "../../core/query/keys";
import {
  createDevelopmentTestnetMarketCatalogClient,
  createMarketCatalogBackendClient,
  loadMarketCatalog,
} from "./catalog-client";
import { deriveCatalogPresentationState } from "./catalog-state";

const MARKET_CATALOG_REFRESH_INTERVAL_MS = 60_000;
const MARKET_CATALOG_STALE_TIME_MS = 2 * MARKET_CATALOG_REFRESH_INTERVAL_MS;

function useMarketCatalog(network: HyperliquidNetwork) {
  const isFocused = useIsFocused();
  const queryKey = queryKeys.public.marketCatalog(network);
  const source = useMemo(() => {
    const origin =
      process.env.EXPO_PUBLIC_BACKEND_ORIGIN ??
      process.env.EXPO_PUBLIC_NOTIFICATION_SERVICE_ORIGIN ??
      Constants.expoConfig?.extra?.backendOrigin ??
      Constants.expoConfig?.extra?.notificationServiceOrigin;
    if (typeof origin !== "string" || origin.length === 0) {
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
  }, [network]);
  const catalogQuery = useQuery<MarketCatalog>({
    queryKey,
    queryFn: ({ signal }) =>
      loadMarketCatalog({
        network,
        ...source,
        signal,
      }),
    refetchInterval: MARKET_CATALOG_REFRESH_INTERVAL_MS,
    subscribed: isFocused,
    staleTime: MARKET_CATALOG_STALE_TIME_MS,
  });
  const bootstrapQuery = useQuery<MarketCatalog>({
    queryKey: queryKeys.public.marketCatalogBootstrap(network),
    queryFn: ({ signal }) => {
      if (!source.development) {
        throw new Error("development market catalog is not configured");
      }
      return source.development.readBootstrap(network, signal);
    },
    enabled: source.development !== null && catalogQuery.data === undefined,
    subscribed: isFocused,
    staleTime: MARKET_CATALOG_STALE_TIME_MS,
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
  const catalog = catalogQuery.data ?? bootstrapQuery.data;
  const usingBootstrap =
    catalogQuery.data === undefined && bootstrapQuery.data !== undefined;
  const presentation = deriveCatalogPresentationState({
    hasData: catalog !== undefined,
    marketCount: catalog?.markets.length ?? 0,
    isPending: catalogQuery.isPending && bootstrapQuery.isPending,
    isPaused: catalogQuery.isPaused && bootstrapQuery.isPaused,
    isFetching: catalogQuery.isFetching || bootstrapQuery.isFetching,
    hasError:
      catalogQuery.isError ||
      catalogQuery.isRefetchError ||
      (bootstrapQuery.isError && catalog === undefined),
    isStale: usingBootstrap ? bootstrapQuery.isStale : catalogQuery.isStale,
    isOnline,
    sourceErrorCount: catalog?.sourceErrors.length ?? 0,
    quarantinedCount: catalog?.quarantined.length ?? 0,
  });
  return { catalog, catalogQuery, isBootstrap: usingBootstrap, presentation };
}
