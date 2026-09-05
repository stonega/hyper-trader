import type {
  HyperliquidNetwork,
  Market,
  MarketContext,
} from "@hyper-trader/hyperliquid/public";
import { afterEach, beforeEach, expect, jest, test } from "@jest/globals";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  renderHook,
  waitFor,
} from "@testing-library/react-native";
import type { PropsWithChildren } from "react";

import { queryKeys } from "../core/query/keys";
import type { StreamDeclaration } from "../core/streams/runtime";
import { HIP3_DUPLICATE, NATIVE_DUPLICATE } from "../features/markets/fixture";
import { useTradeMarketData } from "../features/trade/market-data";

const mockUseIsFocused = jest.fn(() => true);
const mockDeclarations = new Map<string, StreamDeclaration>();
const mockStreams = {
  declare(declaration: StreamDeclaration) {
    mockDeclarations.set(declaration.wire.key, declaration);
    return () => mockDeclarations.delete(declaration.wire.key);
  },
};

jest.mock("expo-router", () => ({
  useIsFocused: () => mockUseIsFocused(),
}));

jest.mock("../core/streams/provider", () => ({
  useStreamRuntime: () => mockStreams,
}));

let client: QueryClient;

beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  mockUseIsFocused.mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  client.clear();
  mockDeclarations.clear();
});

function mountMarket(market: Market | null = NATIVE_DUPLICATE) {
  return renderHook(
    (props: {
      readonly network: HyperliquidNetwork;
      readonly market: Market | null;
    }) => useTradeMarketData(props.network, props.market),
    {
      initialProps: { network: "testnet" as HyperliquidNetwork, market },
      wrapper: ({ children }: PropsWithChildren) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    },
  );
}

function declaration(): StreamDeclaration {
  expect(mockDeclarations.size).toBe(1);
  const active = mockDeclarations.values().next().value;
  if (!active) throw new Error("Expected the selected market stream.");
  return active;
}

function emitContext(context: MarketContext, coin = NATIVE_DUPLICATE.coin) {
  const active = declaration();
  act(() => {
    for (const message of active.wire.decode({
      channel: "activeAssetCtx",
      data: { coin, ctx: context },
    })) {
      active.applyDelta(message);
    }
  });
}

async function applyBaseline(active = declaration()) {
  await act(async () => {
    active.applyBaseline(
      await active.loadBaseline({
        signal: new AbortController().signal,
        generation: 1,
      }),
    );
  });
}

const liveContext = { markPx: "15", midPx: "14", funding: "0.0002" };

test("seeds a newly resolved market and then displays live context", async () => {
  const { result, rerender } = mountMarket(null);
  expect(result.current.context.data).toBeUndefined();
  expect(mockDeclarations.size).toBe(0);

  rerender({ network: "testnet", market: NATIVE_DUPLICATE });
  await waitFor(() =>
    expect(result.current.context.data?.markPx).toBe(NATIVE_DUPLICATE.markPx),
  );
  await applyBaseline();
  emitContext(liveContext);
  await waitFor(() => expect(result.current.context.data).toEqual(liveContext));
});

test.each(["invalidate", "refetch"] as const)(
  "%s cannot replace live context with the catalog snapshot",
  async (operation) => {
    const { result } = mountMarket();
    await applyBaseline();
    emitContext(liveContext);
    await waitFor(() =>
      expect(result.current.context.data).toEqual(liveContext),
    );

    const filters = {
      queryKey: queryKeys.public.marketContext(
        "testnet",
        NATIVE_DUPLICATE.canonicalId,
      ),
      exact: true,
    };
    await act(async () => {
      if (operation === "invalidate") {
        await client.invalidateQueries(filters);
      } else {
        await client.refetchQueries(filters);
      }
    });
    expect(client.getQueryData(filters.queryKey)).toEqual(liveContext);
    expect(result.current.context.data).toEqual(liveContext);
  },
);

test("catalog refresh and reconnect baselines preserve the latest live context", async () => {
  const { result, rerender } = mountMarket();
  await applyBaseline();
  emitContext(liveContext);
  await waitFor(() => expect(result.current.context.data).toEqual(liveContext));

  const refreshedMarket = { ...NATIVE_DUPLICATE, markPx: "11" };
  rerender({ network: "testnet", market: refreshedMarket });
  await applyBaseline();
  expect(
    client.getQueryData(
      queryKeys.public.marketContext("testnet", NATIVE_DUPLICATE.canonicalId),
    ),
  ).toEqual(liveContext);
  expect(result.current.context.data).toEqual(liveContext);

  mockUseIsFocused.mockReturnValue(false);
  rerender({ network: "testnet", market: refreshedMarket });
  expect(mockDeclarations.size).toBe(0);
  mockUseIsFocused.mockReturnValue(true);
  rerender({ network: "testnet", market: refreshedMarket });

  const active = declaration();
  const baseline = await active.loadBaseline({
    signal: new AbortController().signal,
    generation: 2,
  });
  const nextContext = { ...liveContext, markPx: "13", midPx: "12" };
  emitContext(nextContext);
  await act(async () => active.applyBaseline(baseline));
  await waitFor(() => expect(result.current.context.data).toEqual(nextContext));
});

test("keeps cached live prices scoped to the exact market and network", async () => {
  const { result, rerender } = mountMarket();
  await applyBaseline();
  emitContext(liveContext);
  await waitFor(() => expect(result.current.context.data).toEqual(liveContext));

  rerender({ network: "testnet", market: HIP3_DUPLICATE });
  await applyBaseline();
  await waitFor(() =>
    expect(result.current.context.data?.markPx).toBe(HIP3_DUPLICATE.markPx),
  );
  emitContext({ markPx: "99" }, NATIVE_DUPLICATE.coin);
  expect(result.current.context.data?.markPx).toBe(HIP3_DUPLICATE.markPx);

  rerender({ network: "mainnet", market: NATIVE_DUPLICATE });
  await applyBaseline();
  await waitFor(() =>
    expect(result.current.context.data?.markPx).toBe(NATIVE_DUPLICATE.markPx),
  );

  rerender({ network: "testnet", market: NATIVE_DUPLICATE });
  await applyBaseline();
  expect(result.current.context.data).toEqual(liveContext);
});
