import {
  HYPERLIQUID_NETWORK_ORIGINS,
  type HyperliquidNetwork,
  type PublicSubscription,
  type PublicWebSocketEnvelope,
  parsePublicWebSocketMessage,
} from "@hyper-trader/hyperliquid/public";

import type { ManagedStreamConnection, ManagedStreamMessage } from "./manager";

export interface DeclarativeStreamWire {
  readonly key: string;
  readonly subscription: PublicSubscription;
  decode(envelope: PublicWebSocketEnvelope): readonly ManagedStreamMessage[];
}

function asWire(value: unknown): DeclarativeStreamWire {
  if (
    typeof value !== "object" ||
    value === null ||
    !("subscription" in value) ||
    !("decode" in value) ||
    typeof value.decode !== "function"
  ) {
    throw new TypeError(
      "A stream declaration requires a wire subscription and decoder.",
    );
  }
  return value as DeclarativeStreamWire;
}

export async function openNativeManagedConnection(options: {
  readonly network: HyperliquidNetwork;
  readonly signal: AbortSignal;
}): Promise<ManagedStreamConnection> {
  const socket = new WebSocket(
    HYPERLIQUID_NETWORK_ORIGINS[options.network].websocket,
  );

  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("error", onError);
      options.signal.removeEventListener("abort", onAbort);
    };
    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("The Hyperliquid WebSocket connection failed to open."));
    };
    const onAbort = () => {
      cleanup();
      socket.close();
      reject(new Error("The Hyperliquid WebSocket connection was canceled."));
    };
    socket.addEventListener("open", onOpen);
    socket.addEventListener("error", onError);
    options.signal.addEventListener("abort", onAbort, { once: true });
    if (options.signal.aborted) {
      onAbort();
    }
  });

  const subscriptions = new Map<
    DeclarativeStreamWire,
    (message: ManagedStreamMessage) => void
  >();
  const disconnectListeners = new Set<(error?: unknown) => void>();
  let closed = false;

  const notifyDisconnect = (error?: unknown) => {
    if (closed) {
      return;
    }
    for (const listener of disconnectListeners) {
      listener(error);
    }
  };
  const onMessage = (event: MessageEvent) => {
    try {
      const envelope = parsePublicWebSocketMessage(event.data);
      if (envelope.channel === "pong") {
        return;
      }
      for (const [wire, listener] of subscriptions) {
        for (const message of wire.decode(envelope)) {
          if (message.key === wire.key) {
            listener(message);
          }
        }
      }
    } catch (error) {
      notifyDisconnect(error);
    }
  };
  const onClose = () => notifyDisconnect();
  const onError = () =>
    notifyDisconnect(new Error("The Hyperliquid WebSocket failed."));
  const onAbort = () => socket.close();
  socket.addEventListener("message", onMessage);
  socket.addEventListener("close", onClose);
  socket.addEventListener("error", onError);
  options.signal.addEventListener("abort", onAbort, { once: true });
  if (options.signal.aborted) {
    socket.removeEventListener("message", onMessage);
    socket.removeEventListener("close", onClose);
    socket.removeEventListener("error", onError);
    options.signal.removeEventListener("abort", onAbort);
    socket.close();
    throw new Error("The Hyperliquid WebSocket generation was canceled.");
  }

  return {
    subscribe(rawWire, listener) {
      const wire = asWire(rawWire);
      subscriptions.set(wire, listener);
      socket.send(
        JSON.stringify({
          method: "subscribe",
          subscription: wire.subscription,
        }),
      );
      return () => {
        if (!subscriptions.delete(wire) || closed) {
          return;
        }
        socket.send(
          JSON.stringify({
            method: "unsubscribe",
            subscription: wire.subscription,
          }),
        );
      };
    },
    ping() {
      if (!closed) {
        socket.send(JSON.stringify({ method: "ping" }));
      }
    },
    close() {
      if (closed) {
        return;
      }
      closed = true;
      subscriptions.clear();
      disconnectListeners.clear();
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("close", onClose);
      socket.removeEventListener("error", onError);
      options.signal.removeEventListener("abort", onAbort);
      socket.close();
    },
    onDisconnect(listener) {
      disconnectListeners.add(listener);
      return () => disconnectListeners.delete(listener);
    },
  };
}
