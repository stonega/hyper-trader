import {
  type HyperliquidNetwork,
  type InfoHttpTransport,
  type PublicPortfolioHistoryEnvelope,
  type PublicPortfolioLiveEnvelope,
  parsePublicPortfolioHistorySnapshot,
  parsePublicPortfolioLiveSnapshot,
  parsePublicPortfolioSpotState,
} from "@hyper-trader/hyperliquid/public";

import type { MarketCatalogReader } from "../server";

const ADDRESS = /^0x[0-9a-f]{40}$/;
const FUNDING_WINDOW_MS = 30 * 24 * 60 * 60 * 1_000;
const LIVE_CACHE_MS = 5_000;
const HISTORY_CACHE_MS = 60_000;
const MAX_CACHE_ENTRIES = 128;
const MAX_INFLIGHT = 8;
const MAX_DEXES = 128;
const MAX_SOURCE_GAPS = 64;
const MAX_HISTORICAL_ORDERS = 2_000;
const MAX_USER_FILLS = 2_000;
const MAX_USER_FUNDING = 500;
const DEFAULT_DEX_BATCH_SIZE = 8;

export class PortfolioSnapshotBusyError extends Error {}
export class PortfolioSnapshotNotReadyError extends Error {}

export interface PortfolioSnapshotRequest {
  readonly network: HyperliquidNetwork;
  readonly user: string;
  readonly signal?: AbortSignal;
}

export interface PortfolioSnapshotReader {
  readLive(
    request: PortfolioSnapshotRequest,
  ): Promise<PublicPortfolioLiveEnvelope>;
  readHistory(
    request: PortfolioSnapshotRequest,
  ): Promise<PublicPortfolioHistoryEnvelope>;
}

interface CacheEntry<T> {
  readonly expiresAt: number;
  readonly value: T;
}

