import { describe, expect, test } from "bun:test";

import { createStreamRuntime, type StreamDeclaration } from "./runtime";

describe("stream runtime declarations", () => {
  test("stays disconnected when empty and tears down the last declaration", async () => {
    let connections = 0;
    let closes = 0;
    const openedNetworks: string[] = [];
    let baselineApplied: () => void = () => undefined;
    const applied = new Promise<void>((resolve) => {
      baselineApplied = resolve;
    });
    const runtime = createStreamRuntime({
      openConnection: async ({ network }) => {
        connections += 1;
        openedNetworks.push(network);
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
    expect(openedNetworks).toEqual(["testnet"]);

    remove();
    await Promise.resolve();
    expect(closes).toBe(1);
    runtime.close();
  });

  test("reference-counts matching declarations without opening duplicate subscriptions", async () => {
    let subscriptions = 0;
    let unsubscriptions = 0;
    let baselineApplied: () => void = () => undefined;
    const applied = new Promise<void>((resolve) => {
      baselineApplied = resolve;
    });
    const runtime = createStreamRuntime({
      openConnection: async () => ({
        subscribe: () => {
          subscriptions += 1;
          return () => {
            unsubscriptions += 1;
          };
        },
        ping: () => undefined,
        close: () => undefined,
      }),
      setTimeout: () => 1,
      clearTimeout: () => undefined,
    });
    const declaration = () => ({
      wire: {
        key: "book:BTC",
        subscription: { type: "l2Book" as const, coin: "BTC" },
        decode: () => [],
      },
      loadBaseline: async () => ({ data: {} }),
      applyBaseline: () => baselineApplied(),
      applyDelta: () => undefined,
    });

    runtime.setForeground(true);
    runtime.setOnline(true);
    const removeFirst = runtime.declare(declaration());
    await applied;
    const removeSecond = runtime.declare(declaration());
    await Promise.resolve();

    expect(subscriptions).toBe(1);
    removeFirst();
    expect(unsubscriptions).toBe(0);
    removeSecond();
    await Promise.resolve();
    await Promise.resolve();
    expect(unsubscriptions).toBe(1);
    runtime.close();
  });

  test("rejects a reused key with a different wire subscription", () => {
    const runtime = createStreamRuntime();
    const remove = runtime.declare({
      wire: {
        key: "activity",
        subscription: { type: "l2Book", coin: "BTC" },
        decode: () => [],
      },
      loadBaseline: async () => ({ data: {} }),
      applyBaseline: () => undefined,
      applyDelta: () => undefined,
    });

    expect(() =>
      runtime.declare({
        wire: {
          key: "activity",
          subscription: { type: "trades", coin: "BTC" },
          decode: () => [],
        },
        loadBaseline: async () => ({ data: {} }),
        applyBaseline: () => undefined,
        applyDelta: () => undefined,
      }),
    ).toThrow("conflicts with its active subscription");

    remove();
    runtime.close();
  });

  test("does not multiplex account channels whose payload omits the user", () => {
    const runtime = createStreamRuntime();
    const userA = "0x1111111111111111111111111111111111111111";
    const userB = "0x2222222222222222222222222222222222222222";
    const declaration = (key: string, user: string): StreamDeclaration => ({
      wire: {
        key,
        subscription: { type: "orderUpdates", user },
        decode: () => [],
      },
      loadBaseline: async () => ({ data: null }),
      applyBaseline: () => undefined,
      applyDelta: () => undefined,
    });
    const remove = runtime.declare(declaration("orders-a", userA));

    expect(() => runtime.declare(declaration("orders-b", userB))).toThrow(
      "cannot multiplex different accounts",
    );

    remove();
    expect(() => runtime.declare(declaration("orders-b", userB))).not.toThrow();
    runtime.close();
  });
});
