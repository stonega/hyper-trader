import {
  HyperliquidApiError,
  type HyperliquidNetwork,
  type InfoRequestBudget,
  type MarketCatalog,
  type PublicHyperliquidClient,
} from "@hyper-trader/hyperliquid/public";
import type {
  MarketCatalogSyncLease,
  PostgresMarketCatalogStore,
} from "./market-catalog-store";

const BUILDER_PAGE_SIZE = 37;
const REST_WEIGHT_CEILING = 840;
const CLAIM_CHECK_INTERVAL_MS = 30_000;

export interface MarketCatalogSyncStore {
  claimDueSync(
    network: HyperliquidNetwork,
    ownerId: string,
  ): Promise<MarketCatalogSyncLease | null>;
  completeCore(
    lease: MarketCatalogSyncLease,
    catalog: MarketCatalog,
  ): Promise<void>;
  completeBuilderPage(
    lease: MarketCatalogSyncLease,
    catalog: MarketCatalog,
  ): Promise<{ readonly published: boolean }>;
  recordFailure(
    lease: MarketCatalogSyncLease,
    retryAfterMs?: number,
  ): Promise<void>;
}

export class MarketCatalogSynchronizer {
  readonly #ownerId: string;
  readonly #store: MarketCatalogSyncStore;
  readonly #clients: Readonly<
    Record<HyperliquidNetwork, PublicHyperliquidClient>
  >;
  readonly #now: () => number;
  readonly #onError?: (error: unknown) => void;
  #nextClaimCheckAt = 0;

  constructor(input: {
    readonly ownerId: string;
    readonly store: PostgresMarketCatalogStore | MarketCatalogSyncStore;
    readonly clients: Readonly<
      Record<HyperliquidNetwork, PublicHyperliquidClient>
    >;
    readonly now?: () => number;
    readonly onError?: (error: unknown) => void;
  }) {
    if (!/^[a-z0-9:_-]{1,128}$/.test(input.ownerId)) {
      throw new Error("market catalog sync owner ID is invalid");
    }
    this.#ownerId = input.ownerId;
    this.#store = input.store;
    this.#clients = input.clients;
    this.#now = input.now ?? Date.now;
    this.#onError = input.onError;
  }

  async runOnce(signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted) throw signal.reason;
    if (this.#now() < this.#nextClaimCheckAt) return false;
    this.#nextClaimCheckAt = this.#now() + CLAIM_CHECK_INTERVAL_MS;

    for (const network of ["testnet", "mainnet"] as const) {
      const lease = await this.#store.claimDueSync(network, this.#ownerId);
      if (!lease) continue;
      try {
        const catalog = lease.coreReady
          ? await this.#builderPage(lease, signal)
          : await this.#core(lease, signal);
        if (lease.coreReady) {
          await this.#store.completeBuilderPage(lease, catalog);
        } else {
          await this.#store.completeCore(lease, catalog);
        }
      } catch (error) {
        await this.#store.recordFailure(lease, retryAfterMilliseconds(error));
        if (signal?.aborted) throw signal.reason;
        this.#onError?.(error);
      }
      return true;
    }
    return false;
  }

  async #core(
    lease: MarketCatalogSyncLease,
    signal: AbortSignal | undefined,
  ): Promise<MarketCatalog> {
    const admit = restBudgetAdmission();
    const catalog = await this.#clients[lease.network].getMarketCatalog({
      scope: "core",
      signal,
      onRequestBudget: admit,
    });
    if (
      !catalog.markets.some(
        (market) => market.family === "perp" && market.dexIndex === 0,
      )
    ) {
      throw new Error(
        "market catalog core contains no validated native perpetual markets",
      );
    }
    return catalog;
  }

  #builderPage(
    lease: MarketCatalogSyncLease,
    signal: AbortSignal | undefined,
  ): Promise<MarketCatalog> {
    const admit = restBudgetAdmission();
    return this.#clients[lease.network].getMarketCatalog({
      scope: "incremental",
      builderDexOffset: lease.nextBuilderOffset,
      builderDexLimit: BUILDER_PAGE_SIZE,
      signal,
      onRequestBudget: admit,
    });
  }
}

function restBudgetAdmission(): (budget: InfoRequestBudget) => void {
  let admitted = 0;
  return (budget) => {
    if (admitted + budget.totalWeight > REST_WEIGHT_CEILING) {
      throw new Error("market catalog REST weight ceiling is exhausted");
    }
    admitted += budget.totalWeight;
  };
}

function retryAfterMilliseconds(error: unknown): number | undefined {
  if (!(error instanceof HyperliquidApiError)) return undefined;
  return error.rateLimit?.retryAfterMs;
}
