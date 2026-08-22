import { describe, expect, test } from "bun:test";

import { MarketCatalogServiceRuntime } from "./catalog-service-runtime";

describe("standalone market catalog runtime", () => {
  test("starts, synchronizes, and stops cleanly on cancellation", async () => {
    const calls: string[] = [];
    const controller = new AbortController();
    const delays: number[] = [];
    let runs = 0;
    const runtime = new MarketCatalogServiceRuntime({
      server: {
        start: async () => {
          calls.push("start");
        },
        stop: async () => {
          calls.push("stop");
        },
      },
      synchronizer: {
        runOnce: async () => {
          runs += 1;
          calls.push(`sync:${runs}`);
          return runs === 1;
        },
      },
      sleep: async (milliseconds) => {
        delays.push(milliseconds);
        if (runs === 2) controller.abort(new Error("test complete"));
      },
    });

    await runtime.run(controller.signal);

    expect(calls).toEqual(["start", "sync:1", "sync:2", "stop"]);
    expect(delays).toEqual([1_000, 30_000]);
  });

  test("stops the listener when synchronization fails", async () => {
    const calls: string[] = [];
    const runtime = new MarketCatalogServiceRuntime({
      server: {
        start: async () => {
          calls.push("start");
        },
        stop: async () => {
          calls.push("stop");
        },
      },
      synchronizer: {
        runOnce: async () => {
          throw new Error("database unavailable");
        },
      },
    });

    await expect(runtime.run(new AbortController().signal)).rejects.toThrow(
      "database unavailable",
    );
    expect(calls).toEqual(["start", "stop"]);
  });
});
