import { describe, expect, test } from "bun:test";

import {
  createForegroundStreamManager,
  type ManagedStreamConnection,
  type ManagedStreamMessage,
} from "./manager";

function createHarness() {
  const events: string[] = [];
  const delivered: ManagedStreamMessage[] = [];
  const sockets: Array<{
    emit(message: ManagedStreamMessage): void;
    close(): void;
  }> = [];
  const manager = createForegroundStreamManager({
    connect: async (): Promise<ManagedStreamConnection> => {
      let listener: (message: ManagedStreamMessage) => void = () => undefined;
      const connection = {
        subscribe(
          _subscription: unknown,
          next: (message: ManagedStreamMessage) => void,
        ) {
          listener = next;
          return () => undefined;
        },
        ping() {
          events.push("ping");
        },
        close() {
          events.push("close");
        },
      };
      sockets.push({
        emit: (message) => listener(message),
        close: connection.close,
      });
      return connection;
    },
    loadBaseline: async () => {
      events.push("baseline");
      return { sequence: 10, data: { price: "10" } };
    },
    applyBaseline: (_key, baseline) =>
      events.push(`apply:${baseline.sequence}`),
    applyDelta: (_key, message) => delivered.push(message),
    setTimeout: (callback) => {
      callback();
      return 1;
    },
    clearTimeout: () => undefined,
    random: () => 0,
    maxReconnectAttempts: 0,
  });
  manager.setSubscriptions([
    { key: "book:BTC", wire: { type: "l2Book", coin: "BTC" } },
  ]);
  return { manager, events, delivered, sockets };
}

