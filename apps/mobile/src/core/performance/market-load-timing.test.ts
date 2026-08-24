import { describe, expect, test } from "bun:test";

import {
  createMarketLoadTrace,
  isInitialMarketDataSettled,
  type MarketTimingEvent,
} from "./market-load-timing";

describe("market load timing", () => {
  test("records correlated step and total durations", () => {
    let now = 100;
    const events: MarketTimingEvent[] = [];
    const trace = createMarketLoadTrace(
      { network: "testnet", source: "catalog-query" },
      {
        enabled: true,
        now: () => now,
        write: (event) => events.push(event),
      },
    );

    const request = trace.startStep("backend:request");
    now = 112.34;
    request.finish({ status: 200 });
    now = 120;
    trace.record("catalog:parse", 3.26, { marketCount: 12 });

    expect(events).toEqual([
      {
        traceId: trace.traceId,
        source: "catalog-query",
        step: "backend:request",
        durationMs: 12.3,
        totalMs: 12.3,
        network: "testnet",
        status: 200,
      },
      {
        traceId: trace.traceId,
        source: "catalog-query",
        step: "catalog:parse",
        durationMs: 3.3,
        totalMs: 20,
        network: "testnet",
        marketCount: 12,
      },
    ]);
  });

  test("keeps disabled traces silent", () => {
    const events: MarketTimingEvent[] = [];
    const trace = createMarketLoadTrace(
      { source: "screen" },
      { enabled: false, write: (event) => events.push(event) },
    );

    trace.mark("screen:mounted");
    trace.startStep("screen:layout").finish();

    expect(events).toEqual([]);
  });

  test("waits for remote market data and local preferences to settle", () => {
    expect(
      isInitialMarketDataSettled({
        content: "ready",
        fetchStatus: "fetching",
        preferencesStatus: "ready",
      }),
    ).toBe(false);
    expect(
      isInitialMarketDataSettled({
        content: "ready",
        fetchStatus: "idle",
        preferencesStatus: "loading",
      }),
    ).toBe(false);
    expect(
      isInitialMarketDataSettled({
        content: "ready",
        fetchStatus: "idle",
        preferencesStatus: "ready",
      }),
    ).toBe(true);
    expect(
      isInitialMarketDataSettled({
        content: "unavailable",
        fetchStatus: "paused",
        preferencesStatus: "error",
      }),
    ).toBe(true);
  });
});
