export type HyperliquidNetwork = "mainnet" | "testnet";

export interface HyperliquidNetworkOrigins {
  readonly http: string;
  readonly exchange: string;
  readonly websocket: string;
}

export const HYPERLIQUID_NETWORK_ORIGINS: Readonly<
  Record<HyperliquidNetwork, HyperliquidNetworkOrigins>
> = {
  mainnet: {
    http: "https://api.hyperliquid.xyz/info",
    exchange: "https://api.hyperliquid.xyz/exchange",
    websocket: "wss://api.hyperliquid.xyz/ws",
  },
  testnet: {
    http: "https://api.hyperliquid-testnet.xyz/info",
    exchange: "https://api.hyperliquid-testnet.xyz/exchange",
    websocket: "wss://api.hyperliquid-testnet.xyz/ws",
  },
};
