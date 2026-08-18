export type HyperliquidNetwork = "mainnet" | "testnet";

export interface HyperliquidNetworkOrigins {
  readonly http: string;
  readonly exchange: string;
  readonly websocket: string;
}

export const HYPERLIQUID_NETWORK_ORIGINS = Object.freeze({
  mainnet: Object.freeze({
    http: "https://api.hyperliquid.xyz/info",
    exchange: "https://api.hyperliquid.xyz/exchange",
    websocket: "wss://api.hyperliquid.xyz/ws",
  }),
  testnet: Object.freeze({
    http: "https://api.hyperliquid-testnet.xyz/info",
    exchange: "https://api.hyperliquid-testnet.xyz/exchange",
    websocket: "wss://api.hyperliquid-testnet.xyz/ws",
  }),
}) satisfies Readonly<Record<HyperliquidNetwork, HyperliquidNetworkOrigins>>;
