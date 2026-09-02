import {
  createInfoHttpTransport,
  createPublicHyperliquidClient,
  type HyperliquidNetwork,
  type PublicHyperliquidClient,
} from "@hyper-trader/hyperliquid/public";

import { MarketCatalogSynchronizer } from "../catalog/market-catalog-sync";
import { HyperliquidPortfolioSnapshotReader } from "../portfolio/portfolio-snapshot-reader";
import { createMarketCatalogRequestHandler } from "../server";
import { createCloudflareNoRedirectFetch } from "./cloudflare-fetch";
import { D1MarketCatalogStore } from "./d1-market-catalog-store";

interface Env {
  readonly BACKEND_DB: D1Database;
  readonly BACKEND_ORIGIN: string;
}

interface WorkerRuntime {
  readonly handler: (request: Request) => Promise<Response>;
  readonly synchronize: () => Promise<void>;
}

type RuntimeForEnvironment = (env: Env) => WorkerRuntime;

let cached:
  | { readonly database: D1Database; readonly runtime: WorkerRuntime }
  | undefined;
const cloudflareNoRedirectFetch = createCloudflareNoRedirectFetch();

export function createCloudflareWorker(
  runtimeForEnvironment: RuntimeForEnvironment,
) {
  return {
    fetch(request, env): Promise<Response> {
      return runtimeForEnvironment(env).handler(request);
    },
    scheduled(_controller, env, context): void {
      context.waitUntil(runtimeForEnvironment(env).synchronize());
    },
  } satisfies ExportedHandler<Env>;
}

export default createCloudflareWorker(runtimeFor);

function runtimeFor(env: Env): WorkerRuntime {
  if (cached?.database === env.BACKEND_DB) return cached.runtime;
  const store = new D1MarketCatalogStore(env.BACKEND_DB);
  const synchronizer = new MarketCatalogSynchronizer({
    ownerId: `cloudflare:${crypto.randomUUID()}`,
    store,
    clients: {
      testnet: catalogClient("testnet"),
      mainnet: catalogClient("mainnet"),
    },
    onError: (error) => {
      console.error("market catalog synchronization failed", {
        name: error instanceof Error ? error.name : "UnknownError",
        message: error instanceof Error ? error.message : "unknown failure",
      });
    },
  });
  const portfolioSnapshots = new HyperliquidPortfolioSnapshotReader({
    catalog: store,
    dexBatchSize: 3,
    maxDexes: 16,
    transports: {
      testnet: createInfoHttpTransport({
        network: "testnet",
        fetch: cloudflareNoRedirectFetch,
      }),
      mainnet: createInfoHttpTransport({
        network: "mainnet",
        fetch: cloudflareNoRedirectFetch,
      }),
    },
  });
  let synchronization: Promise<void> | undefined;
  const runtime: WorkerRuntime = {
    handler: createMarketCatalogRequestHandler({
      serviceOrigin: env.BACKEND_ORIGIN,
      marketCatalog: store,
      portfolioSnapshots,
    }),
    synchronize() {
      if (synchronization) return synchronization;
      synchronization = synchronizer
        .runOnce()
        .then(() => undefined)
        .finally(() => {
          synchronization = undefined;
        });
      return synchronization;
    },
  };
  cached = { database: env.BACKEND_DB, runtime };
  return runtime;
}

function catalogClient(network: HyperliquidNetwork): PublicHyperliquidClient {
  const client = createPublicHyperliquidClient({
    network,
    fetch: cloudflareNoRedirectFetch,
  });
  return {
    ...client,
    async getMarketCatalog(options) {
      const catalog = await client.getMarketCatalog(options);
      if (
        !catalog.markets.some(
          (market) => market.family === "perp" && market.dexIndex === 0,
        )
      ) {
        console.error("market catalog core source failures", {
          network,
          errors: catalog.sourceErrors.map((error) => ({
            source: error.source,
            message: error.message,
            ...(error.status === undefined ? {} : { status: error.status }),
          })),
        });
      }
      return catalog;
    },
  };
}
