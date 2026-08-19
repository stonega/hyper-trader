import { afterEach, describe, expect, test } from "bun:test";

import { openNativeManagedConnection } from "./native-websocket";

type FakeEvent = { readonly data?: unknown };
type FakeListener = (event: FakeEvent) => void;

class FakeWebSocket {
  static latest: FakeWebSocket | null = null;

  readonly sent: string[] = [];
  readonly listeners = new Map<string, Set<FakeListener>>();

  constructor(readonly url: string) {
    FakeWebSocket.latest = this;
  }

  addEventListener(type: string, listener: FakeListener): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: FakeListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.emit("close", {});
  }

  emit(type: string, event: FakeEvent): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

const originalWebSocket = globalThis.WebSocket;

afterEach(() => {
  Object.defineProperty(globalThis, "WebSocket", {
    configurable: true,
    value: originalWebSocket,
    writable: true,
  });
  FakeWebSocket.latest = null;
});

function installFakeWebSocket(): void {
  Object.defineProperty(globalThis, "WebSocket", {
    configurable: true,
    value: FakeWebSocket as unknown as typeof WebSocket,
    writable: true,
  });
}

async function openFakeConnection() {
  installFakeWebSocket();
  const controller = new AbortController();
  const opening = openNativeManagedConnection({
    network: "testnet",
    signal: controller.signal,
  });
  const socket = FakeWebSocket.latest;
  if (!socket) throw new Error("Expected a fake WebSocket instance.");
  socket.emit("open", {});
  return { connection: await opening, controller, socket };
}

describe("native managed WebSocket", () => {
  test("sends a heartbeat and disconnects when the prior heartbeat was unanswered", async () => {
    const { connection, socket } = await openFakeConnection();
    const errors: unknown[] = [];
    connection.onDisconnect?.((error) => errors.push(error));

    connection.ping();
    connection.ping();

    expect(socket.sent.map((message) => JSON.parse(message))).toEqual([
      { method: "ping" },
    ]);
    expect(errors).toHaveLength(1);
    expect(String(errors[0])).toContain("heartbeat timed out");
    connection.close();
  });

  test("reports a disconnect that occurs before its listener is registered", async () => {
    const { connection, socket } = await openFakeConnection();
    socket.emit("close", {});
    const errors: unknown[] = [];

    connection.onDisconnect?.((error) => errors.push(error));

    expect(errors).toHaveLength(1);
    connection.close();
  });
});
