import { describe, expect, test } from "bun:test";
import type { ActiveAssetData } from "@hyper-trader/hyperliquid";

import { NATIVE_DUPLICATE, SPOT_DUPLICATE } from "../markets/fixture";
import { PORTFOLIO_FIXTURE } from "../portfolio/portfolio.fixture";
import {
  tradePerpAccountSnapshot,
  tradeSpotAccountSnapshot,
} from "./trade-account-snapshot";

const OBSERVED_AT = 1_720_000_050_000;
const ACTIVE_ASSET = {
  user: "0x1111111111111111111111111111111111111111",
  coin: NATIVE_DUPLICATE.coin,
  leverage: { type: "cross", value: 5 },
  maxTradeSizes: ["23", "22"],
  availableToTrade: ["118", "117"],
  markPrice: "10",
} as const satisfies ActiveAssetData;

describe("Trade account snapshot adapters", () => {
  test("uses side-specific trading capacity instead of withdrawable funds", () => {
    expect(
      tradePerpAccountSnapshot({
        state: {
          ...PORTFOLIO_FIXTURE.perpStates[0].state,
          withdrawable: "0",
        },
        activeAsset: ACTIVE_ASSET,
        market: NATIVE_DUPLICATE,
        observedAtMs: OBSERVED_AT,
      }),
    ).toEqual({
      availableFunds: { buy: "118", sell: "117" },
      leverage: 5,
      marginMode: "cross",
      positionSize: "2.5",
      version: 1_720_000_030_000,
      observedAtMs: OBSERVED_AT,
    });
  });

  test("keeps venue margin available without an open position", () => {
    expect(
      tradePerpAccountSnapshot({
        state: {
          ...PORTFOLIO_FIXTURE.perpStates[0].state,
          positions: [],
        },
        activeAsset: ACTIVE_ASSET,
        market: NATIVE_DUPLICATE,
        observedAtMs: OBSERVED_AT,
      }),
    ).toEqual({
      availableFunds: { buy: "118", sell: "117" },
      leverage: 5,
      marginMode: "cross",
      positionSize: "0",
      version: 1_720_000_030_000,
      observedAtMs: OBSERVED_AT,
    });
  });

  test("subtracts held quote balance for spot available funds", () => {
    expect(
      tradeSpotAccountSnapshot({
        state: PORTFOLIO_FIXTURE.spotState,
        market: SPOT_DUPLICATE,
        observedAtMs: OBSERVED_AT,
      }),
    ).toEqual({
      availableFunds: { buy: "95", sell: "95" },
      leverage: null,
      marginMode: null,
      positionSize: "3",
      version: OBSERVED_AT,
      observedAtMs: OBSERVED_AT,
    });
  });

  test("does not guess malformed or ambiguous account data", () => {
    const state = PORTFOLIO_FIXTURE.perpStates[0].state;
    const quoteBalance = PORTFOLIO_FIXTURE.spotState.balances[0];
    if (!quoteBalance) throw new Error("quote balance fixture missing");
    expect(
      tradePerpAccountSnapshot({
        state: {
          ...state,
          positions: [...state.positions, ...state.positions],
        },
        activeAsset: ACTIVE_ASSET,
        market: NATIVE_DUPLICATE,
        observedAtMs: OBSERVED_AT,
      }),
    ).toBeNull();
    expect(
      tradeSpotAccountSnapshot({
        state: {
          balances: [...PORTFOLIO_FIXTURE.spotState.balances, quoteBalance],
        },
        market: SPOT_DUPLICATE,
        observedAtMs: OBSERVED_AT,
      }),
    ).toBeNull();
  });
});
