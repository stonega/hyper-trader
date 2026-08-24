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
  | { readonly type: "activeAssetCtx"; readonly coin: string }
  | {
      readonly type: "activeAssetData";
      readonly user: string;
      readonly coin: string;
    }
  | {
      readonly type: "spotState";
      readonly user: string;
      readonly isPortfolioMargin: boolean;
    }
  | { readonly type: "userEvents"; readonly user: string }
  | { readonly type: "orderUpdates"; readonly user: string }
  | {
      readonly type: "userFills";
      readonly user: string;
      readonly aggregateByTime?: boolean;
    }
  | { readonly type: "userFundings"; readonly user: string }
  | { readonly type: "allDexsClearinghouseState"; readonly user: string };

export interface PublicWebSocketEnvelope {
  readonly channel: string;
  readonly data: unknown;
}

export interface WebSocketConnection {
  send(data: string): void;
  close(): void;
  addMessageListener(listener: (data: unknown) => void): () => void;
  addCloseListener?(listener: () => void): () => void;
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
  const expectedChannel =
    subscription.type === "userEvents" ? "user" : subscription.type;
  if (message.channel !== expectedChannel) {
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
    case "activeAssetData":
      return (
        data?.user === subscription.user && data.coin === subscription.coin
      );
    case "spotState":
      return data?.user === subscription.user;
    case "candle":
      return data?.s === subscription.coin && data.i === subscription.interval;
    case "trades":
      return (
        Array.isArray(message.data) &&
        message.data.some(
          (trade) => messageRecord(trade)?.coin === subscription.coin,
        )
      );
    case "userFills":
    case "userFundings":
    case "allDexsClearinghouseState":
      return data?.user === subscription.user;
    case "userEvents":
      return message.channel === "user";
    case "orderUpdates":
      return true;
  }
}

export type ScheduleWebSocketInterval = (
  callback: () => void,
  milliseconds: number,
) => () => void;

export type ScheduleWebSocketTimeout = (
  callback: () => void,
  milliseconds: number,
) => () => void;

export type ReserveWebSocketSubscriptionOperation = (input: {
  readonly subscription: PublicSubscription;
  readonly operation: "subscribe" | "unsubscribe";
}) => () => void;

export async function openPublicWebSocketSession(options: {
  readonly network?: HyperliquidNetwork;
  readonly open: OpenWebSocketConnection;
  readonly signal?: AbortSignal;
  readonly onInvalidMessage?: (error: unknown) => void;
  readonly onGap?: () => void;
  readonly maxSubscriptions?: number;
  readonly scheduleHeartbeat?: ScheduleWebSocketInterval;
  readonly reserveSubscriptionOperation?: ReserveWebSocketSubscriptionOperation;
  readonly scheduleOperationTimeout?: ScheduleWebSocketTimeout;
}): Promise<PublicWebSocketSession> {
  const network = options.network ?? "mainnet";
  const maxSubscriptions = options.maxSubscriptions ?? 700;
  if (
    !Number.isSafeInteger(maxSubscriptions) ||
    maxSubscriptions < 1 ||
    maxSubscriptions > 700
  ) {
    throw new HyperliquidValidationError(
      "websocket.maxSubscriptions",
      "expected capacity at or below seventy percent",
    );
  }
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
  const exclusiveUsers = new Map<"userEvents" | "orderUpdates", string>();
  const pendingOperations = new Map<string, Array<() => void>>();
  let closed = false;
  let removeListener: () => void = () => undefined;
  let removeCloseListener: () => void = () => undefined;
  let cancelHeartbeat: () => void = () => undefined;
  const closeInternal = () => {
    if (closed) return;
    closed = true;
    cancelHeartbeat();
    removeListener();
    removeCloseListener();
    listeners.clear();
    exclusiveUsers.clear();
    for (const releases of pendingOperations.values()) {
      for (const release of releases) release();
    }
    pendingOperations.clear();
    try {
      connection.close();
    } catch {
      // Closing is best effort after local state is already fenced.
    }
  };
  const fail = (error: unknown) => {
    if (closed) return;
    try {
      options.onInvalidMessage?.(error);
    } catch {
      // Failure telemetry must never keep a corrupt session alive.
    }
    try {
      options.onGap?.();
    } catch {
      // Rebaseline notification is isolated from transport cleanup.
    }
    closeInternal();
  };
  removeListener = connection.addMessageListener((data) => {
    try {
      const message = parsePublicWebSocketMessage(data);
      if (message.channel === "subscriptionResponse") {
        const response = messageRecord(message.data);
        const subscription = response?.subscription as
          | PublicSubscription
          | undefined;
        const key = subscription ? subscriptionKey(subscription) : "";
        const releases = pendingOperations.get(key);
        const release = releases?.shift();
        if (!release) {
          throw new HyperliquidValidationError(
            "websocket.subscriptionResponse",
            "acknowledgement does not match a pending operation",
          );
        }
        release();
        if (releases?.length === 0) pendingOperations.delete(key);
        return;
      }
      let matched = message.channel === "pong";
      for (const entry of listeners.values()) {
        if (!matchesSubscription(entry.subscription, message)) {
          continue;
        }
        matched = true;
        for (const callback of entry.callbacks) {
          callback(message);
        }
      }
      if (!matched) {
        throw new HyperliquidValidationError(
          "websocket.message",
          "message does not match an active subscription",
        );
      }
    } catch (error) {
      fail(error);
    }
  });
  removeCloseListener =
    connection.addCloseListener?.(() => {
      fail(
        new HyperliquidValidationError(
          "websocket.connection",
          "connection closed before an explicit shutdown",
        ),
      );
    }) ?? (() => undefined);
  try {
    cancelHeartbeat = (options.scheduleHeartbeat ?? defaultHeartbeatScheduler)(
      () => {
        if (closed) return;
        try {
          connection.send(JSON.stringify({ method: "ping" }));
        } catch (error) {
          fail(error);
        }
      },
      50_000,
    );
  } catch (error) {
    closeInternal();
    throw error;
  }

  return {
    subscribe(subscription, listener) {
      if (closed) {
        throw new HyperliquidValidationError(
          "websocket.session",
          "session is closed",
        );
      }
      validateSubscription(subscription);
      const key = subscriptionKey(subscription);
      let entry = listeners.get(key);
      if (!entry) {
        if (listeners.size >= maxSubscriptions) {
          throw new HyperliquidValidationError(
            "websocket.subscriptions",
            "subscription capacity is exhausted",
          );
        }
        if (
          subscription.type === "userEvents" ||
          subscription.type === "orderUpdates"
        ) {
          const existingUser = exclusiveUsers.get(subscription.type);
          if (
            existingUser !== undefined &&
            existingUser !== subscription.user
          ) {
            throw new HyperliquidValidationError(
              `websocket.${subscription.type}`,
              "cannot multiplex this user channel",
            );
          }
          exclusiveUsers.set(subscription.type, subscription.user);
        }
        entry = { subscription, callbacks: new Set() };
        listeners.set(key, entry);
        let releaseOperation: (() => void) | undefined;
        try {
          releaseOperation = trackSubscriptionOperation(
            subscription,
            "subscribe",
            key,
            pendingOperations,
            options,
            fail,
          );
          connection.send(
            JSON.stringify({ method: "subscribe", subscription }),
          );
        } catch (error) {
          releaseOperation?.();
          listeners.delete(key);
          if (
            subscription.type === "userEvents" ||
            subscription.type === "orderUpdates"
          ) {
            exclusiveUsers.delete(subscription.type);
          }
          fail(error);
          throw new HyperliquidValidationError(
            "websocket.send",
            "subscription send failed",
          );
        }
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
          if (
            subscription.type === "userEvents" ||
            subscription.type === "orderUpdates"
          ) {
            exclusiveUsers.delete(subscription.type);
          }
          try {
            trackSubscriptionOperation(
              subscription,
              "unsubscribe",
              key,
              pendingOperations,
              options,
              fail,
            );
            connection.send(
              JSON.stringify({ method: "unsubscribe", subscription }),
            );
          } catch (error) {
            fail(error);
          }
        }
      };
    },
    close() {
      closeInternal();
    },
  };
}

