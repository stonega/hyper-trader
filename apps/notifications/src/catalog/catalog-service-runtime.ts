import {
  createPublicHyperliquidClient,
  type HyperliquidNetwork,
  type PublicHyperliquidClient,
} from "@hyper-trader/hyperliquid/public";

import type { NotificationDirectTlsServerBoundary } from "../server";
import { startMarketCatalogServer } from "../server";
import type { PostgresMarketCatalogStore } from "./market-catalog-store";
import { MarketCatalogSynchronizer } from "./market-catalog-sync";

const ACTIVE_DELAY_MS = 1_000;
const IDLE_DELAY_MS = 30_000;

export interface MarketCatalogServerRuntimePort {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface MarketCatalogSynchronizerPort {
  runOnce(signal?: AbortSignal): Promise<boolean>;
}

export type MarketCatalogRuntimeSleep = (
  milliseconds: number,
  signal: AbortSignal,
) => Promise<void>;

export class MarketCatalogServiceRuntime {
  readonly #server: MarketCatalogServerRuntimePort;
  readonly #synchronizer: MarketCatalogSynchronizerPort;
  readonly #sleep: MarketCatalogRuntimeSleep;

  constructor(input: {
    readonly server: MarketCatalogServerRuntimePort;
    readonly synchronizer: MarketCatalogSynchronizerPort;
    readonly sleep?: MarketCatalogRuntimeSleep;
  }) {
    this.#server = input.server;
    this.#synchronizer = input.synchronizer;
    this.#sleep = input.sleep ?? abortableSleep;
  }

  async run(signal: AbortSignal): Promise<void> {
    await this.#server.start();
    try {
      while (!signal.aborted) {
        const ran = await this.#synchronizer.runOnce(signal);
        await this.#sleep(ran ? ACTIVE_DELAY_MS : IDLE_DELAY_MS, signal);
      }
    } catch (error) {
      if (!signal.aborted) throw error;
    } finally {
      await this.#server.stop();
    }
  }
}

export function composeMarketCatalogServiceRuntime(input: {
  readonly serviceOrigin: string;
  readonly port: number;
  readonly ownerId: string;
  readonly store: PostgresMarketCatalogStore;
  readonly serverBoundary: NotificationDirectTlsServerBoundary;
  readonly clients?: Readonly<
    Record<HyperliquidNetwork, PublicHyperliquidClient>
  >;
}): MarketCatalogServiceRuntime {
  const clients =
    input.clients ??
    ({
      testnet: createPublicHyperliquidClient({ network: "testnet" }),
      mainnet: createPublicHyperliquidClient({ network: "mainnet" }),
    } satisfies Record<HyperliquidNetwork, PublicHyperliquidClient>);
  const synchronizer = new MarketCatalogSynchronizer({
    ownerId: input.ownerId,
    store: input.store,
    clients,
  });
  let server: Bun.Server<undefined> | undefined;
  return new MarketCatalogServiceRuntime({
    synchronizer,
    server: {
      async start() {
        if (server) return;
        server = startMarketCatalogServer({
          serviceOrigin: input.serviceOrigin,
          port: input.port,
          serverBoundary: input.serverBoundary,
          marketCatalog: input.store,
        });
      },
      async stop() {
        const active = server;
        server = undefined;
        if (active) await active.stop(true);
      },
    },
  });
}

function abortableSleep(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, milliseconds);
    const abort = () => done(signal.reason ?? new Error("aborted"));
    signal.addEventListener("abort", abort, { once: true });
    function done(error?: unknown) {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve();
    }
  });
}