export class HyperliquidPortfolioSnapshotReader
  implements PortfolioSnapshotReader
{
  readonly #transports: Readonly<Record<HyperliquidNetwork, InfoHttpTransport>>;
  readonly #catalog: MarketCatalogReader;
  readonly #now: () => number;
  readonly #dexBatchSize: number;
  readonly #maxDexes: number;
  readonly #live = new Map<string, CacheEntry<PublicPortfolioLiveEnvelope>>();
  readonly #history = new Map<
    string,
    CacheEntry<PublicPortfolioHistoryEnvelope>
  >();
  #inflight = 0;

  constructor(input: {
    readonly transports: Readonly<
      Record<HyperliquidNetwork, InfoHttpTransport>
    >;
    readonly catalog: MarketCatalogReader;
    readonly now?: () => number;
    readonly dexBatchSize?: number;
    readonly maxDexes?: number;
  }) {
    this.#transports = input.transports;
    this.#catalog = input.catalog;
    this.#now = input.now ?? Date.now;
    this.#dexBatchSize = input.dexBatchSize ?? DEFAULT_DEX_BATCH_SIZE;
    this.#maxDexes = input.maxDexes ?? MAX_DEXES;
    if (
      !Number.isSafeInteger(this.#dexBatchSize) ||
      this.#dexBatchSize < 1 ||
      this.#dexBatchSize > DEFAULT_DEX_BATCH_SIZE
    ) {
      throw new TypeError("Portfolio DEX batch size is invalid.");
    }
    if (
      !Number.isSafeInteger(this.#maxDexes) ||
      this.#maxDexes < 1 ||
      this.#maxDexes > MAX_DEXES
    ) {
      throw new TypeError("Portfolio DEX response limit is invalid.");
    }
  }

  readLive(
    request: PortfolioSnapshotRequest,
  ): Promise<PublicPortfolioLiveEnvelope> {
    return this.#cached(this.#live, request, LIVE_CACHE_MS, () =>
      this.#loadLive(request),
    );
  }

  readHistory(
    request: PortfolioSnapshotRequest,
  ): Promise<PublicPortfolioHistoryEnvelope> {
    return this.#cached(this.#history, request, HISTORY_CACHE_MS, () =>
      this.#loadHistory(request),
    );
  }

  async #loadLive(
    request: PortfolioSnapshotRequest,
  ): Promise<PublicPortfolioLiveEnvelope> {
    const user = validatedUser(request.user);
    const published = await this.#catalog.readPublished(request.network);
    if (!published) {
      throw new PortfolioSnapshotNotReadyError(
        "A published market catalog is required.",
      );
    }
    const catalogDexes = [
      ...new Set(
        published.catalog.markets.flatMap((market) =>
          market.family === "perp" ? [market.dexName] : [],
        ),
      ),
    ];
    const transport = this.#transports[request.network];
    const sourceGaps: string[] = [];
    const addSourceGap = boundedGapRecorder(sourceGaps);
    const selectedDexes = await discoverActiveDexes({
      catalogDexes,
      transport,
      user,
      now: this.#now(),
      signal: request.signal,
      maxDexes: this.#maxDexes,
      addSourceGap,
    });
    const results: PublicPortfolioLiveEnvelope["dexes"][number][] = [];
    for (
      let index = 0;
      index < selectedDexes.length;
      index += this.#dexBatchSize
    ) {
      const batch = selectedDexes.slice(index, index + this.#dexBatchSize);
      const resolved = await Promise.all(
        batch.map(async (dex) => {
          const [clearinghouse, openOrders] = await Promise.allSettled([
            transport.request(
              { type: "clearinghouseState", user, dex },
              { signal: request.signal },
            ),
            transport.request(
              { type: "openOrders", user, dex },
              { signal: request.signal },
            ),
          ]);
          const label = dex || "native";
          if (clearinghouse.status === "rejected") {
            addSourceGap(`Perpetual account source ${label} was unavailable.`);
            return null;
          }
          if (openOrders.status === "rejected") {
            addSourceGap(
              `Open orders for perpetual source ${label} were unavailable.`,
            );
          }
          return {
            dex,
            clearinghouse: clearinghouse.value,
            openOrders:
              openOrders.status === "fulfilled" ? openOrders.value : [],
          };
        }),
      );
      results.push(...resolved.flatMap((value) => (value ? [value] : [])));
    }
    const spot = await transport
      .request(
        { type: "spotClearinghouseState", user },
        { signal: request.signal },
      )
      .then(parsePublicPortfolioSpotState)
      .catch(() => {
        addSourceGap("Spot balances were unavailable.");
        return { balances: [] };
      });
    const envelope: PublicPortfolioLiveEnvelope = {
      schemaVersion: 1,
      network: request.network,
      user,
      generatedAtMs: this.#now(),
      dexes: results,
      spot,
      sourceGaps,
    };
    parsePublicPortfolioLiveSnapshot(envelope, {
      network: request.network,
      user,
    });
    return envelope;
  }

  async #loadHistory(
    request: PortfolioSnapshotRequest,
  ): Promise<PublicPortfolioHistoryEnvelope> {
    const user = validatedUser(request.user);
    const transport = this.#transports[request.network];
    const now = this.#now();
    const [fills, funding, periods] = await Promise.allSettled([
      transport.request(
        { type: "userFills", user, aggregateByTime: true },
        { signal: request.signal },
      ),
      transport.request(
        {
          type: "userFunding",
          user,
          startTime: Math.max(0, now - FUNDING_WINDOW_MS),
        },
        { signal: request.signal },
      ),
      transport.request(
        { type: "portfolio", user },
        { signal: request.signal },
      ),
    ]);
    const sourceGaps = [
      ...(fills.status === "fulfilled"
        ? []
        : ["Fill history was unavailable."]),
      ...(funding.status === "fulfilled"
        ? []
        : ["Funding history was unavailable."]),
      ...(periods.status === "fulfilled"
        ? []
        : ["Performance history was unavailable."]),
    ];
    const envelope: PublicPortfolioHistoryEnvelope = {
      schemaVersion: 1,
      network: request.network,
      user,
      generatedAtMs: now,
      fills: fills.status === "fulfilled" ? fills.value : [],
      funding: funding.status === "fulfilled" ? funding.value : [],
      periods: periods.status === "fulfilled" ? periods.value : [],
      sourceGaps,
    };
    parsePublicPortfolioHistorySnapshot(envelope, {
      network: request.network,
      user,
    });
    return envelope;
  }

  async #cached<T>(
    cache: Map<string, CacheEntry<T>>,
    request: PortfolioSnapshotRequest,
    ttlMs: number,
    load: () => Promise<T>,
  ): Promise<T> {
    if (request.signal?.aborted) throw request.signal.reason;
    const user = validatedUser(request.user);
    const key = `${request.network}:${user}`;
    const cached = cache.get(key);
    if (cached && cached.expiresAt > this.#now()) return cached.value;
    if (this.#inflight >= MAX_INFLIGHT) {
      throw new PortfolioSnapshotBusyError(
        "Portfolio snapshot capacity is exhausted.",
      );
    }
    this.#inflight += 1;
    try {
      const value = await load();
      cache.delete(key);
      cache.set(key, { expiresAt: this.#now() + ttlMs, value });
      while (cache.size > MAX_CACHE_ENTRIES) {
        const oldest = cache.keys().next().value;
        if (oldest === undefined) break;
        cache.delete(oldest);
      }
      return value;
    } finally {
      this.#inflight -= 1;
    }
  }
}

async function discoverActiveDexes(input: {
  readonly catalogDexes: readonly string[];
  readonly transport: InfoHttpTransport;
  readonly user: string;
  readonly now: number;
  readonly signal?: AbortSignal;
  readonly maxDexes: number;
  readonly addSourceGap: (message: string) => void;
}): Promise<readonly string[]> {
  const [orders, fills, funding] = await Promise.allSettled([
    input.transport.request(
      { type: "historicalOrders", user: input.user },
      { signal: input.signal },
    ),
    input.transport.request(
      { type: "userFills", user: input.user, aggregateByTime: false },
      { signal: input.signal },
    ),
    input.transport.request(
      {
        type: "userFunding",
        user: input.user,
        startTime: Math.max(0, input.now - FUNDING_WINDOW_MS),
      },
      { signal: input.signal },
    ),
  ]);
  const coins = new Set<string>();
  collectActivityCoins(
    orders,
    "Recent order DEX discovery",
    MAX_HISTORICAL_ORDERS,
    (value) => nestedText(value, "order", "coin"),
    coins,
    input.addSourceGap,
  );
  collectActivityCoins(
    fills,
    "Recent fill DEX discovery",
    MAX_USER_FILLS,
    (value) => directText(value, "coin"),
    coins,
    input.addSourceGap,
  );
  collectActivityCoins(
    funding,
    "Recent funding DEX discovery",
    MAX_USER_FUNDING,
    (value) => nestedText(value, "delta", "coin"),
    coins,
    input.addSourceGap,
  );

  const active = new Set([""]);
  const known = new Set(input.catalogDexes);
  for (const coin of coins) {
    const delimiter = coin.indexOf(":");
    if (delimiter <= 0) continue;
    const dex = coin.slice(0, delimiter);
    if (known.has(dex)) active.add(dex);
  }
  const selected = [
    "",
    ...input.catalogDexes.filter((dex) => dex !== "" && active.has(dex)),
  ];
  if (selected.length > input.maxDexes) {
    input.addSourceGap(
      "Active perpetual DEX coverage exceeded the bounded response window.",
    );
  }
  return selected.slice(0, input.maxDexes);
}

function collectActivityCoins(
  result: PromiseSettledResult<unknown>,
  label: string,
  responseLimit: number,
  coinFromValue: (value: unknown) => string | undefined,
  coins: Set<string>,
  addSourceGap: (message: string) => void,
): void {
  if (result.status === "rejected") {
    addSourceGap(`${label} was unavailable.`);
    return;
  }
  if (!Array.isArray(result.value)) {
    addSourceGap(`${label} returned an invalid response.`);
    return;
  }
  for (const value of result.value) {
    const coin = coinFromValue(value);
    if (coin) coins.add(coin);
  }
  if (result.value.length >= responseLimit) {
    addSourceGap(`${label} reached its bounded history window.`);
  }
}

function directText(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const result = (value as Readonly<Record<string, unknown>>)[key];
  return typeof result === "string" ? result : undefined;
}

function nestedText(
  value: unknown,
  parent: string,
  key: string,
): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return directText((value as Readonly<Record<string, unknown>>)[parent], key);
}

function boundedGapRecorder(gaps: string[]): (message: string) => void {
  let overflowed = false;
  return (message) => {
    if (gaps.includes(message)) return;
    if (gaps.length < MAX_SOURCE_GAPS - 1) {
      gaps.push(message);
      return;
    }
    if (!overflowed) {
      gaps.push("Additional Portfolio sources were unavailable.");
      overflowed = true;
    }
  };
}

function validatedUser(user: string): string {
  const normalized = user.trim().toLowerCase();
  if (!ADDRESS.test(normalized) || normalized !== user) {
    throw new TypeError("Portfolio snapshots require a lowercase address.");
  }
  return normalized;
}
