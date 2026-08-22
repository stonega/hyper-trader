import type {
  HyperliquidNetwork,
  MarketCatalog,
} from "@hyper-trader/hyperliquid/public";
import { onlineManager, useQuery } from "@tanstack/react-query";
import Constants from "expo-constants";
import { useIsFocused } from "expo-router";
import { useMemo, useSyncExternalStore } from "react";

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
    refetchInterval: mobileDataPolicies.marketCatalog.reconcileIntervalMs,
    subscribed: isFocused,
    staleTime: mobileDataPolicies.marketCatalog.staleTimeMs,
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
