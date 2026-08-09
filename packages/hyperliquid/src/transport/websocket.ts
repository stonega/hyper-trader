import { HyperliquidValidationError } from "../errors";
import {
  HYPERLIQUID_NETWORK_ORIGINS,
  type HyperliquidNetwork,
} from "../network";

export type PublicSubscription =
  | { readonly type: "allMids"; readonly dex?: string }
  | { readonly type: "trades"; readonly coin: string }
  | { readonly type: "l2Book"; readonly coin: string }
  | {
      readonly type: "candle";
      readonly coin: string;
      readonly interval: string;
    }
  | { readonly type: "activeAssetCtx"; readonly coin: string };

export interface PublicWebSocketEnvelope {
  readonly channel: string;
  readonly data: unknown;
}

export interface WebSocketConnection {
  send(data: string): void;
  close(): void;
  addMessageListener(listener: (data: unknown) => void): () => void;
}

export type OpenWebSocketConnection = (
  url: string,
  options: { readonly signal?: AbortSignal },
) => Promise<WebSocketConnection> | WebSocketConnection;

export interface PublicWebSocketSession {
  subscribe(
    subscription: PublicSubscription,
    listener: (message: PublicWebSocketEnvelope) => void,
  ): () => void;
  close(): void;
}

function parseWireData(data: unknown): unknown {
  if (typeof data === "string") {
    return JSON.parse(data) as unknown;
  }
  if (data instanceof ArrayBuffer) {
    return JSON.parse(new TextDecoder().decode(data)) as unknown;
  }
  return data;
}

export function parsePublicWebSocketMessage(
  data: unknown,
): PublicWebSocketEnvelope {
  const parsed = parseWireData(data);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new HyperliquidValidationError("websocket", "expected an envelope");
  }
  const source = parsed as Record<string, unknown>;
  if (typeof source.channel !== "string" || source.channel.length === 0) {
    throw new HyperliquidValidationError(
      "websocket.channel",
      "expected a channel",
    );
  }
  return { channel: source.channel, data: source.data };
}

function subscriptionKey(subscription: PublicSubscription): string {
  return JSON.stringify(subscription);
}

function messageRecord(
  value: unknown,
): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function matchesSubscription(
  subscription: PublicSubscription,
  message: PublicWebSocketEnvelope,
): boolean {
  if (message.channel === "subscriptionResponse") {
    const data = messageRecord(message.data);
    return (
      subscriptionKey(data?.subscription as PublicSubscription) ===
      subscriptionKey(subscription)
    );
  }
  if (message.channel !== subscription.type) {
    return false;
  }
  const data = messageRecord(message.data);
  switch (subscription.type) {
    case "allMids":
      return (
        subscription.dex === undefined ||
        data?.dex === undefined ||
        data.dex === subscription.dex
      );
    case "l2Book":
    case "activeAssetCtx":
      return data?.coin === subscription.coin;
    case "candle":
      return data?.s === subscription.coin && data.i === subscription.interval;
    case "trades":
      return (
        Array.isArray(message.data) &&
        message.data.some(
          (trade) => messageRecord(trade)?.coin === subscription.coin,
        )
      );
  }
}

export async function openPublicWebSocketSession(options: {
  readonly network?: HyperliquidNetwork;
  readonly open: OpenWebSocketConnection;
  readonly signal?: AbortSignal;
  readonly onInvalidMessage?: (error: unknown) => void;
}): Promise<PublicWebSocketSession> {
  const network = options.network ?? "mainnet";
  const connection = await options.open(
    HYPERLIQUID_NETWORK_ORIGINS[network].websocket,
    { signal: options.signal },
  );
  const listeners = new Map<
    string,
    {
      readonly subscription: PublicSubscription;
      readonly callbacks: Set<(message: PublicWebSocketEnvelope) => void>;
    }
  >();
  const removeListener = connection.addMessageListener((data) => {
    try {
      const message = parsePublicWebSocketMessage(data);
      for (const entry of listeners.values()) {
        if (!matchesSubscription(entry.subscription, message)) {
          continue;
        }
        for (const callback of entry.callbacks) {
          callback(message);
        }
      }
    } catch (error) {
      options.onInvalidMessage?.(error);
    }
  });

  return {
    subscribe(subscription, listener) {
      const key = subscriptionKey(subscription);
      let entry = listeners.get(key);
      if (!entry) {
        entry = { subscription, callbacks: new Set() };
        listeners.set(key, entry);
        connection.send(JSON.stringify({ method: "subscribe", subscription }));
      }
      entry.callbacks.add(listener);
      return () => {
        const current = listeners.get(key);
        if (!current) {
          return;
        }
        current.callbacks.delete(listener);
        if (current.callbacks.size === 0) {
          listeners.delete(key);
          connection.send(
            JSON.stringify({ method: "unsubscribe", subscription }),
          );
        }
      };
    },
    close() {
      removeListener();
      listeners.clear();
      connection.close();
    },
  };
}
