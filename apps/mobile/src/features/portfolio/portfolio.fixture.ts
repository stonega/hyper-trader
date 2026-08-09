import type {
  ClearinghouseState,
  OpenOrder,
  PortfolioPeriod,
  SpotClearinghouseState,
  UserFill,
  UserFundingRecord,
} from "@hyper-trader/hyperliquid";

import {
  HIP3_DUPLICATE,
  NATIVE_DUPLICATE,
  SPOT_DUPLICATE,
} from "../markets/fixture";
import type { PortfolioSourceSnapshot } from "./portfolio-model";

const position = (
  coin: string,
  size: string,
  leverageType: string,
): ClearinghouseState["positions"][number] => ({
  coin,
  size,
  entryPrice: "10",
  liquidationPrice: "4",
  marginUsed: "2",
  positionValue: "25",
  returnOnEquity: "0.25",
  unrealizedPnl: "5",
  maxLeverage: 20,
  leverage: { type: leverageType, value: 5 },
  cumulativeFunding: {
    allTime: "-0.1",
    sinceChange: "-0.05",
    sinceOpen: "-0.02",
  },
});

const state = (
  time: number,
  positions: ClearinghouseState["positions"],
): ClearinghouseState => ({
  positions,
  crossMaintenanceMarginUsed: "1",
  crossMarginSummary: {
    accountValue: "120",
    totalNtlPos: "25",
    totalRawUsd: "120",
    totalMarginUsed: "2",
  },
  marginSummary: {
    accountValue: "120",
    totalNtlPos: "25",
    totalRawUsd: "120",
    totalMarginUsed: "2",
  },
  time,
  withdrawable: "118",
});

const order = (coin: string, oid: number): OpenOrder => ({
  coin,
  limitPrice: "10.25",
  oid,
  side: "B",
  size: "1.25",
  timestamp: 1_720_000_001_000 + oid,
});

const spotState: SpotClearinghouseState = {
  balances: [
    { coin: "USDC", token: 0, hold: "5", total: "100", entryNtl: "100" },
    { coin: "DUP", token: 42, hold: "0", total: "3", entryNtl: "4.5" },
  ],
};

const periods: readonly PortfolioPeriod[] = [
  {
    period: "day",
    accountValueHistory: [
      [1_720_000_000_000, "100"],
      [1_720_003_600_000, "105"],
    ],
    pnlHistory: [
      [1_720_000_000_000, "0"],
      [1_720_003_600_000, "5"],
    ],
    volume: "50",
  },
  {
    period: "week",
    accountValueHistory: [
      [1_719_900_000_000, "90"],
      [1_720_000_000_000, "105"],
    ],
    pnlHistory: [
      [1_719_900_000_000, "0"],
      [1_720_000_000_000, "15"],
    ],
    volume: "200",
  },
  {
    period: "allTime",
    accountValueHistory: [[1_700_000_000_000, "50"]],
    pnlHistory: [[1_700_000_000_000, "55"]],
    volume: "1000",
  },
];

const fills: readonly UserFill[] = [
  {
    coin: "DUP",
    side: "B",
    price: "10",
    size: "1",
    closedPnl: "2",
    startPosition: "1.5",
    fee: "0.01",
    feeToken: "USDC",
    oid: 70,
    time: 1_720_000_010_000,
    hash: "0xfill",
  },
];

const funding: readonly UserFundingRecord[] = [
  {
    time: 1_720_000_020_000,
    hash: "0xfunding",
    coin: "DUP",
    usdc: "-0.02",
    size: "2.5",
    fundingRate: "0.0001",
  },
];

export const PORTFOLIO_FIXTURE = {
  owner: {
    network: "testnet",
    masterAccount: "0x1111111111111111111111111111111111111111",
    target: {
      kind: "subaccount",
      address: "0x2222222222222222222222222222222222222222",
      masterAddress: "0x1111111111111111111111111111111111111111",
    },
  },
  markets: [NATIVE_DUPLICATE, HIP3_DUPLICATE, SPOT_DUPLICATE],
  perpStates: [
    {
      dexName: "",
      dexFullName: null,
      state: state(1_720_000_030_000, [position("DUP", "2.5", "cross")]),
      openOrders: [order("DUP", 71)],
    },
    {
      dexName: "omega",
      dexFullName: "Omega Markets",
      state: state(1_720_000_040_000, [
        position("omega:DUP", "-3", "isolated"),
      ]),
      openOrders: [order("omega:DUP", 72)],
    },
  ],
  spotState,
  fills,
  funding,
  periods,
  observedAtMs: 1_720_000_050_000,
} satisfies PortfolioSourceSnapshot;
