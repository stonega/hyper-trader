import { describe, expect, test } from "bun:test";
import type {
  AccountDataResult,
  AccountTarget,
  ClearinghouseState,
  FrontendOpenOrder,
  PortfolioPeriod,
  SpotClearinghouseState,
  UserFill,
  UserFundingRecord,
} from "@hyper-trader/hyperliquid";

import { MARKET_FIXTURE } from "../markets/fixture";
import {
  loadPortfolioAccountSnapshot,
  loadPortfolioSnapshot,
  type PortfolioAccountReader,
} from "./portfolio-loader";

const NOW = 1_800_000_000_000;
const MASTER_ADDRESS = "0x1111111111111111111111111111111111111111";
const TARGET = {
  kind: "master",
  address: MASTER_ADDRESS,
} as const satisfies AccountTarget;
const MARGIN_SUMMARY = {
  accountValue: "100",
  totalNtlPos: "0",
  totalRawUsd: "100",
  totalMarginUsed: "0",
} as const;
const CLEARINGHOUSE_STATE = {
  positions: [],
  crossMaintenanceMarginUsed: "0",
  crossMarginSummary: MARGIN_SUMMARY,
  marginSummary: MARGIN_SUMMARY,
  time: NOW,
  withdrawable: "100",
} as const satisfies ClearinghouseState;
const SPOT_STATE = {
  balances: [],
} as const satisfies SpotClearinghouseState;

function result<T>(
  target: AccountTarget,
  data: T,
  sourceDex: string | null,
): AccountDataResult<T> {
  return { target, sourceDex, data };
}

function deferredReader(rejectedCalls: ReadonlySet<string> = new Set()) {
  const calls: string[] = [];
  const completions: (() => void)[] = [];
  const schedule = <T>(label: string, value: T): Promise<T> => {
    calls.push(label);
    return new Promise<T>((resolve, reject) => {
      completions.push(() => {
        if (rejectedCalls.has(label)) {
          reject(new Error(`${label} unavailable`));
        } else {
          resolve(value);
        }
      });
    });
  };
  const reader = {
    getClearinghouseState(target, dex) {
      return schedule(
        `state:${dex || "native"}`,
        result(target, CLEARINGHOUSE_STATE, dex),
      );
    },
    getFrontendOpenOrders(target, dex) {
      return schedule(
        `orders:${dex || "native"}`,
        result<readonly FrontendOpenOrder[]>(target, [], dex),
      );
    },
    getSpotClearinghouseState(target) {
      return schedule("spot", result(target, SPOT_STATE, null));
    },
    getFills(target) {
      return schedule("fills", result<readonly UserFill[]>(target, [], null));
    },
    getFunding(target) {
      return schedule(
        "funding",
        result<readonly UserFundingRecord[]>(target, [], null),
      );
    },
    getPortfolio(target) {
      return schedule(
        "portfolio",
        result<readonly PortfolioPeriod[]>(target, [], null),
      );
    },
  } satisfies PortfolioAccountReader;

  return {
    calls,
    reader,
    complete() {
      for (const completion of completions) completion();
    },
  };
}

describe("portfolio snapshot loader", () => {
  test("returns live account state without waiting for history endpoints", async () => {
    const deferred = deferredReader();
    const pending = loadPortfolioAccountSnapshot({
      accounts: deferred.reader,
      network: "testnet",
      masterAccount: MASTER_ADDRESS,
      target: TARGET,
      markets: MARKET_FIXTURE,
      signal: new AbortController().signal,
      now: NOW,
    });

    expect(deferred.calls).toEqual([
      "state:native",
      "orders:native",
      "state:omega",
      "orders:omega",
      "spot",
    ]);
    deferred.complete();
    const snapshot = await pending;
    expect(snapshot.perpStates).toHaveLength(2);
    expect("fills" in snapshot).toBe(false);
  });

  test("starts every independent account source in one request wave", async () => {
    const deferred = deferredReader();
    const pending = loadPortfolioSnapshot({
      accounts: deferred.reader,
      network: "testnet",
      masterAccount: MASTER_ADDRESS,
      target: TARGET,
      markets: MARKET_FIXTURE,
      signal: new AbortController().signal,
      now: NOW,
    });

    expect(deferred.calls).toEqual([
      "state:native",
      "orders:native",
      "state:omega",
      "orders:omega",
      "spot",
      "fills",
      "funding",
      "portfolio",
    ]);

    deferred.complete();
    const snapshot = await pending;
    expect(snapshot.perpStates.map((source) => source.dexName)).toEqual([
      "",
      "omega",
    ]);
    expect(snapshot.sourceGaps).toEqual([]);
  });

  test("keeps successful sources when concurrent requests partially fail", async () => {
    const deferred = deferredReader(
      new Set(["state:native", "orders:omega", "spot"]),
    );
    const pending = loadPortfolioSnapshot({
      accounts: deferred.reader,
      network: "testnet",
      masterAccount: MASTER_ADDRESS,
      target: TARGET,
      markets: MARKET_FIXTURE,
      signal: new AbortController().signal,
      now: NOW,
    });

    deferred.complete();
    const snapshot = await pending;

    expect(snapshot.perpStates).toHaveLength(1);
    expect(snapshot.perpStates[0]?.dexName).toBe("omega");
    expect(snapshot.perpStates[0]?.openOrders).toEqual([]);
    expect(snapshot.spotState).toEqual({ balances: [] });
    expect(snapshot.sourceGaps).toEqual([
      "Perpetual account source native was unavailable.",
      "Open orders for perpetual source omega were unavailable.",
      "Spot balances were unavailable.",
    ]);
  });
});
