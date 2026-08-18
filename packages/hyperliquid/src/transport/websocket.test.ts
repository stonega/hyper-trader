import { describe, expect, test } from "bun:test";

import {
  openPublicWebSocketSession,
  type WebSocketConnection,
} from "./websocket";

describe("public WebSocket boundary", () => {
  test("routes simultaneous subscriptions without cross-talk", async () => {
    const sent: string[] = [];
    let receive: (data: unknown) => void = () => undefined;
    const connection: WebSocketConnection = {
      send(data) {
        sent.push(data);
      },
      close() {},
      addMessageListener(listener) {
        receive = listener;
        return () => undefined;
      },
    };
    const session = await openPublicWebSocketSession({
      network: "testnet",
      open: async (url) => {
        expect(url).toBe("wss://api.hyperliquid-testnet.xyz/ws");
        return connection;
      },
    });
    const btc: string[] = [];
    const eth: string[] = [];
    session.subscribe({ type: "l2Book", coin: "BTC" }, ({ data }) => {
      btc.push((data as { coin: string }).coin);
    });
    session.subscribe({ type: "l2Book", coin: "ETH" }, ({ data }) => {
      eth.push((data as { coin: string }).coin);
    });

    receive(JSON.stringify({ channel: "l2Book", data: { coin: "BTC" } }));
    receive(JSON.stringify({ channel: "l2Book", data: { coin: "ETH" } }));

    expect(btc).toEqual(["BTC"]);
    expect(eth).toEqual(["ETH"]);
    expect(sent.map((value) => JSON.parse(value))).toEqual([
      { method: "subscribe", subscription: { type: "l2Book", coin: "BTC" } },
      { method: "subscribe", subscription: { type: "l2Book", coin: "ETH" } },
    ]);
    session.close();
  });

  test("validates before opening and gaps closed on malformed or mismatched data", async () => {
    let opens = 0;
    await expect(
      openPublicWebSocketSession({
        maxSubscriptions: 701,
        open: () => {
          opens += 1;
          throw new Error("must not open");
        },
      }),
    ).rejects.toThrow("seventy percent");
    expect(opens).toBe(0);

    let receive: (data: unknown) => void = () => undefined;
    let gaps = 0;
    let closes = 0;
    const session = await openPublicWebSocketSession({
      open: () => ({
        send() {},
        close: () => {
          closes += 1;
        },
        addMessageListener(listener) {
          receive = listener;
          return () => undefined;
        },
      }),
      onGap: () => {
        gaps += 1;
      },
    });
    session.subscribe({ type: "l2Book", coin: "BTC" }, () => undefined);
    receive({ channel: "l2Book", data: { coin: "ETH" } });
    expect(gaps).toBe(1);
    expect(closes).toBe(1);
    expect(() =>
      session.subscribe({ type: "l2Book", coin: "ETH" }, () => undefined),
    ).toThrow("closed");
  });

  test("rolls back state and closes when subscribe, unsubscribe, or heartbeat send fails", async () => {
    let heartbeat: (() => void) | undefined;
    let sends = 0;
    let gaps = 0;
    const session = await openPublicWebSocketSession({
      open: () => ({
        send() {
          sends += 1;
          if (sends === 2) throw new Error("wire failed");
        },
        close() {},
        addMessageListener() {
          return () => undefined;
        },
      }),
      onGap: () => {
        gaps += 1;
      },
      scheduleHeartbeat(callback) {
        heartbeat = callback;
        return () => {
          heartbeat = undefined;
        };
      },
    });
    session.subscribe({ type: "allMids" }, () => undefined);
    heartbeat?.();
    expect(gaps).toBe(1);
    expect(heartbeat).toBeUndefined();

    let unsubscribeSends = 0;
    let unsubscribeGaps = 0;
    const unsubscribeSession = await openPublicWebSocketSession({
      open: () => ({
        send() {
          unsubscribeSends += 1;
          if (unsubscribeSends === 2) throw new Error("unsubscribe failed");
        },
        close() {},
        addMessageListener() {
          return () => undefined;
        },
      }),
      onGap: () => {
        unsubscribeGaps += 1;
      },
    });
    const unsubscribe = unsubscribeSession.subscribe(
      { type: "allMids" },
      () => undefined,
    );
    expect(() => unsubscribe()).not.toThrow();
    expect(unsubscribeGaps).toBe(1);
  });

  test("routes multiplexable account streams and rejects ambiguous user channels", async () => {
    const sent: string[] = [];
    let receive: (data: unknown) => void = () => undefined;
    const session = await openPublicWebSocketSession({
      network: "testnet",
      open: () => ({
        send: (data) => sent.push(data),
        close() {},
        addMessageListener(listener) {
          receive = listener;
          return () => undefined;
        },
      }),
    });
    const userA = `0x${"11".repeat(20)}`;
    const userB = `0x${"22".repeat(20)}`;
    const fillsA: string[] = [];
    const fillsB: string[] = [];
    session.subscribe({ type: "userFills", user: userA }, ({ data }) => {
      fillsA.push((data as { user: string }).user);
    });
    session.subscribe({ type: "userFills", user: userB }, ({ data }) => {
      fillsB.push((data as { user: string }).user);
    });
    session.subscribe({ type: "orderUpdates", user: userA }, () => undefined);
    expect(() =>
      session.subscribe({ type: "orderUpdates", user: userB }, () => undefined),
    ).toThrow("cannot multiplex");

    receive({ channel: "userFills", data: { user: userA, fills: [] } });
    receive({ channel: "userFills", data: { user: userB, fills: [] } });
    expect(fillsA).toEqual([userA]);
    expect(fillsB).toEqual([userB]);
    expect(sent).toHaveLength(3);
    session.close();
  });

  test("sends the documented heartbeat and bounds subscriptions below seventy percent", async () => {
    const sent: string[] = [];
    let heartbeat: (() => void) | undefined;
    const session = await openPublicWebSocketSession({
      open: () => ({
        send: (data) => sent.push(data),
        close() {},
        addMessageListener() {
          return () => undefined;
        },
      }),
      scheduleHeartbeat(callback, milliseconds) {
        expect(milliseconds).toBe(50_000);
        heartbeat = callback;
        return () => {
          heartbeat = undefined;
        };
      },
      maxSubscriptions: 1,
    });
    session.subscribe({ type: "allMids" }, () => undefined);
    expect(() =>
      session.subscribe({ type: "trades", coin: "BTC" }, () => undefined),
    ).toThrow("capacity");
    heartbeat?.();
    expect(JSON.parse(sent.at(-1) ?? "{}")).toEqual({ method: "ping" });
    session.close();
    expect(heartbeat).toBeUndefined();
  });

  test("holds subscription-operation permits until an exact acknowledgement", async () => {
    let receive: (data: unknown) => void = () => undefined;
    let inflight = 0;
    const session = await openPublicWebSocketSession({
      open: () => ({
        send() {},
        close() {},
        addMessageListener(listener) {
          receive = listener;
          return () => undefined;
        },
      }),
      reserveSubscriptionOperation() {
        if (inflight >= 70) throw new Error("operation capacity");
        inflight += 1;
        let released = false;
        return () => {
          if (released) return;
          released = true;
          inflight -= 1;
        };
      },
    });
    for (let index = 0; index < 70; index += 1) {
      session.subscribe(
        { type: "activeAssetCtx", coin: `COIN-${index}` },
        () => undefined,
      );
    }
    expect(inflight).toBe(70);
    expect(() =>
      session.subscribe(
        { type: "activeAssetCtx", coin: "COIN-70" },
        () => undefined,
      ),
    ).toThrow("send failed");
    expect(inflight).toBe(0);

    const recovered = await openPublicWebSocketSession({
      open: () => ({
        send() {},
        close() {},
        addMessageListener(listener) {
          receive = listener;
          return () => undefined;
        },
      }),
      reserveSubscriptionOperation() {
        if (inflight >= 70) throw new Error("operation capacity");
        inflight += 1;
        return () => {
          inflight -= 1;
        };
      },
    });
    recovered.subscribe(
      { type: "activeAssetCtx", coin: "BTC" },
      () => undefined,
    );
    receive({
      channel: "subscriptionResponse",
      data: { subscription: { type: "activeAssetCtx", coin: "BTC" } },
    });
    expect(inflight).toBe(0);
    recovered.close();
  });

  test("releases an unacknowledged operation on its bounded timeout and closes the session", async () => {
    let timeout: (() => void) | undefined;
    let inflight = 0;
    let gaps = 0;
    let closes = 0;
    const session = await openPublicWebSocketSession({
      open: () => ({
        send() {},
        close() {
          closes += 1;
        },
        addMessageListener() {
          return () => undefined;
        },
      }),
      reserveSubscriptionOperation() {
        inflight += 1;
        return () => {
          inflight -= 1;
        };
      },
      scheduleOperationTimeout(callback, milliseconds) {
        expect(milliseconds).toBe(10_000);
        timeout = callback;
        return () => {
          timeout = undefined;
        };
      },
      onGap: () => {
        gaps += 1;
      },
    });
    session.subscribe({ type: "allMids" }, () => undefined);
    expect(inflight).toBe(1);
    timeout?.();
    expect(inflight).toBe(0);
    expect(gaps).toBe(1);
    expect(closes).toBe(1);
  });
});
