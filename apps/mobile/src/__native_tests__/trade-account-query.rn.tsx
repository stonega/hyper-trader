import { expect, jest, test } from "@jest/globals";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react-native";
import type { JSX } from "react";
import { Text } from "react-native";

import type { NormalizedTradingContext } from "../core/context/supervisor";
import { NATIVE_DUPLICATE } from "../features/markets/fixture";
import { useTradeAccountSnapshot } from "../features/trade/trade-account-query";

const FIRST = "0x1111111111111111111111111111111111111111";
const SECOND = "0x2222222222222222222222222222222222222222";
const mockUseIsFocused = jest.fn(() => true);
const mockMarginSummary = {
  accountValue: "100",
  totalNtlPos: "0",
  totalRawUsd: "100",
  totalMarginUsed: "0",
};
const mockCreateClient = jest.fn((network: "mainnet" | "testnet") => ({
  accounts: {
    getClearinghouseState: jest.fn(async () => ({
      data: {
        positions: [],
        crossMaintenanceMarginUsed: "0",
        crossMarginSummary: mockMarginSummary,
        marginSummary: mockMarginSummary,
        time: 1_720_000_000_000,
        withdrawable: "100",
      },
    })),
    getActiveAssetData: jest.fn(
      async (target: { readonly address: string }, coin: string) => ({
        data: {
          user: target.address,
          coin,
          leverage: { type: "cross", value: 5 },
          maxTradeSizes: ["100", "100"],
          availableToTrade:
            target.address === FIRST ? ["11", "10"] : ["22", "20"],
          markPrice: "10",
        },
      }),
    ),
  },
  network,
}));

jest.mock("expo-router", () => ({
  useIsFocused: () => mockUseIsFocused(),
}));

jest.mock("@hyper-trader/hyperliquid", () => ({
  createHyperliquidClient: (options: {
    readonly network: "mainnet" | "testnet";
  }) => mockCreateClient(options.network),
}));

jest.mock("../core/streams/provider", () => ({
  useStreamRuntime: () => ({
    declare: () => () => undefined,
  }),
}));

function context(address: string): NormalizedTradingContext {
  return {
    network: "mainnet",
    masterAccount: address,
    targetAccount: address,
    signer: null,
  };
}

function Harness({
  current,
}: {
  readonly current: NormalizedTradingContext;
}): JSX.Element {
  const query = useTradeAccountSnapshot(
    current,
    current.targetAccount === null
      ? null
      : { kind: "master", address: current.targetAccount },
    NATIVE_DUPLICATE,
  );
  return <Text>{query.data?.availableFunds.buy ?? "loading"}</Text>;
}

test("loads the newly active account when Trade regains focus", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  mockUseIsFocused.mockReturnValue(true);
  const view = render(
    <QueryClientProvider client={client}>
      <Harness current={context(FIRST)} />
    </QueryClientProvider>,
  );

  expect(await screen.findByText("11")).toBeTruthy();

  mockUseIsFocused.mockReturnValue(false);
  view.rerender(
    <QueryClientProvider client={client}>
      <Harness current={context(SECOND)} />
    </QueryClientProvider>,
  );
  expect(screen.getByText("loading")).toBeTruthy();

  mockUseIsFocused.mockReturnValue(true);
  view.rerender(
    <QueryClientProvider client={client}>
      <Harness current={context(SECOND)} />
    </QueryClientProvider>,
  );

  await waitFor(() => expect(screen.getByText("22")).toBeTruthy());
  expect(mockCreateClient).toHaveBeenLastCalledWith("mainnet");
  view.unmount();
  client.clear();
});
