import {
  type Candle,
  createPublicHyperliquidClient,
  type HyperliquidNetwork,
  type Market,
} from "@hyper-trader/hyperliquid/public";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useIsFocused } from "expo-router";
import { useCallback, useEffect, useMemo } from "react";

import { queryKeys } from "../../core/query/keys";
import { useStreamRuntime } from "../../core/streams/provider";
import {
  candleBaselineFromStream,
  candleFromTradeStreamMessage,
  createTradeCandleWire,
  mergeTradeCandle,
  tradeCandleStreamKey,
} from "./candle-stream";
import {
  type TradeChartInterval,
  tradeCandleRange,
  tradeChartCandleCapacity,
} from "./market-chart-config";

export function useTradeMarketData(
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
    staleTime: 15_000,
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
  const book = useQuery({
    queryKey: queryKeys.public.l2Book(network, canonicalId),
    queryFn: ({ signal }) => client.getL2Book({ coin }, { signal }),
    enabled,
    refetchInterval: 10_000,
    staleTime: 5_000,
  });
  const trades = useQuery({
    queryKey: queryKeys.public.recentTrades(network, canonicalId),
    queryFn: ({ signal }) => client.getRecentTrades(coin, { signal }),
    enabled,
    refetchInterval: 10_000,
    staleTime: 5_000,
  });

  return { candles, book, trades };
}
