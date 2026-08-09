export type HyperliquidNetwork = "mainnet" | "testnet";

export interface HyperliquidNetworkOrigins {
  readonly http: string;
  readonly websocket: string;
}

export const HYPERLIQUID_NETWORK_ORIGINS: Readonly<
  Record<HyperliquidNetwork, HyperliquidNetworkOrigins>
> = {
  mainnet: {
    http: "https://api.hyperliquid.xyz/info",
    websocket: "wss://api.hyperliquid.xyz/ws",
  },
  testnet: {
    http: "https://api.hyperliquid-testnet.xyz/info",
    websocket: "wss://api.hyperliquid-testnet.xyz/ws",
  },
};
