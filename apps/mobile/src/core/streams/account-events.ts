import type {
  HyperliquidNetwork,
  PublicSubscription,
  PublicWebSocketEnvelope,
} from "@hyper-trader/hyperliquid/public";

import type { DeclarativeStreamWire } from "./native-websocket";

export type AccountEventChannel =
  | "allDexsClearinghouseState"
  | "orderUpdates"
  | "userFills"
  | "userFundings"
  | "userEvents";

const ADDRESS = /^0x[0-9a-f]{40}$/;
const MAX_EVENT_BYTES = 256 * 1024;

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function subscriptionFor(
  channel: AccountEventChannel,
  user: string,
): PublicSubscription {
  switch (channel) {
    case "userFills":
      return { type: channel, user, aggregateByTime: false };
    case "userEvents":
    case "orderUpdates":
    case "userFundings":
    case "allDexsClearinghouseState":
      return { type: channel, user };
  }
}

function expectedWireChannel(channel: AccountEventChannel): string {
  return channel === "userEvents" ? "user" : channel;
}

function boundedIdentity(channel: string, data: unknown): string {
  const serialized = JSON.stringify(data);
  if (serialized === undefined) {
    throw new TypeError("The account stream event is not serializable.");
  }
  if (new TextEncoder().encode(serialized).byteLength > MAX_EVENT_BYTES) {
    throw new TypeError("The account stream event exceeds its size limit.");
  }
  return JSON.stringify([channel, serialized]);
}

export function accountEventStreamKey(
  network: HyperliquidNetwork,
  user: string,
  channel: AccountEventChannel,
): string {
  return JSON.stringify(["account-events", network, user, channel]);
}

/**
 * Account events are deliberately only invalidation signals. Their untrusted
 * payload never enters a query cache; the active query reloads a fully parsed
 * authoritative snapshot before UI or action validation observes a change.
 */
export function createAccountEventWire(
  key: string,
  user: string,
  channel: AccountEventChannel,
): DeclarativeStreamWire {
  const normalizedUser = user.trim().toLowerCase();
  if (!ADDRESS.test(normalizedUser)) {
    throw new TypeError("An account stream requires a lowercase address.");
  }
  return {
    key,
    subscription: subscriptionFor(channel, normalizedUser),
    decode(envelope: PublicWebSocketEnvelope) {
      if (envelope.channel !== expectedWireChannel(channel)) return [];
      const data = record(envelope.data);
      if (channel !== "orderUpdates" && channel !== "userEvents") {
        if (data?.user !== normalizedUser) return [];
      } else if (channel === "orderUpdates" && !Array.isArray(envelope.data)) {
        throw new TypeError("Order updates must be an array.");
      }
      return [
        {
          key,
          stableId: boundedIdentity(envelope.channel, envelope.data),
          data: null,
          isSnapshot: data?.isSnapshot === true,
        },
      ];
    },
  };
}
