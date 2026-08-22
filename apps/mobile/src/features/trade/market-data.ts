import {
  type Candle,
  createPublicHyperliquidClient,
  type HyperliquidNetwork,
  type L2Book,
  type Market,
  type MarketContext,
  type RecentTrade,
} from "@hyper-trader/hyperliquid/public";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useIsFocused } from "expo-router";
import { useCallback, useEffect, useMemo } from "react";

import { mobileDataPolicies } from "../../core/query/data-policies";
import { queryKeys } from "../../core/query/keys";
import { useStreamRuntime } from "../../core/streams/provider";
import {
  mergeTradeCandleHistory,
  previousCandlePageEnd,
} from "./candle-history";
import {
  candleBaselineFromStream,
  candleFromTradeStreamMessage,
  createTradeCandleWire,
  mergeTradeCandle,
  tradeCandleStreamKey,
} from "./candle-stream";
import {
  bookBaselineFromStream,
  bookFromTradeStreamMessage,
  createTradeBookWire,
  createTradeRecentTradesWire,
  mergeRecentTrade,
  recentTradeFromStreamMessage,
  recentTradesBaselineFromStream,
  tradeBookStreamKey,
  tradeRecentTradesStreamKey,
} from "./market-activity-stream";
import {
  type TradeChartInterval,
  tradeCandleRange,
  tradeChartCandleCapacity,
} from "./market-chart-config";
import {
  createTradeMarketContextWire,
  marketContextBaselineFromStream,
  marketContextFromMarket,
  marketContextFromStreamMessage,
  tradeMarketContextStreamKey,
} from "./market-context-stream";

const TRADE_CANDLE_HISTORY_MAX_PAGES = 6;

export function useTradeMarketData(
  network: HyperliquidNetwork,
  market: Market | null,
) {
  const isFocused = useIsFocused();
  const queryClient = useQueryClient();
  const streams = useStreamRuntime();
  const canonicalId = market?.canonicalId ?? "none";
  const coin = market?.coin ?? "";
  const enabled = market !== null && isFocused;
  const marketContextQueryKey = useMemo(
    () => queryKeys.public.marketContext(network, canonicalId),
    [canonicalId, network],
  );
  const catalogContext = useMemo(
    () => (market === null ? null : marketContextFromMarket(market)),
    [market],
  );
  const context = useQuery<MarketContext>({
    queryKey: marketContextQueryKey,
    queryFn: async () => {
      if (catalogContext === null) {
        throw new Error("A selected market context is required.");
      }
      return catalogContext;
    },
    enabled,
    staleTime: mobileDataPolicies.marketContext.staleTimeMs,
  });
  useEffect(() => {
    if (!enabled || catalogContext === null) return;
    const key = tradeMarketContextStreamKey(network, canonicalId);
    return streams.declare({
      wire: createTradeMarketContextWire(key, coin),
      loadBaseline: async () => ({ data: catalogContext }),
      applyBaseline(baseline) {
        queryClient.setQueryData<MarketContext>(
          marketContextQueryKey,
          marketContextBaselineFromStream(baseline.data),
        );
      },
      applyDelta(message) {
        queryClient.setQueryData<MarketContext>(
          marketContextQueryKey,
          marketContextFromStreamMessage(message),
        );
      },
    });
  }, [
    canonicalId,
    catalogContext,
    coin,
    enabled,
    marketContextQueryKey,
    network,
    queryClient,
    streams,
  ]);

  return { context };
}