describe("foreground stream manager", () => {
  test("does not connect until at least one subscription is declared", async () => {
    let connections = 0;
    let closes = 0;
    const manager = createForegroundStreamManager({
      connect: async () => {
        connections += 1;
        return {
          subscribe: () => () => undefined,
          ping: () => undefined,
          close: () => {
            closes += 1;
          },
        };
      },
      loadBaseline: async () => ({ data: {} }),
      applyBaseline: () => undefined,
      applyDelta: () => undefined,
      setTimeout: () => 1,
      clearTimeout: () => undefined,
    });

    await manager.setEnvironment({ foreground: true, online: true });
    expect(connections).toBe(0);
    manager.setSubscriptions([
      { key: "book:BTC", wire: { type: "l2Book", coin: "BTC" } },
    ]);
    await manager.whenIdle();
    expect(connections).toBe(1);
    manager.setSubscriptions([]);
    await manager.whenIdle();
    expect(closes).toBe(1);
  });

  test("applies the HTTP baseline before accepting deltas and drops duplicates", async () => {
    const { manager, events, delivered, sockets } = createHarness();
    await manager.setEnvironment({ foreground: true, online: true });
    sockets[0]?.emit({
      key: "book:BTC",
      sequence: 11,
      stableId: "snapshot",
      data: {},
      isSnapshot: true,
    });
    sockets[0]?.emit({
      key: "book:BTC",
      sequence: 11,
      stableId: "a",
      data: {},
    });
    sockets[0]?.emit({
      key: "book:BTC",
      sequence: 11,
      stableId: "a",
      data: {},
    });

    expect(events.filter((event) => event !== "ping").slice(0, 2)).toEqual([
      "baseline",
      "apply:10",
    ]);
    expect(delivered.map(({ sequence }) => sequence)).toEqual([11]);
  });

  test("bounds baseline refreshes for a persistent sequence gap", async () => {
    const { manager, events, delivered, sockets } = createHarness();
    await manager.setEnvironment({ foreground: true, online: true });
    sockets[0]?.emit({
      key: "book:BTC",
      sequence: 12,
      stableId: "gap",
      data: {},
    });
    await manager.whenIdle();

    expect(events.filter((event) => event === "baseline")).toHaveLength(3);
    expect(events.filter((event) => event === "close")).toHaveLength(1);
    expect(delivered).toHaveLength(0);
  });

  test("tears down offline and reconnects with a fresh baseline", async () => {
    const { manager, events } = createHarness();
    await manager.setEnvironment({ foreground: true, online: true });
    await manager.setEnvironment({ foreground: true, online: false });
    await manager.setEnvironment({ foreground: true, online: true });

    expect(events.filter((event) => event === "close")).toHaveLength(1);
    expect(events.filter((event) => event === "baseline")).toHaveLength(2);
  });

  test("ignores messages from a stale connection generation", async () => {
    const { manager, delivered, sockets } = createHarness();
    await manager.setEnvironment({ foreground: true, online: true });
    const oldSocket = sockets[0];
    await manager.setEnvironment({ foreground: true, online: false });
    await manager.setEnvironment({ foreground: true, online: true });

    oldSocket?.emit({
      key: "book:BTC",
      sequence: 11,
      stableId: "old",
      data: {},
    });
    sockets[1]?.emit({
      key: "book:BTC",
      sequence: 11,
      stableId: "new",
      data: {},
    });

    expect(delivered.map(({ stableId }) => stableId)).toEqual(["new"]);
  });

  test("does not apply a baseline that resolves after its generation stops", async () => {
    let resolveBaseline: (value: { sequence: number; data: unknown }) => void =
      () => undefined;
    const applied: number[] = [];
    let connections = 0;
    const manager = createForegroundStreamManager({
      connect: async () => {
        connections += 1;
        return {
          subscribe: () => () => undefined,
          ping: () => undefined,
          close: () => undefined,
        };
      },
      loadBaseline: () =>
        new Promise((resolve) => {
          resolveBaseline = resolve;
        }),
      applyBaseline: (_key, baseline) => applied.push(baseline.sequence ?? -1),
      applyDelta: () => undefined,
      setTimeout: () => 1,
      clearTimeout: () => undefined,
    });
    manager.setSubscriptions([
      { key: "book:BTC", wire: { type: "l2Book", coin: "BTC" } },
    ]);

    const starting = manager.setEnvironment({ foreground: true, online: true });
    await Promise.resolve();
    await manager.setEnvironment({ foreground: true, online: false });
    resolveBaseline({ sequence: 10, data: {} });
    await starting;

    expect(applied).toEqual([]);
    expect(connections).toBe(1);
  });

  test("buffers a delta that arrives while the initial baseline is loading", async () => {
    let emit: (message: ManagedStreamMessage) => void = () => undefined;
    let resolveBaseline: (value: { sequence: number; data: unknown }) => void =
      () => undefined;
    const events: string[] = [];
    const manager = createForegroundStreamManager({
      connect: async () => ({
        subscribe: (_subscription, listener) => {
          emit = listener;
          return () => undefined;
        },
        ping: () => undefined,
        close: () => undefined,
      }),
      loadBaseline: () =>
        new Promise((resolve) => {
          resolveBaseline = resolve;
        }),
      applyBaseline: (_key, baseline) =>
        events.push(`baseline:${baseline.sequence}`),
      applyDelta: (_key, delta) => events.push(`delta:${delta.sequence}`),
      setTimeout: () => 1,
      clearTimeout: () => undefined,
    });
    manager.setSubscriptions([
      { key: "book:BTC", wire: { type: "l2Book", coin: "BTC" } },
    ]);

    const starting = manager.setEnvironment({ foreground: true, online: true });
    await Promise.resolve();
    await Promise.resolve();
    emit({ key: "book:BTC", sequence: 11, stableId: "eleven", data: {} });
    resolveBaseline({ sequence: 10, data: {} });
    await starting;

    expect(events).toEqual(["baseline:10", "delta:11"]);
  });

  test("keeps a newer generation ready when an old baseline resolves late", async () => {
    const resolvers: Array<
      (value: { sequence: number; data: unknown }) => void
    > = [];
    const sockets: Array<(message: ManagedStreamMessage) => void> = [];
    const applied: string[] = [];
    const manager = createForegroundStreamManager({
      connect: async () => {
        let emit: (message: ManagedStreamMessage) => void = () => undefined;
        sockets.push((message) => emit(message));
        return {
          subscribe: (_subscription, listener) => {
            emit = listener;
            return () => undefined;
          },
          ping: () => undefined,
          close: () => undefined,
        };
      },
      loadBaseline: () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
      applyBaseline: (_key, baseline) =>
        applied.push(`baseline:${baseline.sequence}`),
      applyDelta: (_key, delta) => applied.push(`delta:${delta.sequence}`),
      setTimeout: () => 1,
      clearTimeout: () => undefined,
    });
    manager.setSubscriptions([
      { key: "book:BTC", wire: { type: "l2Book", coin: "BTC" } },
    ]);

    const oldStart = manager.setEnvironment({ foreground: true, online: true });
    await Promise.resolve();
    await Promise.resolve();
    await manager.setEnvironment({ foreground: true, online: false });
    const newStart = manager.setEnvironment({ foreground: true, online: true });
    await Promise.resolve();
    await Promise.resolve();

    resolvers[0]?.({ sequence: 5, data: {} });
    await oldStart;
    resolvers[1]?.({ sequence: 10, data: {} });
    await newStart;
    sockets[1]?.({ key: "book:BTC", sequence: 11, stableId: "new", data: {} });

    expect(applied).toEqual(["baseline:10", "delta:11"]);
  });
});
