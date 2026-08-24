import {
  createPublicHyperliquidClient,
  type HyperliquidNetwork,
  type InfoRequestTiming,
  type MarketCatalog,
  type PublicHyperliquidClient,
  parseMarketCatalogSnapshot,
} from "@hyper-trader/hyperliquid/public";

import type { MarketLoadTrace } from "../../core/performance/market-load-timing";

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

export interface MarketCatalogBackendClient {
  read(
    network: HyperliquidNetwork,
    signal?: AbortSignal,
    timing?: MarketLoadTrace,
  ): Promise<MarketCatalog>;
}

export interface DevelopmentMarketCatalogClient {
  readBootstrap(
    network: HyperliquidNetwork,
    signal?: AbortSignal,
    timing?: MarketLoadTrace,
  ): Promise<MarketCatalog>;
  read(
    network: HyperliquidNetwork,
    signal?: AbortSignal,
    timing?: MarketLoadTrace,
  ): Promise<MarketCatalog>;
}

function requireMarkets(catalog: MarketCatalog, source: string): MarketCatalog {
  if (catalog.markets.length === 0) {
    throw new Error(`${source} returned no validated markets`);
  }
  return catalog;
}

function recordInfoRequestTiming(
  timing: MarketLoadTrace | undefined,
  request: InfoRequestTiming,
): void {
  timing?.record(`hyperliquid:${request.requestType}`, request.totalMs, {
    outcome: request.outcome,
    responseMs: request.responseMs,
    bodyDecodeMs: request.bodyDecodeMs,
    status: request.status,
  });
}

export function createDevelopmentTestnetMarketCatalogClient(
  options: {
    readonly client?: Pick<PublicHyperliquidClient, "getMarketCatalog">;
  } = {},
): DevelopmentMarketCatalogClient {
  const client =
    options.client ?? createPublicHyperliquidClient({ network: "testnet" });
  return {
    async readBootstrap(network, signal, timing) {
      if (network !== "testnet") {
        throw new Error("development market catalog bootstrap is testnet-only");
      }
      const span = timing?.startStep("development:native-catalog");
      let catalog: MarketCatalog;
      try {
        catalog = requireMarkets(
          await client.getMarketCatalog({
            scope: "native",
            signal,
            ...(timing
              ? {
                  onRequestTiming: (request) =>
                    recordInfoRequestTiming(timing, request),
                }
              : {}),
          }),
          "development market catalog bootstrap",
        );
        span?.finish({
          outcome: "success",
          marketCount: catalog.markets.length,
        });
      } catch (error) {
        span?.finish({ outcome: "error" });
        throw error;
      }
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
    async read(network, signal, timing) {
      if (network !== "testnet") {
        throw new Error("development market catalog bootstrap is testnet-only");
      }
      const span = timing?.startStep("development:core-catalog");
      let catalog: MarketCatalog;
      try {
        catalog = requireMarkets(
          await client.getMarketCatalog({
            scope: "core",
            signal,
            ...(timing
              ? {
                  onRequestTiming: (request) =>
                    recordInfoRequestTiming(timing, request),
                }
              : {}),
          }),
          "development market catalog",
        );
        span?.finish({
          outcome: "success",
          marketCount: catalog.markets.length,
        });
      } catch (error) {
        span?.finish({ outcome: "error" });
        throw error;
      }
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
    async read(network, signal, timing) {
      const cached = cache.get(network);
      const requestSpan = timing?.startStep("backend:response", {
        cacheRevalidation: cached !== undefined,
      });
      let response: Response;
      try {
        response = await withRequestDeadline(signal, timeoutMs, (deadline) =>
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
        requestSpan?.finish({ outcome: "success", status: response.status });
      } catch (error) {
        requestSpan?.finish({ outcome: "error" });
        throw error;
      }
      if (response.status === 304) {
        if (!cached) {
          throw new Error("market catalog backend returned an invalid 304");
        }
        timing?.mark("backend:cache-reused", {
          marketCount: cached.catalog.markets.length,
        });
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
      const value = await readBoundedJson(response, timing);
      const parseSpan = timing?.startStep("backend:snapshot-parse");
      let snapshot: ReturnType<typeof parseMarketCatalogSnapshot>;
      try {
        snapshot = parseMarketCatalogSnapshot(value);
        parseSpan?.finish({
          outcome: "success",
          marketCount: snapshot.catalog.markets.length,
        });
      } catch (error) {
        parseSpan?.finish({ outcome: "error" });
        throw error;
      }
      if (snapshot.network !== network) {
        throw new Error("market catalog backend returned the wrong network");
      }
      const expectedEtag = `"market-catalog-${snapshot.network}-${snapshot.generation}"`;
      if (!matchesGenerationEtag(response.headers.get("etag"), expectedEtag)) {
        throw new Error("market catalog backend response has an invalid etag");
      }
      const catalog = requireMarkets(
        snapshot.catalog,
        "market catalog backend",
      );
      cache.set(network, { etag: expectedEtag, catalog });
      timing?.mark("backend:catalog-ready", {
        marketCount: catalog.markets.length,
        quarantinedCount: catalog.quarantined.length,
        sourceErrorCount: catalog.sourceErrors.length,
      });
      return catalog;
    },
  };
}

function matchesGenerationEtag(
  received: string | null,
  expected: string,
): boolean {
  return received === expected || received === `W/${expected}`;
}

async function readBoundedJson(
  response: Response,
  timing?: MarketLoadTrace,
): Promise<unknown> {
  if (response.body === null) {
    throw new Error("market catalog backend response is invalid");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  const bodySpan = timing?.startStep("backend:body-read");
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
    bodySpan?.finish({ outcome: "success", byteLength });
  } catch (error) {
    bodySpan?.finish({ outcome: "error", byteLength });
    throw error;
  } finally {
    reader.releaseLock();
  }
  const assembleSpan = timing?.startStep("backend:body-assemble");
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  assembleSpan?.finish({ byteLength });
  const decodeSpan = timing?.startStep("backend:json-decode");
  try {
    const value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    decodeSpan?.finish({ outcome: "success", byteLength });
    return value;
  } catch {
    decodeSpan?.finish({ outcome: "error", byteLength });
    throw new Error("market catalog backend response is invalid");
  }
}

export async function loadMarketCatalog(options: {
  readonly network: HyperliquidNetwork;
  readonly backend: MarketCatalogBackendClient | null;
  readonly development?: DevelopmentMarketCatalogClient | null;
  readonly signal?: AbortSignal;
  readonly timing?: MarketLoadTrace;
}): Promise<MarketCatalog> {
  const catalogSource = options.backend
    ? "backend"
    : options.development
      ? "development"
      : "unconfigured";
  const span = options.timing?.startStep("catalog:load", {
    catalogSource,
  });
  options.timing?.mark("catalog:source-selected", {
    catalogSource,
  });
  try {
    if (options.backend) {
      const catalog = requireMarkets(
        await options.backend.read(
          options.network,
          options.signal,
          options.timing,
        ),
        "market catalog",
      );
      span?.finish({ outcome: "success", marketCount: catalog.markets.length });
      return catalog;
    }
    if (options.development) {
      const catalog = requireMarkets(
        await options.development.read(
          options.network,
          options.signal,
          options.timing,
        ),
        "development market catalog",
      );
      span?.finish({ outcome: "success", marketCount: catalog.markets.length });
      return catalog;
    }
    throw new Error("market catalog backend is not configured");
  } catch (error) {
    span?.finish({ outcome: "error" });
    throw error;
  }
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
