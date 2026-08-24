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

export function activeAssetDataStreamKey(
  network: HyperliquidNetwork,
  user: string,
  coin: string,
): string {
  return JSON.stringify(["active-asset-data", network, user, coin]);
}

export function spotStateStreamKey(
  network: HyperliquidNetwork,
  user: string,
  isPortfolioMargin: boolean,
): string {
  return JSON.stringify(["spot-state", network, user, isPortfolioMargin]);
}

function exactAccountAddress(user: string): string {
  const normalizedUser = user.trim().toLowerCase();
  if (!ADDRESS.test(normalizedUser)) {
    throw new TypeError("An account stream requires a lowercase address.");
  }
  return normalizedUser;
}

function invalidationDelta(input: {
  readonly key: string;
  readonly channel: string;
  readonly data: unknown;
  readonly isSnapshot: boolean;
}) {
  return [
    {
      key: input.key,
      stableId: boundedIdentity(input.channel, input.data),
      data: null,
      isSnapshot: input.isSnapshot,
    },
  ] as const;
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
  const normalizedUser = exactAccountAddress(user);
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
      return invalidationDelta({
        key,
        channel: envelope.channel,
        data: envelope.data,
        isSnapshot: data?.isSnapshot === true,
      });
    },
  };
}

export function createActiveAssetDataWire(
  key: string,
  user: string,
  coin: string,
): DeclarativeStreamWire {
  const normalizedUser = exactAccountAddress(user);
  if (coin.trim() === "" || coin.trim() !== coin) {
    throw new TypeError("An active asset stream requires an exact coin.");
  }
  return {
    key,
    subscription: {
      type: "activeAssetData",
      user: normalizedUser,
      coin,
    },
    decode(envelope: PublicWebSocketEnvelope) {
      if (envelope.channel !== "activeAssetData") return [];
      const data = record(envelope.data);
      if (data?.user !== normalizedUser || data.coin !== coin) return [];
      return invalidationDelta({
        key,
        channel: envelope.channel,
        data: envelope.data,
        isSnapshot: data.isSnapshot === true,
      });
    },
  };
}

export function createSpotStateWire(
  key: string,
  user: string,
  isPortfolioMargin: boolean,
): DeclarativeStreamWire {
  const normalizedUser = exactAccountAddress(user);
  return {
    key,
    subscription: {
      type: "spotState",
      user: normalizedUser,
      isPortfolioMargin,
    },
    decode(envelope: PublicWebSocketEnvelope) {
      if (envelope.channel !== "spotState") return [];
      const data = record(envelope.data);
      if (data?.user !== normalizedUser) return [];
      return invalidationDelta({
        key,
        channel: envelope.channel,
        data: envelope.data,
        isSnapshot: data.isSnapshot === true,
      });
    },
  };
}
