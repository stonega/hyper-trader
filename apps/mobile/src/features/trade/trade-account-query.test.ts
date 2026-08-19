import { describe, expect, test } from "bun:test";

import { NATIVE_DUPLICATE, SPOT_DUPLICATE } from "../markets/fixture";
import { PORTFOLIO_FIXTURE } from "../portfolio/portfolio.fixture";
import {
  tradePerpAccountSnapshot,
  tradeSpotAccountSnapshot,
} from "./trade-account-snapshot";

const OBSERVED_AT = 1_720_000_050_000;

describe("Trade account snapshot adapters", () => {
  test("uses withdrawable margin and the exact selected position", () => {
    expect(
      tradePerpAccountSnapshot({
        state: PORTFOLIO_FIXTURE.perpStates[0].state,
        market: NATIVE_DUPLICATE,
        observedAtMs: OBSERVED_AT,
      }),
    ).toEqual({
      availableFunds: "118",
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
        market: NATIVE_DUPLICATE,
        observedAtMs: OBSERVED_AT,
      }),
    ).toEqual({
      availableFunds: "118",
      leverage: null,
      marginMode: null,
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
      availableFunds: "95",
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
