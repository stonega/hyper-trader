import type {
  AccountDataClient,
  AccountTarget,
} from "@hyper-trader/hyperliquid";
import type {
  HyperliquidNetwork,
  Market,
} from "@hyper-trader/hyperliquid/public";

import type {
  PortfolioPerpSource,
  PortfolioSourceSnapshot,
} from "./portfolio-model";

const EMPTY_SPOT_STATE = { balances: [] } as const;
const FUNDING_WINDOW_MS = 30 * 24 * 60 * 60 * 1_000;

export type PortfolioLiveAccountReader = Pick<
  AccountDataClient,
  | "getClearinghouseState"
  | "getFrontendOpenOrders"
  | "getSpotClearinghouseState"
>;

export type PortfolioHistoryAccountReader = Pick<
  AccountDataClient,
  "getFills" | "getFunding" | "getPortfolio"
>;

export type PortfolioAccountReader = PortfolioLiveAccountReader &
  PortfolioHistoryAccountReader;

interface PortfolioLoaderContext {
  readonly network: HyperliquidNetwork;
  readonly masterAccount: string;
  readonly target: AccountTarget;
  readonly markets: readonly Market[];
  readonly signal: AbortSignal;
  readonly now: number;
}

export type LoadPortfolioAccountSnapshotInput = PortfolioLoaderContext & {
  readonly accounts: PortfolioLiveAccountReader;
};

export type LoadPortfolioHistorySnapshotInput = PortfolioLoaderContext & {
  readonly accounts: PortfolioHistoryAccountReader;
};

export type LoadPortfolioSnapshotInput = PortfolioLoaderContext & {
  readonly accounts: PortfolioAccountReader;
};

export type PortfolioAccountSnapshot = Omit<
  PortfolioSourceSnapshot,
  "fills" | "funding" | "periods"
>;

export interface PortfolioHistorySnapshot {
  readonly fills: PortfolioSourceSnapshot["fills"];
  readonly funding: PortfolioSourceSnapshot["funding"];
  readonly periods: PortfolioSourceSnapshot["periods"];
  readonly sourceGaps?: readonly string[];
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

export async function loadPortfolioAccountSnapshot(
  input: LoadPortfolioAccountSnapshotInput,
): Promise<PortfolioAccountSnapshot> {
  const sources = dexSources(input.markets);
  const perpResultsPromise = Promise.all(
    sources.map(
      async (
        source,
      ): Promise<{
        readonly data: PortfolioPerpSource | null;
        readonly gaps: readonly string[];
      }> => {
        const [state, orders] = await Promise.allSettled([
          input.accounts.getClearinghouseState(input.target, source.dexName, {
            signal: input.signal,
          }),
          input.accounts.getFrontendOpenOrders(input.target, source.dexName, {
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
  const spotResultPromise = Promise.allSettled([
    input.accounts.getSpotClearinghouseState(input.target, {
      signal: input.signal,
    }),
  ] as const);

  const [perpResults, [spot]] = await Promise.all([
    perpResultsPromise,
    spotResultPromise,
  ] as const);
  if (input.signal.aborted) {
    throw new Error("Portfolio refresh was canceled.");
  }
  const sourceGaps = [
    ...perpResults.flatMap((result) => result.gaps),
    ...(spot.status === "fulfilled" ? [] : ["Spot balances were unavailable."]),
  ];
  return {
    owner: {
      network: input.network,
      masterAccount: input.masterAccount,
      target: input.target,
    },
    markets: input.markets,
    perpStates: perpResults.flatMap((value) =>
      value.data === null ? [] : [value.data],
    ),
    spotState: spot.status === "fulfilled" ? spot.value.data : EMPTY_SPOT_STATE,
    observedAtMs: input.now,
    sourceGaps,
  };
}

export async function loadPortfolioHistorySnapshot(
  input: LoadPortfolioHistorySnapshotInput,
): Promise<PortfolioHistorySnapshot> {
  const [fills, funding, periods] = await Promise.allSettled([
    input.accounts.getFills(input.target, {
      signal: input.signal,
      aggregateByTime: true,
    }),
    input.accounts.getFunding(
      input.target,
      { startTime: Math.max(0, input.now - FUNDING_WINDOW_MS) },
      { signal: input.signal },
    ),
    input.accounts.getPortfolio(input.target, { signal: input.signal }),
  ] as const);
  if (input.signal.aborted) {
    throw new Error("Portfolio refresh was canceled.");
  }
  const sourceGaps = [
    ...(fills.status === "fulfilled" ? [] : ["Fill history was unavailable."]),
    ...(funding.status === "fulfilled"
      ? []
      : ["Funding history was unavailable."]),
    ...(periods.status === "fulfilled"
      ? []
      : ["Performance history was unavailable."]),
  ];
  return {
    fills: fills.status === "fulfilled" ? fills.value.data : [],
    funding: funding.status === "fulfilled" ? funding.value.data : [],
    periods: periods.status === "fulfilled" ? periods.value.data : [],
    sourceGaps,
  };
}

export function mergePortfolioSnapshots(
  account: PortfolioAccountSnapshot,
  history: PortfolioHistorySnapshot | undefined,
): PortfolioSourceSnapshot {
  return {
    ...account,
    fills: history?.fills ?? [],
    funding: history?.funding ?? [],
    periods: history?.periods ?? [],
    sourceGaps: [...(account.sourceGaps ?? []), ...(history?.sourceGaps ?? [])],
  };
}

export async function loadPortfolioSnapshot(
  input: LoadPortfolioSnapshotInput,
): Promise<PortfolioSourceSnapshot> {
  const accountPromise = loadPortfolioAccountSnapshot(input);
  const historyPromise = loadPortfolioHistorySnapshot(input);
  const [account, history] = await Promise.all([
    accountPromise,
    historyPromise,
  ] as const);
  return mergePortfolioSnapshots(account, history);
}
