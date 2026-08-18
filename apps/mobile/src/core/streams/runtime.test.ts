import { describe, expect, test } from "bun:test";

import { createStreamRuntime } from "./runtime";

describe("stream runtime declarations", () => {
  test("stays disconnected when empty and tears down the last declaration", async () => {
    let connections = 0;
    let closes = 0;
    let baselineApplied: () => void = () => undefined;
    const applied = new Promise<void>((resolve) => {
      baselineApplied = resolve;
    });
    const runtime = createStreamRuntime({
      openConnection: async () => {
        connections += 1;
        return {
          subscribe: () => () => undefined,
          ping: () => undefined,
          close: () => {
            closes += 1;
          },
        };
      },
      setTimeout: () => 1,
      clearTimeout: () => undefined,
    });

    runtime.setForeground(true);
    runtime.setOnline(true);
    await Promise.resolve();
    expect(connections).toBe(0);

    const remove = runtime.declare({
      wire: {
        key: "book:BTC",
        subscription: { type: "l2Book", coin: "BTC" },
        decode: () => [],
      },
      loadBaseline: async () => ({ sequence: 10, data: {} }),
      applyBaseline: () => baselineApplied(),
      applyDelta: () => undefined,
    });
    await applied;
    expect(connections).toBe(1);

    remove();
    await Promise.resolve();
    expect(closes).toBe(1);
    runtime.close();
  });
});
