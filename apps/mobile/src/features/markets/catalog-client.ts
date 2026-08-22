import {
  createPublicHyperliquidClient,
  type HyperliquidNetwork,
  type MarketCatalog,
  type PublicHyperliquidClient,
  parseMarketCatalogSnapshot,
} from "@hyper-trader/hyperliquid/public";

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

export interface MarketCatalogBackendClient {
  read(
    network: HyperliquidNetwork,
    signal?: AbortSignal,
  ): Promise<MarketCatalog>;
}

export interface DevelopmentMarketCatalogClient {
  readBootstrap(
    network: HyperliquidNetwork,
    signal?: AbortSignal,
  ): Promise<MarketCatalog>;
  read(
    network: HyperliquidNetwork,
    signal?: AbortSignal,
  ): Promise<MarketCatalog>;
}

function requireMarkets(catalog: MarketCatalog, source: string): MarketCatalog {
  if (catalog.markets.length === 0) {
    throw new Error(`${source} returned no validated markets`);
  }
  return catalog;
}

export function createDevelopmentTestnetMarketCatalogClient(
  options: {
    readonly client?: Pick<PublicHyperliquidClient, "getMarketCatalog">;
  } = {},
): DevelopmentMarketCatalogClient {
  const client =
    options.client ?? createPublicHyperliquidClient({ network: "testnet" });
  return {
    async readBootstrap(network, signal) {
      if (network !== "testnet") {
        throw new Error("development market catalog bootstrap is testnet-only");
      }
      const catalog = requireMarkets(
        await client.getMarketCatalog({
          scope: "native",
          signal,
        }),
        "development market catalog bootstrap",
      );
      return {
        ...catalog,
        sourceErrors: [
          ...catalog.sourceErrors,
          {
            source: "backendCatalog",
            message:
              "Development build is showing validated native testnet perpetuals while core market metadata loads.",
          },
        ],
      };
    },
    async read(network, signal) {
      if (network !== "testnet") {
        throw new Error("development market catalog bootstrap is testnet-only");
      }
      const catalog = requireMarkets(
        await client.getMarketCatalog({
          scope: "core",
          signal,
        }),
        "development market catalog",
      );
      return {
        ...catalog,
        sourceErrors: [
          ...catalog.sourceErrors,
          {
            source: "backendCatalog",
            message:
              "Development build is using validated core testnet metadata while the catalog backend is not configured.",
          },
        ],
      };
    },
  };
}

export function createMarketCatalogBackendClient(options: {
  readonly origin: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly timeoutMs?: number;
}): MarketCatalogBackendClient {
  const origin = exactHttpsOrigin(options.origin);
  const fetchRequest = options.fetch ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS);
  const cache = new Map<
    HyperliquidNetwork,
    { readonly etag: string; readonly catalog: MarketCatalog }
  >();
  return {
    async read(network, signal) {
      const cached = cache.get(network);
      const response = await withRequestDeadline(
        signal,
        timeoutMs,
        (deadline) =>
          fetchRequest(
            new Request(`${origin}/v1/market-catalog/${network}`, {
              method: "GET",
              headers: {
                accept: "application/json",
                ...(cached ? { "if-none-match": cached.etag } : {}),
              },
              redirect: "error",
              signal: deadline,
            }),
          ),
      );
      if (response.status === 304) {
        if (!cached) {
          throw new Error("market catalog backend returned an invalid 304");
        }
        return cached.catalog;
      }
      if (!response.ok) {
        throw new Error(`market catalog backend returned ${response.status}`);
      }
      if (
        response.headers.get("content-type")?.split(";", 1)[0]?.trim() !==
        "application/json"
      ) {
        throw new Error("market catalog backend response is invalid");
      }
      const declaredLength = response.headers.get("content-length");
      if (
        declaredLength !== null &&
        (/^(?:0|[1-9][0-9]*)$/.test(declaredLength) === false ||
          Number(declaredLength) > MAX_RESPONSE_BYTES)
      ) {
        throw new Error("market catalog backend response is too large");
      }
      const value = await readBoundedJson(response);
      const snapshot = parseMarketCatalogSnapshot(value);
      if (snapshot.network !== network) {
        throw new Error("market catalog backend returned the wrong network");
      }
      const expectedEtag = `"market-catalog-${snapshot.network}-${snapshot.generation}"`;
      if (response.headers.get("etag") !== expectedEtag) {
        throw new Error("market catalog backend response has an invalid etag");
      }
      const catalog = requireMarkets(
        snapshot.catalog,
        "market catalog backend",
      );
      cache.set(network, { etag: expectedEtag, catalog });
      return catalog;
    },
  };
}

async function readBoundedJson(response: Response): Promise<unknown> {
  if (response.body === null) {
    throw new Error("market catalog backend response is invalid");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      byteLength += next.value.byteLength;
      if (byteLength > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error("market catalog backend response is too large");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error("market catalog backend response is invalid");
  }
}

export async function loadMarketCatalog(options: {
  readonly network: HyperliquidNetwork;
  readonly backend: MarketCatalogBackendClient | null;
  readonly development?: DevelopmentMarketCatalogClient | null;
  readonly signal?: AbortSignal;
}): Promise<MarketCatalog> {
  if (options.backend) {
    return requireMarkets(
      await options.backend.read(options.network, options.signal),
      "market catalog",
    );
  }
  if (options.development) {
    return requireMarkets(
      await options.development.read(options.network, options.signal),
      "development market catalog",
    );
  }
  throw new Error("market catalog backend is not configured");
}

async function withRequestDeadline<T>(
  signal: AbortSignal | undefined,
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (signal?.aborted) throw signal.reason;
  const controller = new AbortController();
  const abort = () =>
    controller.abort(
      signal?.reason ?? new Error("market catalog request aborted"),
    );
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(
    () => controller.abort(new Error("market catalog backend timed out")),
    timeoutMs,
  );
  try {
    return await operation(controller.signal);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

function exactHttpsOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("market catalog backend must use an exact HTTPS origin");
  }
  if (
    url.protocol !== "https:" ||
    url.origin !== value ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("market catalog backend must use an exact HTTPS origin");
  }
  return value;
}

function timeout(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 60_000) {
    throw new Error("market catalog backend timeout is invalid");
  }
  return value;
}
