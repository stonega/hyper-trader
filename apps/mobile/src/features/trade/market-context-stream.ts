import {
  type HyperliquidNetwork,
  type Market,
  type MarketContext,
  type PublicWebSocketEnvelope,
  parseMarketContext,
} from "@hyper-trader/hyperliquid/public";

import type { ManagedStreamMessage } from "../../core/streams/manager";
import type { DeclarativeStreamWire } from "../../core/streams/native-websocket";

const CONTEXT_KEYS = [
  "dayNtlVlm",
  "dayBaseVlm",
  "funding",
  "impactPxs",
  "markPx",
  "midPx",
  "openInterest",
  "oraclePx",
  "premium",
  "prevDayPx",
] as const;

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function normalizedContext(value: unknown): value is MarketContext {
  const source = record(value);
  if (!source) return false;
  return CONTEXT_KEYS.every((key) => {
    const candidate = source[key];
    if (candidate === undefined || candidate === null) return true;
    if (key === "impactPxs") {
      return (
        Array.isArray(candidate) &&
        candidate.length === 2 &&
        candidate.every((price) => typeof price === "string")
      );
    }
    return typeof candidate === "string";
  });
}

export function marketContextFromMarket(market: Market): MarketContext {
  return Object.fromEntries(
    CONTEXT_KEYS.flatMap((key) =>
      market[key] === undefined ? [] : [[key, market[key]]],
    ),
  ) as MarketContext;
}

export function tradeMarketContextStreamKey(
  network: HyperliquidNetwork,
  canonicalId: string,
): string {
  return JSON.stringify(["trade-market-context", network, canonicalId]);
}

export function createTradeMarketContextWire(
  key: string,
  coin: string,
): DeclarativeStreamWire {
  return {
    key,
    subscription: { type: "activeAssetCtx", coin },
    decode(envelope: PublicWebSocketEnvelope) {
      if (envelope.channel !== "activeAssetCtx") return [];
      const source = record(envelope.data);
      if (source?.coin !== coin) return [];
      const context = parseMarketContext(source.ctx, "activeAssetCtx.ctx");
      return [
        {
          key,
          stableId: JSON.stringify([coin, context]),
          data: source.ctx,
        },
      ];
    },
  };
}

export function marketContextFromStreamMessage(
  message: ManagedStreamMessage,
): MarketContext {
  return parseMarketContext(message.data, "activeAssetCtx.ctx");
}

export function marketContextBaselineFromStream(value: unknown): MarketContext {
  if (!normalizedContext(value)) {
    throw new TypeError("The market-context stream baseline is invalid.");
  }
  return value;
}
