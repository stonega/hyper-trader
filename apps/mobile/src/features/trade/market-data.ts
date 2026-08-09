import {
  createPublicHyperliquidClient,
  type HyperliquidNetwork,
  type Market,
} from "@hyper-trader/hyperliquid/public";
import { useQuery } from "@tanstack/react-query";
import { useIsFocused } from "expo-router";
import { useMemo } from "react";

import { queryKeys } from "../../core/query/keys";

const DAY_MS = 24 * 60 * 60 * 1_000;

export function useTradeMarketData(
  network: HyperliquidNetwork,
  market: Market | null,
) {
  const isFocused = useIsFocused();
  const client = useMemo(
    () => createPublicHyperliquidClient({ network }),
    [network],
  );
  const canonicalId = market?.canonicalId ?? "none";
  const coin = market?.coin ?? "";
  const enabled = market !== null && isFocused;
  const candles = useQuery({
    queryKey: queryKeys.public.candles(network, canonicalId, "15m"),
    queryFn: ({ signal }) => {
      const endTime = Date.now();
      return client.getCandles(
        {
          coin,
          interval: "15m",
          startTime: endTime - DAY_MS,
          endTime,
        },
        { signal },
      );
    },
    enabled,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
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