export function useTradeCandleData(
  network: HyperliquidNetwork,
  market: Market | null,
  candleInterval: TradeChartInterval,
) {
  const isFocused = useIsFocused();
  const queryClient = useQueryClient();
  const streams = useStreamRuntime();
  const client = useMemo(
    () => createPublicHyperliquidClient({ network }),
    [network],
  );
  const canonicalId = market?.canonicalId ?? "none";
  const coin = market?.coin ?? "";
  const enabled = market !== null && isFocused;
  const candleQueryKey = useMemo(
    () => queryKeys.public.candles(network, canonicalId, candleInterval),
    [candleInterval, canonicalId, network],
  );
  const candleHistoryQueryKey = useMemo(
    () => queryKeys.public.candleHistory(network, canonicalId, candleInterval),
    [candleInterval, canonicalId, network],
  );
  const loadCandleSnapshot = useCallback(
    (signal?: AbortSignal) => {
      const endTime = Date.now();
      const range = tradeCandleRange(candleInterval, endTime);
      return client.getCandles(
        {
          coin,
          interval: candleInterval,
          ...range,
        },
        { signal },
      );
    },
    [candleInterval, client, coin],
  );
  const candles = useQuery({
    queryKey: candleQueryKey,
    queryFn: ({ signal }) => loadCandleSnapshot(signal),
    enabled,
    notifyOnChangeProps: ["data", "isPending", "isError", "isRefetchError"],
    staleTime: mobileDataPolicies.candles.staleTimeMs,
  });
  const historyEndTime = Math.max(
    0,
    (candles.data?.[0]?.openTime ?? Date.now()) - 1,
  );
  const history = useInfiniteQuery({
    queryKey: candleHistoryQueryKey,
    queryFn: ({ pageParam, signal }) => {
      const range = tradeCandleRange(candleInterval, pageParam);
      return client.getCandles(
        {
          coin,
          interval: candleInterval,
          ...range,
        },
        { signal },
      );
    },
    initialPageParam: historyEndTime,
    getNextPageParam: previousCandlePageEnd,
    maxPages: TRADE_CANDLE_HISTORY_MAX_PAGES,
    enabled: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
  useEffect(() => {
    if (!enabled) return;
    const expected = { coin, interval: candleInterval } as const;
    const key = tradeCandleStreamKey(network, canonicalId, candleInterval);
    return streams.declare({
      wire: createTradeCandleWire(key, expected),
      async loadBaseline() {
        const data = await queryClient.fetchQuery({
          queryKey: candleQueryKey,
          queryFn: ({ signal }) => loadCandleSnapshot(signal),
          staleTime: 0,
        });
        return { data };
      },
      applyBaseline(baseline) {
        queryClient.setQueryData<readonly Candle[]>(
          candleQueryKey,
          candleBaselineFromStream(baseline.data, expected),
        );
      },
      applyDelta(message) {
        const incoming = candleFromTradeStreamMessage(message, expected);
        queryClient.setQueryData<readonly Candle[]>(candleQueryKey, (current) =>
          mergeTradeCandle(
            current,
            incoming,
            tradeChartCandleCapacity(candleInterval),
          ),
        );
      },
    });
  }, [
    candleInterval,
    candleQueryKey,
    canonicalId,
    coin,
    enabled,
    loadCandleSnapshot,
    network,
    queryClient,
    streams,
  ]);

  const historyPages = history.data?.pages;
  const historyAtCapacity =
    (historyPages?.length ?? 0) >= TRADE_CANDLE_HISTORY_MAX_PAGES;
  const combined = useMemo(() => {
    const live = candles.data;
    if (live === undefined && historyPages === undefined) return undefined;
    return mergeTradeCandleHistory(
      [...(historyPages ?? []), ...(live === undefined ? [] : [live])],
      tradeChartCandleCapacity(candleInterval) *
        (TRADE_CANDLE_HISTORY_MAX_PAGES + 1),
    );
  }, [candleInterval, candles.data, historyPages]);
  const fetchOlder = useCallback(async () => {
    if (
      candles.data === undefined ||
      history.isFetchingNextPage ||
      historyAtCapacity ||
      (history.data !== undefined && history.hasNextPage === false)
    ) {
      return;
    }
    await history.fetchNextPage();
  }, [candles.data, history, historyAtCapacity]);

  return {
    ...candles,
    data: combined,
    liveRange:
      candles.data?.[0] && candles.data.at(-1)
        ? ([
            candles.data[0].openTime,
            candles.data.at(-1)?.openTime ?? candles.data[0].openTime,
          ] as const)
        : null,
    fetchOlder,
    canFetchOlder:
      candles.data !== undefined &&
      !historyAtCapacity &&
      (history.data === undefined || history.hasNextPage !== false),
    isFetchingOlder: history.isFetchingNextPage,
    historyError: history.isFetchNextPageError,
  };
}

export function useTradeMarketActivityData(
  network: HyperliquidNetwork,
  market: Market | null,
) {
  const isFocused = useIsFocused();
  const queryClient = useQueryClient();
  const streams = useStreamRuntime();
  const client = useMemo(
    () => createPublicHyperliquidClient({ network }),
    [network],
  );
  const canonicalId = market?.canonicalId ?? "none";
  const coin = market?.coin ?? "";
  const enabled = market !== null && isFocused;
  const bookQueryKey = useMemo(
    () => queryKeys.public.l2Book(network, canonicalId),
    [canonicalId, network],
  );
  const recentTradesQueryKey = useMemo(
    () => queryKeys.public.recentTrades(network, canonicalId),
    [canonicalId, network],
  );
  const loadBookSnapshot = useCallback(
    (signal?: AbortSignal) => client.getL2Book({ coin }, { signal }),
    [client, coin],
  );
  const loadRecentTradesSnapshot = useCallback(
    (signal?: AbortSignal) => client.getRecentTrades(coin, { signal }),
    [client, coin],
  );
  const book = useQuery({
    queryKey: bookQueryKey,
    queryFn: ({ signal }) => loadBookSnapshot(signal),
    enabled,
    notifyOnChangeProps: ["data", "isPending", "isError", "isRefetchError"],
    staleTime: mobileDataPolicies.orderBook.staleTimeMs,
  });
  useEffect(() => {
    if (!enabled) return;
    const key = tradeBookStreamKey(network, canonicalId);
    return streams.declare({
      wire: createTradeBookWire(key, coin),
      async loadBaseline() {
        const data = await queryClient.fetchQuery({
          queryKey: bookQueryKey,
          queryFn: ({ signal }) => loadBookSnapshot(signal),
          staleTime: 0,
        });
        return { data };
      },
      applyBaseline(baseline) {
        queryClient.setQueryData<L2Book>(
          bookQueryKey,
          bookBaselineFromStream(baseline.data, coin),
        );
      },
      applyDelta(message) {
        queryClient.setQueryData<L2Book>(
          bookQueryKey,
          bookFromTradeStreamMessage(message, coin),
        );
      },
    });
  }, [
    bookQueryKey,
    canonicalId,
    coin,
    enabled,
    loadBookSnapshot,
    network,
    queryClient,
    streams,
  ]);
  const trades = useQuery({
    queryKey: recentTradesQueryKey,
    queryFn: ({ signal }) => loadRecentTradesSnapshot(signal),
    enabled,
    notifyOnChangeProps: ["data", "isPending", "isError", "isRefetchError"],
    staleTime: mobileDataPolicies.recentTrades.staleTimeMs,
  });
  useEffect(() => {
    if (!enabled) return;
    const key = tradeRecentTradesStreamKey(network, canonicalId);
    return streams.declare({
      wire: createTradeRecentTradesWire(key, coin),
      async loadBaseline() {
        const data = await queryClient.fetchQuery({
          queryKey: recentTradesQueryKey,
          queryFn: ({ signal }) => loadRecentTradesSnapshot(signal),
          staleTime: 0,
        });
        return { data };
      },
      applyBaseline(baseline) {
        queryClient.setQueryData<readonly RecentTrade[]>(
          recentTradesQueryKey,
          recentTradesBaselineFromStream(baseline.data, coin),
        );
      },
      applyDelta(message) {
        const incoming = recentTradeFromStreamMessage(message, coin);
        queryClient.setQueryData<readonly RecentTrade[]>(
          recentTradesQueryKey,
          (current) => mergeRecentTrade(current, incoming, 100),
        );
      },
    });
  }, [
    canonicalId,
    coin,
    enabled,
    loadRecentTradesSnapshot,
    network,
    queryClient,
    recentTradesQueryKey,
    streams,
  ]);

  return { book, trades };
}

export function useTradeMarketDetailRefresh(
  network: HyperliquidNetwork,
  market: Market | null,
  candleInterval: TradeChartInterval,
): () => Promise<void> {
  const queryClient = useQueryClient();
  const canonicalId = market?.canonicalId ?? "none";
  return useCallback(async () => {
    if (market === null) return;
    await Promise.all([
      queryClient.refetchQueries(
        {
          queryKey: queryKeys.public.candles(
            network,
            canonicalId,
            candleInterval,
          ),
          exact: true,
        },
        { cancelRefetch: false },
      ),
      queryClient.refetchQueries(
        {
          queryKey: queryKeys.public.l2Book(network, canonicalId),
          exact: true,
        },
        { cancelRefetch: false },
      ),
      queryClient.refetchQueries(
        {
          queryKey: queryKeys.public.recentTrades(network, canonicalId),
          exact: true,
        },
        { cancelRefetch: false },
      ),
    ]);
  }, [candleInterval, canonicalId, market, network, queryClient]);
}
