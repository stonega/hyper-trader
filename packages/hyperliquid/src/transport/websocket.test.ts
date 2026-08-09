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
    receive(JSON.stringify({ channel: "trades", data: [{ coin: "ETH" }] }));
    receive(JSON.stringify({ channel: "l2Book", data: { coin: "ETH" } }));

    expect(btc).toEqual(["BTC"]);
    expect(eth).toEqual(["ETH"]);
    expect(sent.map((value) => JSON.parse(value))).toEqual([
      { method: "subscribe", subscription: { type: "l2Book", coin: "BTC" } },
      { method: "subscribe", subscription: { type: "l2Book", coin: "ETH" } },
    ]);
  });
});
