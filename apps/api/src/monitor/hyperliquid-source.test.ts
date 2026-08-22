import { describe, expect, test } from "bun:test";
import type {
  PublicHyperliquidClient,
  WebSocketConnection,
} from "@hyper-trader/hyperliquid/public";

import {
  HyperliquidMonitorSource,
  HyperliquidPublicStreamPool,
} from "./hyperliquid-source";

class FakeConnection implements WebSocketConnection {
  readonly sent: string[] = [];
  readonly messages = new Set<(data: unknown) => void>();
  readonly closes = new Set<() => void>();

  send(data: string) {
    this.sent.push(data);
  }

  close() {}

  addMessageListener(listener: (data: unknown) => void) {
    this.messages.add(listener);
    return () => this.messages.delete(listener);
  }

  addCloseListener(listener: () => void) {
    this.closes.add(listener);
    return () => this.closes.delete(listener);
  }

  emit(data: unknown) {
    for (const listener of this.messages) listener(data);
  }
}

describe("Hyperliquid notification monitor source", () => {
  test("loads an authoritative public snapshot before opening the market shard", async () => {
    const connections: FakeConnection[] = [];
    const streams = new HyperliquidPublicStreamPool({
      open: () => {
        const connection = new FakeConnection();
        connections.push(connection);
        return connection;
      },
    });
    const client = {
      network: "testnet",
      getMarketCatalog: async () => ({
        markets: [
          {
            family: "perp",
            canonicalId: "perp:0:0",
            coin: "BTC",
            dexName: "",
            markPx: "100000",
            funding: "0.0001",
          },
        ],
        quarantined: [],
        sourceErrors: [],
      }),
    } as unknown as PublicHyperliquidClient;
    const source = new HyperliquidMonitorSource({
      clients: { testnet: client, mainnet: client },
      streams,
    });
    const controller = new AbortController();
    const target = {
      kind: "market" as const,
      network: "testnet" as const,
      marketId: "perp:0:0",
    };
    expect(
      await source.loadAuthoritativeSnapshot(target, controller.signal),
    ).toMatchObject({
      kind: "market-snapshot",
      market: { canonicalId: "perp:0:0", coin: "BTC" },
    });
    const deltas: unknown[] = [];
    const close = await source.openStream(
      target,
      { onDelta: (delta) => deltas.push(delta), onGap: () => undefined },
      controller.signal,
    );
    expect(connections).toHaveLength(1);
    connections[0]?.emit({
      channel: "activeAssetCtx",
      data: { coin: "BTC", ctx: { markPx: "100001" } },
    });
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toMatchObject({
      kind: "stream-delta",
      message: { channel: "activeAssetCtx" },
    });
    close();
    expect(streams.usage().connections).toBe(0);
  });

  test("shares market subscriptions and recovers capacity after overload", async () => {
    const connections: FakeConnection[] = [];
    const streams = new HyperliquidPublicStreamPool({
      open: () => {
        const connection = new FakeConnection();
        connections.push(connection);
        return connection;
      },
    });
    const controllers = Array.from({ length: 8 }, () => new AbortController());
    const closeMarketA = await streams.openMarket({
      network: "testnet",
      marketId: "perp:0:0",
      coin: "BTC",
      onDelta: () => undefined,
      onGap: () => undefined,
      signal: controllers[0]?.signal as AbortSignal,
    });
    const closeMarketB = await streams.openMarket({
      network: "testnet",
      marketId: "perp:0:1",
      coin: "ETH",
      onDelta: () => undefined,
      onGap: () => undefined,
      signal: controllers[1]?.signal as AbortSignal,
    });
    expect(streams.usage().connections).toBe(1);
    const accountCloses: Array<() => void> = [];
    for (let index = 0; index < 6; index += 1) {
      accountCloses.push(
        await streams.openAccount({
          network: "testnet",
          address: `0x${index.toString(16).padStart(40, "0")}`,
          onDelta: () => undefined,
          onGap: () => undefined,
          signal: controllers[index + 2]?.signal as AbortSignal,
        }),
      );
    }
    expect(streams.usage().connections).toBe(7);
    await expect(
      streams.openAccount({
        network: "testnet",
        address: `0x${"f".repeat(40)}`,
        onDelta: () => undefined,
        onGap: () => undefined,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("capacity");
    accountCloses.pop()?.();
    const recovered = await streams.openAccount({
      network: "testnet",
      address: `0x${"e".repeat(40)}`,
      onDelta: () => undefined,
      onGap: () => undefined,
      signal: new AbortController().signal,
    });
    expect(streams.usage().connections).toBe(7);
    recovered();
    for (const close of accountCloses) close();
    closeMarketB();
    closeMarketA();
    expect(streams.usage().connections).toBe(0);
  });

  test("enforces the shared fourteen-hundred-message window and releases failed admission", async () => {
    const connections: FakeConnection[] = [];
    const streams = new HyperliquidPublicStreamPool({
      now: () => 50_000,
      open: () => {
        const connection = new FakeConnection();
        connections.push(connection);
        return connection;
      },
    });
    const closes: Array<() => void> = [];
    for (let index = 0; index < 700; index += 1) {
      closes.push(
        await streams.openMarket({
          network: "testnet",
          marketId: `perp:0:${index}`,
          coin: `COIN-${index}`,
          onDelta: () => undefined,
          onGap: () => undefined,
          signal: new AbortController().signal,
        }),
      );
      const request = JSON.parse(connections[0]?.sent.at(-1) ?? "{}") as {
        subscription: unknown;
      };
      connections[0]?.emit({
        channel: "subscriptionResponse",
        data: { subscription: request.subscription },
      });
    }
    for (const [index, close] of closes.entries()) {
      close();
      if (index < closes.length - 1) {
        const request = JSON.parse(connections[0]?.sent.at(-1) ?? "{}") as {
          subscription: unknown;
        };
        connections[0]?.emit({
          channel: "subscriptionResponse",
          data: { subscription: request.subscription },
        });
      }
    }
    expect(connections[0]?.sent).toHaveLength(1_400);
    await expect(
      streams.openMarket({
        network: "testnet",
        marketId: "perp:0:700",
        coin: "COIN-700",
        onDelta: () => undefined,
        onGap: () => undefined,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("send failed");
    expect(streams.usage().connections).toBe(0);
  });

  test("coalesces catalog reads and fetches global account history once across more than five DEXes", async () => {
    let catalogCalls = 0;
    let globalCalls = 0;
    const dexCalls: string[] = [];
    const markets = Array.from({ length: 6 }, (_, index) => ({
      family: "perp" as const,
      canonicalId: `perp:${index}:0`,
      coin: `dex${index}:COIN`,
      dexName: index === 0 ? "" : `dex${index}`,
    }));
    const client = {
      network: "testnet",
      getRequestBudget: (requestType: string, responseItemCount?: number) => ({
        requestType,
        baseWeight: requestType === "clearinghouseState" ? 2 : 20,
        totalWeight:
          (requestType === "clearinghouseState" ? 2 : 20) +
          (responseItemCount === undefined ? 0 : 25),
      }),
      getMarketCatalog: async (options?: {
        onRequestBudget?: (budget: { totalWeight: number }) => void;
      }) => {
        catalogCalls += 1;
        options?.onRequestBudget?.({ totalWeight: 20 });
        return { markets, quarantined: [], sourceErrors: [] };
      },
      getNotificationAccountGlobalSnapshot: async (
        _request: unknown,
        options?: {
          onRequestBudget?: (budget: { totalWeight: number }) => void;
        },
      ) => {
        globalCalls += 1;
        for (const totalWeight of [20, 20, 20]) {
          options?.onRequestBudget?.({ totalWeight });
        }
        return {
          user: `0x${"11".repeat(20)}`,
          historicalOrders: [],
          fills: [],
          funding: [],
        };
      },
      getNotificationAccountDexSnapshot: async (
        request: { dex: string },
        options?: {
          onRequestBudget?: (budget: { totalWeight: number }) => void;
        },
      ) => {
        dexCalls.push(request.dex);
        options?.onRequestBudget?.({ totalWeight: 2 });
        options?.onRequestBudget?.({ totalWeight: 20 });
        return {
          user: `0x${"11".repeat(20)}`,
          dex: request.dex,
          clearinghouse: { positions: [], marginSummary: {} },
          openOrders: [],
        };
      },
    } as unknown as PublicHyperliquidClient;
    const streams = new HyperliquidPublicStreamPool({
      open: () => new FakeConnection(),
    });
    const source = new HyperliquidMonitorSource({
      clients: { testnet: client, mainnet: client },
      streams,
    });
    const signal = new AbortController().signal;
    const snapshots = await Promise.all([
      source.loadAuthoritativeSnapshot(
        {
          kind: "account",
          network: "testnet",
          address: `0x${"11".repeat(20)}`,
        },
        signal,
      ),
      source.loadAuthoritativeSnapshot(
        {
          kind: "account",
          network: "testnet",
          address: `0x${"22".repeat(20)}`,
        },
        signal,
      ),
    ]);
    expect(catalogCalls).toBe(1);
    expect(globalCalls).toBe(2);
    expect(dexCalls).toHaveLength(12);
    expect(snapshots[0]).toMatchObject({
      kind: "account-snapshot",
      snapshots: { length: 6 },
    });
  });

  test("aborts a coalesced catalog request after its last consumer leaves and permits recovery", async () => {
    let catalogCalls = 0;
    let upstreamAborts = 0;
    const catalog = {
      markets: [
        {
          family: "perp" as const,
          canonicalId: "perp:0:0",
          coin: "BTC",
          dexName: "",
        },
      ],
      quarantined: [],
      sourceErrors: [],
    };
    const client = {
      network: "testnet",
      getMarketCatalog: (options?: { signal?: AbortSignal }) => {
        catalogCalls += 1;
        if (catalogCalls > 1) return Promise.resolve(catalog);
        return new Promise<typeof catalog>((_resolve, reject) => {
          options?.signal?.addEventListener(
            "abort",
            () => {
              upstreamAborts += 1;
              reject(options.signal?.reason);
            },
            { once: true },
          );
        });
      },
    } as unknown as PublicHyperliquidClient;
    const source = new HyperliquidMonitorSource({
      clients: { testnet: client, mainnet: client },
      streams: new HyperliquidPublicStreamPool({
        open: () => new FakeConnection(),
      }),
    });
    const first = new AbortController();
    const second = new AbortController();
    const requests = Promise.allSettled([
      source.loadAuthoritativeSnapshot(
        { kind: "market", network: "testnet", marketId: "perp:0:0" },
        first.signal,
      ),
      source.loadAuthoritativeSnapshot(
        { kind: "market", network: "testnet", marketId: "perp:0:0" },
        second.signal,
      ),
    ]);
    first.abort(new Error("first consumer left"));
    second.abort(new Error("second consumer left"));
    expect((await requests).map((result) => result.status)).toEqual([
      "rejected",
      "rejected",
    ]);
    await waitUntil(() => upstreamAborts === 1);
    expect(
      await source.loadAuthoritativeSnapshot(
        { kind: "market", network: "testnet", marketId: "perp:0:0" },
        new AbortController().signal,
      ),
    ).toMatchObject({ kind: "market-snapshot" });
    expect(catalogCalls).toBe(2);
  });

  test("closes a delayed market opening when every waiter aborts", async () => {
    const connection = new FakeConnection();
    let closes = 0;
    connection.close = () => {
      closes += 1;
    };
    let resolveOpen: ((connection: WebSocketConnection) => void) | undefined;
    let openingSignal: AbortSignal | undefined;
    const streams = new HyperliquidPublicStreamPool({
      open: (_url, options) => {
        openingSignal = options.signal;
        return new Promise<WebSocketConnection>((resolve) => {
          resolveOpen = resolve;
        });
      },
    });
    const firstController = new AbortController();
    const secondController = new AbortController();
    const open = (controller: AbortController, marketId: string) =>
      streams.openMarket({
        network: "testnet",
        marketId,
        coin: marketId,
        onDelta: () => undefined,
        onGap: () => undefined,
        signal: controller.signal,
      });
    const first = open(firstController, "perp:0:0");
    const second = open(secondController, "perp:0:1");
    const settled = Promise.allSettled([first, second]);
    firstController.abort(new Error("first cancelled"));
    secondController.abort(new Error("second cancelled"));
    resolveOpen?.(connection);
    const outcomes = await settled;
    await waitUntil(() => openingSignal?.aborted === true);
    expect(outcomes.map((outcome) => outcome.status)).toEqual([
      "rejected",
      "rejected",
    ]);
    expect(
      outcomes.map((outcome) =>
        outcome.status === "rejected" && outcome.reason instanceof Error
          ? outcome.reason.message
          : "",
      ),
    ).toEqual(["first cancelled", "second cancelled"]);
    await waitUntil(() => closes === 1);
    expect(closes).toBe(1);
    expect(openingSignal?.aborted).toBe(true);
    expect(streams.usage().connections).toBe(0);
  });

  test("keeps a delayed shared market opening when one waiter survives", async () => {
    const connection = new FakeConnection();
    let resolveOpen: ((connection: WebSocketConnection) => void) | undefined;
    const streams = new HyperliquidPublicStreamPool({
      open: () =>
        new Promise<WebSocketConnection>((resolve) => {
          resolveOpen = resolve;
        }),
    });
    const cancelledController = new AbortController();
    const survivingController = new AbortController();
    const cancelled = streams.openMarket({
      network: "testnet",
      marketId: "perp:0:0",
      coin: "BTC",
      onDelta: () => undefined,
      onGap: () => undefined,
      signal: cancelledController.signal,
    });
    const surviving = streams.openMarket({
      network: "testnet",
      marketId: "perp:0:1",
      coin: "ETH",
      onDelta: () => undefined,
      onGap: () => undefined,
      signal: survivingController.signal,
    });
    cancelledController.abort(new Error("cancelled"));
    resolveOpen?.(connection);
    await expect(cancelled).rejects.toThrow("cancelled");
    const close = await surviving;
    expect(streams.usage().connections).toBe(1);
    close();
    expect(streams.usage().connections).toBe(0);
  });
});

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error("test condition did not become ready");
}
