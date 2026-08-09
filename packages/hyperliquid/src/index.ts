export type HyperliquidNetwork = "mainnet" | "testnet";

export interface MidPrice {
  readonly symbol: string;
  readonly price: string;
}

export interface HyperliquidClient {
  readonly network: HyperliquidNetwork;
  getAllMids(options?: { readonly signal?: AbortSignal }): Promise<MidPrice[]>;
}

export interface HyperliquidClientOptions {
  readonly network?: HyperliquidNetwork;
  readonly fetch?: typeof globalThis.fetch;
}

const INFO_ENDPOINTS: Record<HyperliquidNetwork, string> = {
  mainnet: "https://api.hyperliquid.xyz/info",
  testnet: "https://api.hyperliquid-testnet.xyz/info",
};

export class HyperliquidApiError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Hyperliquid API request failed with status ${status}.`);
    this.name = "HyperliquidApiError";
    this.status = status;
  }
}

export function parseAllMids(payload: unknown): MidPrice[] {
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    throw new TypeError("Hyperliquid allMids response must be an object.");
  }

  return Object.entries(payload)
    .map(([symbol, price]) => {
      if (
        typeof price !== "string" ||
        price.length === 0 ||
        !Number.isFinite(Number(price))
      ) {
        throw new TypeError(
          `Hyperliquid returned an invalid mid price for ${symbol}.`,
        );
      }

      return { symbol, price };
    })
    .sort((left, right) => left.symbol.localeCompare(right.symbol));
}

export function createHyperliquidClient(
  options: HyperliquidClientOptions = {},
): HyperliquidClient {
  const network = options.network ?? "mainnet";
  const fetchRequest = options.fetch ?? globalThis.fetch.bind(globalThis);

  return {
    network,
    async getAllMids(requestOptions = {}) {
      const response = await fetchRequest(INFO_ENDPOINTS[network], {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ type: "allMids" }),
        signal: requestOptions.signal,
      });

      if (!response.ok) {
        throw new HyperliquidApiError(response.status);
      }

      return parseAllMids(await response.json());
    },
  };
}
