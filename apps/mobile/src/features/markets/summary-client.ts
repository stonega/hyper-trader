import {
  createMarketSummaryPage,
  type HyperliquidNetwork,
  type MarketCatalog,
  MarketSummaryGenerationChangedError,
  type MarketSummaryPage,
  type MarketSummaryQuery,
  parseMarketSummaryPage,
} from "@hyper-trader/hyperliquid/public";

import type { MarketLoadTrace } from "../../core/performance/market-load-timing";
import type { DevelopmentMarketCatalogClient } from "./catalog-client";

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 256 * 1024;

export interface MarketSummaryClient {
  read(
    network: HyperliquidNetwork,
    query: MarketSummaryQuery,
    signal?: AbortSignal,
    timing?: MarketLoadTrace,
  ): Promise<MarketSummaryPage>;
}

export function createMarketSummaryBackendClient(options: {
  readonly origin: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly timeoutMs?: number;
}): MarketSummaryClient {
  const origin = exactHttpsOrigin(options.origin);
  const fetchRequest = options.fetch ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS);
  return {
    async read(network, query, signal, timing) {
      const url = new URL(`${origin}/v1/market-summaries/${network}`);
      url.searchParams.set("limit", String(query.limit));
      url.searchParams.set("availability", query.availability);
      url.searchParams.set("includeHip3", String(query.includeHip3));
      url.searchParams.set("lifecycle", query.lifecycle);
      url.searchParams.set("sort", query.sort);
      if (query.family !== null) url.searchParams.set("family", query.family);
      if (query.query !== "") url.searchParams.set("query", query.query);
      if (query.cursor !== null) url.searchParams.set("cursor", query.cursor);
      for (const id of query.ids) url.searchParams.append("id", id);

      const responseSpan = timing?.startStep("summary:response", {
        cursor: query.cursor ?? "first",
        requestedIdCount: query.ids.length,
      });
      let response: Response;
      try {
        response = await withRequestDeadline(signal, timeoutMs, (deadline) =>
          fetchRequest(
            new Request(url, {
              method: "GET",
              headers: { accept: "application/json" },
              redirect: "error",
              signal: deadline,
            }),
          ),
        );
        responseSpan?.finish({ outcome: "success", status: response.status });
      } catch (error) {
        responseSpan?.finish({ outcome: "error" });
        throw error;
      }
      if (response.status === 409) {
        throw new MarketSummaryGenerationChangedError();
      }
      if (!response.ok) {
        throw new Error(`market summaries backend returned ${response.status}`);
      }
      if (
        response.headers.get("content-type")?.split(";", 1)[0]?.trim() !==
        "application/json"
      ) {
        throw new Error("market summaries backend response is invalid");
      }
      const declaredLength = response.headers.get("content-length");
      if (
        declaredLength !== null &&
        (/^(?:0|[1-9][0-9]*)$/.test(declaredLength) === false ||
          Number(declaredLength) > MAX_RESPONSE_BYTES)
      ) {
        throw new Error("market summaries backend response is too large");
      }
      const value = await readBoundedJson(response, timing);
      const parseSpan = timing?.startStep("summary:parse");
      let page: MarketSummaryPage;
      try {
        page = parseMarketSummaryPage(value);
        parseSpan?.finish({
          outcome: "success",
          itemCount: page.items.length,
        });
      } catch (error) {
        parseSpan?.finish({ outcome: "error" });
        throw error;
      }
      if (page.network !== network) {
        throw new Error("market summaries backend returned the wrong network");
      }
      timing?.mark("summary:page-ready", {
        itemCount: page.items.length,
        total: page.total,
      });
      return page;
    },
  };
}

export function createDevelopmentMarketSummaryClient(
  development: DevelopmentMarketCatalogClient,
  now: () => number = Date.now,
  loadCatalog: (
    network: HyperliquidNetwork,
    signal?: AbortSignal,
    timing?: MarketLoadTrace,
  ) => Promise<MarketCatalog> = (network, signal, timing) =>
    development.read(network, signal, timing),
): MarketSummaryClient {
  let catalog: MarketCatalog | undefined;
  let pending: Promise<MarketCatalog> | undefined;
  let publishedAtMs = 0;
  return {
    async read(network, query, signal, timing) {
      if (network !== "testnet") {
        throw new Error("development market summaries are testnet-only");
      }
      if (!catalog) {
        pending ??= loadCatalog(network, signal, timing)
          .then((value) => {
            catalog = value;
            publishedAtMs = now();
            return value;
          })
          .finally(() => {
            pending = undefined;
          });
        catalog = await pending;
      }
      return createMarketSummaryPage({
        network,
        generation: 1,
        publishedAtMs,
        markets: catalog.markets,
        quarantinedCount: catalog.quarantined.length,
        sourceErrorCount: catalog.sourceErrors.length,
        query,
      });
    },
  };
}

async function readBoundedJson(
  response: Response,
  timing?: MarketLoadTrace,
): Promise<unknown> {
  if (response.body === null) {
    throw new Error("market summaries backend response is invalid");
  }
  const span = timing?.startStep("summary:body-read");
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
        throw new Error("market summaries backend response is too large");
      }
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    span?.finish({ outcome: "success", byteLength });
    return value;
  } catch (error) {
    span?.finish({ outcome: "error", byteLength });
    if (error instanceof SyntaxError || error instanceof TypeError) {
      throw new Error("market summaries backend response is invalid");
    }
    throw error;
  } finally {
    reader.releaseLock();
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
      signal?.reason ?? new Error("market summaries request aborted"),
    );
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(
    () => controller.abort(new Error("market summaries backend timed out")),
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
    throw new Error("market summaries backend must use an exact HTTPS origin");
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
    throw new Error("market summaries backend must use an exact HTTPS origin");
  }
  return value;
}

function timeout(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 60_000) {
    throw new Error("market summaries backend timeout is invalid");
  }
  return value;
}