function validateSubscription(subscription: PublicSubscription): void {
  if (
    (subscription.type === "userEvents" ||
      subscription.type === "orderUpdates" ||
      subscription.type === "userFills" ||
      subscription.type === "userFundings" ||
      subscription.type === "activeAssetData" ||
      subscription.type === "spotState" ||
      subscription.type === "allDexsClearinghouseState") &&
    !/^0x[0-9a-f]{40}$/.test(subscription.user)
  ) {
    throw new HyperliquidValidationError(
      "websocket.user",
      "expected an exact lowercase account address",
    );
  }
}

function trackSubscriptionOperation(
  subscription: PublicSubscription,
  operation: "subscribe" | "unsubscribe",
  key: string,
  pending: Map<string, Array<() => void>>,
  options: {
    readonly reserveSubscriptionOperation?: ReserveWebSocketSubscriptionOperation;
    readonly scheduleOperationTimeout?: ScheduleWebSocketTimeout;
  },
  fail: (error: unknown) => void,
): () => void {
  const releaseBudget =
    options.reserveSubscriptionOperation?.({ subscription, operation }) ??
    (() => undefined);
  let active = true;
  let cancelTimeout: () => void = () => undefined;
  const release = () => {
    if (!active) return;
    active = false;
    cancelTimeout();
    releaseBudget();
    const releases = pending.get(key);
    const index = releases?.indexOf(release) ?? -1;
    if (index >= 0) releases?.splice(index, 1);
    if (releases?.length === 0) pending.delete(key);
  };
  const releases = pending.get(key) ?? [];
  releases.push(release);
  pending.set(key, releases);
  cancelTimeout = (options.scheduleOperationTimeout ?? defaultOneShotScheduler)(
    () => {
      release();
      fail(
        new HyperliquidValidationError(
          "websocket.subscriptionResponse",
          "subscription acknowledgement timed out",
        ),
      );
    },
    10_000,
  );
  return release;
}

function defaultHeartbeatScheduler(
  callback: () => void,
  milliseconds: number,
): () => void {
  const timer = setInterval(callback, milliseconds);
  return () => clearInterval(timer);
}

function defaultOneShotScheduler(
  callback: () => void,
  milliseconds: number,
): () => void {
  const timer = setTimeout(callback, milliseconds);
  return () => clearTimeout(timer);
}
