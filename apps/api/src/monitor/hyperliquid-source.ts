import {
  type MarketCatalog,
  type NotificationAccountSnapshot,
  type OpenWebSocketConnection,
  openPublicWebSocketSession,
  type PublicHyperliquidClient,
  type PublicWebSocketEnvelope,
  type PublicWebSocketSession,
  type WebSocketConnection,
} from "@hyper-trader/hyperliquid/public";
import type { NotificationNetwork } from "@hyper-trader/notifications";
import { CapacityGovernor, NOTIFICATION_CAPACITY_LIMITS } from "./capacity";
import type { MonitorSource, MonitorTarget } from "./registry";

const CATALOG_TTL_MS = 30_000;
const DEX_SNAPSHOT_BATCH = 4;
const FUNDING_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1_000;

export type HyperliquidMonitorPayload =
  | {
      readonly kind: "market-snapshot";
      readonly receivedAt: number;
      readonly market: Readonly<Record<string, unknown>>;
    }
  | {
      readonly kind: "account-snapshot";
      readonly receivedAt: number;
      readonly snapshots: readonly NotificationAccountSnapshot[];
      readonly coinToMarketId: Readonly<Record<string, string>>;
    }
  | {
      readonly kind: "stream-delta";
      readonly receivedAt: number;
      readonly message: PublicWebSocketEnvelope;
      readonly coinToMarketId: Readonly<Record<string, string>>;
    };

interface MarketShard {
  readonly session: PublicWebSocketSession;
  readonly gaps: Map<string, Set<() => void>>;
  readonly releaseConnection: () => void;
  references: number;
}

interface MarketOpening {
  readonly promise: Promise<MarketShard>;
  readonly controller: AbortController;
  waiters: number;
  abandoned: boolean;
  resolved?: MarketShard;
}

interface CatalogEntry {
  readonly expiresAt: number;
  readonly promise: Promise<MarketCatalog>;
  readonly controller: AbortController;
  waiters: number;
  settled: boolean;
}

export class HyperliquidPublicStreamPool {
  readonly #open: OpenWebSocketConnection;
  readonly #now: () => number;
  readonly #capacity: CapacityGovernor;
  readonly #marketShards = new Map<NotificationNetwork, MarketShard>();
  readonly #marketOpenings = new Map<NotificationNetwork, MarketOpening>();
  readonly #connectionAttempts: number[] = [];
  readonly #messages: number[] = [];
  #connections = 0;

  constructor(input: {
    readonly open: OpenWebSocketConnection;
    readonly now?: () => number;
    readonly capacity?: CapacityGovernor;
  }) {
    this.#open = input.open;
    this.#now = input.now ?? Date.now;
    this.#capacity = input.capacity ?? new CapacityGovernor();
  }

  async openMarket(input: {
    readonly network: NotificationNetwork;
    readonly marketId: string;
    readonly coin: string;
    readonly onDelta: (message: PublicWebSocketEnvelope) => void;
    readonly onGap: () => void;
    readonly signal: AbortSignal;
  }): Promise<() => void> {
    if (input.signal.aborted) throw input.signal.reason;
    const shard = await this.#marketShard(input.network, input.signal);
    if (input.signal.aborted) {
      this.#closeUnusedMarketShard(input.network, shard);
      throw input.signal.reason;
    }
    let releaseSubscription: () => void;
    try {
      releaseSubscription = this.#reserveSubscription();
    } catch (error) {
      this.#closeUnusedMarketShard(input.network, shard);
      throw error;
    }
    shard.references += 1;
    let gapCallbacks = shard.gaps.get(input.marketId);
    if (!gapCallbacks) {
      gapCallbacks = new Set();
      shard.gaps.set(input.marketId, gapCallbacks);
    }
    gapCallbacks.add(input.onGap);
    let unsubscribe: () => void;
    try {
      unsubscribe = shard.session.subscribe(
        { type: "activeAssetCtx", coin: input.coin },
        input.onDelta,
      );
    } catch (error) {
      releaseSubscription();
      gapCallbacks.delete(input.onGap);
      if (gapCallbacks.size === 0) shard.gaps.delete(input.marketId);
      shard.references -= 1;
      if (shard.references === 0) {
        shard.session.close();
        this.#marketShards.delete(input.network);
        shard.releaseConnection();
      }
      throw error;
    }
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      input.signal.removeEventListener("abort", close);
      unsubscribe();
      releaseSubscription();
      gapCallbacks?.delete(input.onGap);
      if (gapCallbacks?.size === 0) shard.gaps.delete(input.marketId);
      shard.references -= 1;
      if (shard.references === 0) {
        shard.session.close();
        this.#marketShards.delete(input.network);
        shard.releaseConnection();
      }
    };
    input.signal.addEventListener("abort", close, { once: true });
    return close;
  }

  async openAccount(input: {
    readonly network: NotificationNetwork;
    readonly address: string;
    readonly onDelta: (message: PublicWebSocketEnvelope) => void;
    readonly onGap: () => void;
    readonly signal: AbortSignal;
  }): Promise<() => void> {
    if (input.signal.aborted) throw input.signal.reason;
    const releaseConnection = this.#reserveConnection();
    let session: PublicWebSocketSession;
    try {
      session = await openPublicWebSocketSession({
        network: input.network,
        open: (url, options) => this.#openBudgeted(url, options),
        signal: input.signal,
        maxSubscriptions: NOTIFICATION_CAPACITY_LIMITS.websocketSubscriptions,
        onGap: input.onGap,
        onInvalidMessage: () => undefined,
        reserveSubscriptionOperation: () =>
          this.#reserveSubscriptionOperation(),
      });
    } catch (error) {
      releaseConnection();
      throw error;
    }
    const subscriptions: Array<{
      readonly unsubscribe: () => void;
      readonly release: () => void;
    }> = [];
    try {
      for (const subscription of [
        {
          type: "userFills" as const,
          user: input.address,
          aggregateByTime: false,
        },
        { type: "userFundings" as const, user: input.address },
        { type: "orderUpdates" as const, user: input.address },
        { type: "userEvents" as const, user: input.address },
        { type: "allDexsClearinghouseState" as const, user: input.address },
      ]) {
        const release = this.#reserveSubscription();
        try {
          subscriptions.push({
            unsubscribe: session.subscribe(subscription, input.onDelta),
            release,
          });
        } catch (error) {
          release();
          throw error;
        }
      }
    } catch (error) {
      for (const subscription of subscriptions) {
        subscription.unsubscribe();
        subscription.release();
      }
      session.close();
      releaseConnection();
      throw error;
    }
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      input.signal.removeEventListener("abort", close);
      for (const subscription of subscriptions) {
        subscription.unsubscribe();
        subscription.release();
      }
      session.close();
      releaseConnection();
    };
    input.signal.addEventListener("abort", close, { once: true });
    return close;
  }

  usage(): { readonly connections: number; readonly attemptsInWindow: number } {
    this.#pruneAttempts();
    return {
      connections: this.#connections,
      attemptsInWindow: this.#connectionAttempts.length,
    };
  }

  #reserveConnection(): () => void {
    this.#pruneAttempts();
    if (
      this.#connections + 1 >
        NOTIFICATION_CAPACITY_LIMITS.websocketConnections ||
      this.#connectionAttempts.length + 1 >
        NOTIFICATION_CAPACITY_LIMITS.websocketConnectionsPerMinute
    ) {
      throw new Error("Hyperliquid WebSocket capacity is exhausted");
    }
    const releaseCapacity = this.#capacity.tryReserve(
      "websocketConnections",
      1,
    );
    if (!releaseCapacity) {
      throw new Error("Hyperliquid WebSocket capacity is exhausted");
    }
    this.#connections += 1;
    this.#connectionAttempts.push(this.#now());
    this.#capacity.observe(
      "websocketConnectionsPerMinute",
      this.#connectionAttempts.length,
    );
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#connections -= 1;
      releaseCapacity();
    };
  }

  #marketShard(
    network: NotificationNetwork,
    signal: AbortSignal,
  ): Promise<MarketShard> {
    const existing = this.#marketShards.get(network);
    if (existing) return Promise.resolve(existing);
    let opening = this.#marketOpenings.get(network);
    if (!opening) {
      const controller = new AbortController();
      let resolveOpening!: (shard: MarketShard) => void;
      let rejectOpening!: (error: unknown) => void;
      const promise = new Promise<MarketShard>((resolve, reject) => {
        resolveOpening = resolve;
        rejectOpening = reject;
      });
      const state: MarketOpening = {
        promise,
        controller,
        waiters: 0,
        abandoned: false,
      };
      void (async () => {
        const releaseConnection = this.#reserveConnection();
        const gaps = new Map<string, Set<() => void>>();
        try {
          const session = await openPublicWebSocketSession({
            network,
            open: (url, options) => this.#openBudgeted(url, options),
            signal: controller.signal,
            maxSubscriptions:
              NOTIFICATION_CAPACITY_LIMITS.websocketSubscriptions,
            onGap: () => {
              for (const callbacks of gaps.values()) {
                for (const callback of callbacks) callback();
              }
            },
            onInvalidMessage: () => undefined,
            reserveSubscriptionOperation: () =>
              this.#reserveSubscriptionOperation(),
          });
          const shard = { session, gaps, releaseConnection, references: 0 };
          state.resolved = shard;
          if (state.abandoned) {
            session.close();
            releaseConnection();
            throw new Error("Hyperliquid market shard opening was abandoned");
          }
          this.#marketShards.set(network, shard);
          return shard;
        } catch (error) {
          releaseConnection();
          throw error;
        }
      })().then(resolveOpening, rejectOpening);
      opening = state;
      this.#marketOpenings.set(network, opening);
    }
    opening.waiters += 1;
    let obtained = false;
    return waitForShared(opening.promise, signal)
      .then((shard) => {
        if (signal.aborted) throw signal.reason;
        obtained = true;
        return shard;
      })
      .finally(() => {
        opening.waiters -= 1;
        if (!obtained && opening.waiters === 0) {
          opening.abandoned = true;
          opening.controller.abort(
            new Error("Hyperliquid market shard opening was abandoned"),
          );
        }
        if (opening.waiters === 0) {
          if (this.#marketOpenings.get(network) === opening) {
            this.#marketOpenings.delete(network);
          }
          if (opening.abandoned && opening.resolved) {
            this.#closeUnusedMarketShard(network, opening.resolved);
          }
        }
      });
  }

  #closeUnusedMarketShard(
    network: NotificationNetwork,
    shard: MarketShard,
  ): void {
    if (
      shard.references !== 0 ||
      this.#marketShards.get(network) !== shard ||
      (this.#marketOpenings.get(network)?.waiters ?? 0) > 0
    ) {
      return;
    }
    this.#marketShards.delete(network);
    shard.session.close();
    shard.releaseConnection();
  }

  #pruneAttempts(): void {
    const cutoff = this.#now() - 60_000;
    while (
      (this.#connectionAttempts[0] ?? Number.POSITIVE_INFINITY) <= cutoff
    ) {
      this.#connectionAttempts.shift();
    }
    this.#capacity.observe(
      "websocketConnectionsPerMinute",
      this.#connectionAttempts.length,
    );
  }

  async #openBudgeted(
    url: string,
    options: { readonly signal?: AbortSignal },
  ): Promise<WebSocketConnection> {
    const connection = await this.#open(url, options);
    return {
      send: (data) => this.#sendBudgeted(connection, data),
      close: () => connection.close(),
      addMessageListener: (listener) => connection.addMessageListener(listener),
      ...(connection.addCloseListener
        ? {
            addCloseListener: (listener: () => void) =>
              connection.addCloseListener?.(listener) ?? (() => undefined),
          }
        : {}),
    };
  }

  #sendBudgeted(connection: WebSocketConnection, data: string): void {
    const cutoff = this.#now() - 60_000;
    while ((this.#messages[0] ?? Number.POSITIVE_INFINITY) <= cutoff) {
      this.#messages.shift();
    }
    this.#capacity.observe("websocketMessagesPerMinute", this.#messages.length);
    const releaseMessage = this.#capacity.tryReserve(
      "websocketMessagesPerMinute",
      1,
    );
    if (!releaseMessage) {
      throw new Error("Hyperliquid WebSocket message capacity is exhausted");
    }
    try {
      connection.send(data);
      this.#messages.push(this.#now());
      this.#capacity.observe(
        "websocketMessagesPerMinute",
        this.#messages.length,
      );
    } finally {
      releaseMessage();
    }
  }

  #reserveSubscriptionOperation(): () => void {
    const release = this.#capacity.tryReserve("websocketInflightPosts", 1);
    if (!release) {
      throw new Error("Hyperliquid WebSocket operation capacity is exhausted");
    }
    return release;
  }

  #reserveSubscription(): () => void {
    const release = this.#capacity.tryReserve("websocketSubscriptions", 1);
    if (!release) {
      throw new Error(
        "Hyperliquid WebSocket subscription capacity is exhausted",
      );
    }
    return release;
  }
}

export class HyperliquidMonitorSource implements MonitorSource {
  readonly #clients: Readonly<
    Record<NotificationNetwork, PublicHyperliquidClient>
  >;
  readonly #streams: HyperliquidPublicStreamPool;
  readonly #now: () => number;
  readonly #capacity: CapacityGovernor;
  readonly #catalogReader?: {
    readPublished(network: NotificationNetwork): Promise<{
      readonly catalog: MarketCatalog;
    } | null>;
  };
  readonly #restAdmissions: number[] = [];
  readonly #marketIds = new Map<
    NotificationNetwork,
    Readonly<Record<string, string>>
  >();
  readonly #catalogs = new Map<NotificationNetwork, CatalogEntry>();

  constructor(input: {
    readonly clients: Readonly<
      Record<NotificationNetwork, PublicHyperliquidClient>
    >;
    readonly streams: HyperliquidPublicStreamPool;
    readonly now?: () => number;
    readonly capacity?: CapacityGovernor;
    readonly catalogReader?: {
      readPublished(network: NotificationNetwork): Promise<{
        readonly catalog: MarketCatalog;
      } | null>;
    };
  }) {
    this.#clients = input.clients;
    this.#streams = input.streams;
    this.#now = input.now ?? Date.now;
    this.#capacity = input.capacity ?? new CapacityGovernor();
    this.#catalogReader = input.catalogReader;
  }

  async loadAuthoritativeSnapshot(
    target: MonitorTarget,
    signal: AbortSignal,
  ): Promise<HyperliquidMonitorPayload> {
    if (signal.aborted) throw signal.reason;
    const boundedSignal = AbortSignal.any([
      signal,
      AbortSignal.timeout(10_000),
    ]);
    const client = this.#clients[target.network];
    const catalog = await this.#loadCatalog(target.network, boundedSignal);
    const coinToMarketId = unambiguousCoinMap(catalog);
    this.#marketIds.set(target.network, coinToMarketId);
    if (target.kind === "market") {
      const market = catalog.markets.find(
        (candidate) => candidate.canonicalId === target.marketId,
      );
      if (!market) throw new Error("notification market is unavailable");
      return {
        kind: "market-snapshot",
        receivedAt: this.#now(),
        market: market as unknown as Readonly<Record<string, unknown>>,
      };
    }
    if (catalog.sourceErrors.length > 0) {
      throw new Error("Hyperliquid market catalog baseline is incomplete");
    }
    const dexes = [
      ...new Set(
        catalog.markets
          .filter((market) => market.family === "perp")
          .map((market) => market.dexName),
      ),
    ];
    const selectedDexes = dexes.length === 0 ? [""] : dexes;
    const fundingStartTime = Math.max(0, this.#now() - FUNDING_LOOKBACK_MS);
    for (const requestType of [
      "historicalOrders",
      "userFills",
      "userFunding",
    ]) {
      const projected = client.getRequestBudget(requestType, 500);
      this.#admitRestWeight(projected.totalWeight - projected.baseWeight);
    }
    const requestOptions = {
      signal: boundedSignal,
      onRequestBudget: (budget: { readonly totalWeight: number }) =>
        this.#admitRestWeight(budget.totalWeight),
    };
    const global = await client.getNotificationAccountGlobalSnapshot(
      { user: target.address, fundingStartTime },
      requestOptions,
    );
    const dexSnapshots: Awaited<
      ReturnType<PublicHyperliquidClient["getNotificationAccountDexSnapshot"]>
    >[] = [];
    for (
      let offset = 0;
      offset < selectedDexes.length;
      offset += DEX_SNAPSHOT_BATCH
    ) {
      if (boundedSignal.aborted) throw boundedSignal.reason;
      const batch = selectedDexes.slice(offset, offset + DEX_SNAPSHOT_BATCH);
      dexSnapshots.push(
        ...(await Promise.all(
          batch.map((dex) =>
            client.getNotificationAccountDexSnapshot(
              { user: target.address, dex },
              requestOptions,
            ),
          ),
        )),
      );
    }
    const snapshots: NotificationAccountSnapshot[] = dexSnapshots.map(
      (dex) => ({
        ...dex,
        historicalOrders: global.historicalOrders,
        fills: global.fills,
        funding: global.funding,
      }),
    );
    return {
      kind: "account-snapshot",
      receivedAt: this.#now(),
      snapshots,
      coinToMarketId,
    };
  }

  async openStream(
    target: MonitorTarget,
    callbacks: {
      readonly onDelta: (value: unknown) => void;
      readonly onGap: () => void;
    },
    signal: AbortSignal,
  ): Promise<() => void> {
    const coinToMarketId = this.#marketIds.get(target.network) ?? {};
    const onDelta = (message: PublicWebSocketEnvelope) => {
      callbacks.onDelta({
        kind: "stream-delta",
        receivedAt: this.#now(),
        message,
        coinToMarketId,
      } satisfies HyperliquidMonitorPayload);
    };
    if (target.kind === "account") {
      return this.#streams.openAccount({
        network: target.network,
        address: target.address,
        onDelta,
        onGap: callbacks.onGap,
        signal,
      });
    }
    const coin = Object.entries(coinToMarketId).find(
      ([, marketId]) => marketId === target.marketId,
    )?.[0];
    if (!coin) throw new Error("market snapshot is required before streaming");
    return this.#streams.openMarket({
      network: target.network,
      marketId: target.marketId,
      coin,
      onDelta,
      onGap: callbacks.onGap,
      signal,
    });
  }

  #admitRestWeight(weight: number): void {
    const cutoff = this.#now() - 60_000;
    while ((this.#restAdmissions[0] ?? Number.POSITIVE_INFINITY) <= cutoff) {
      this.#restAdmissions.shift();
    }
    this.#capacity.observe("restWeightPerMinute", this.#restAdmissions.length);
    if (
      this.#restAdmissions.length + weight >
      NOTIFICATION_CAPACITY_LIMITS.restWeightPerMinute
    ) {
      throw new Error("Hyperliquid REST capacity is exhausted");
    }
    for (let index = 0; index < weight; index += 1) {
      this.#restAdmissions.push(this.#now());
    }
    this.#capacity.observe("restWeightPerMinute", this.#restAdmissions.length);
  }

  #loadCatalog(
    network: NotificationNetwork,
    signal: AbortSignal,
  ): Promise<MarketCatalog> {
    const existing = this.#catalogs.get(network);
    if (existing && existing.expiresAt > this.#now()) {
      return this.#waitForCatalog(network, existing, signal);
    }
    const client = this.#clients[network];
    const controller = new AbortController();
    let entry: CatalogEntry;
    const promise = this.#readCatalog(network, client, controller.signal)
      .finally(() => {
        entry.settled = true;
      })
      .catch((error) => {
        if (this.#catalogs.get(network)?.promise === promise) {
          this.#catalogs.delete(network);
        }
        throw error;
      });
    entry = {
      promise,
      expiresAt: this.#now() + CATALOG_TTL_MS,
      controller,
      waiters: 0,
      settled: false,
    };
    this.#catalogs.set(network, entry);
    return this.#waitForCatalog(network, entry, signal);
  }

  async #readCatalog(
    network: NotificationNetwork,
    client: PublicHyperliquidClient,
    signal: AbortSignal,
  ): Promise<MarketCatalog> {
    const published = await this.#catalogReader?.readPublished(network);
    if (signal.aborted) throw signal.reason;
    if (published) return published.catalog;
    return client.getMarketCatalog({
      scope: "core",
      signal,
      onRequestBudget: (budget) => this.#admitRestWeight(budget.totalWeight),
    });
  }

  #waitForCatalog(
    network: NotificationNetwork,
    entry: CatalogEntry,
    signal: AbortSignal,
  ): Promise<MarketCatalog> {
    entry.waiters += 1;
    return waitForShared(entry.promise, signal).finally(() => {
      entry.waiters -= 1;
      if (entry.waiters === 0 && !entry.settled) {
        if (this.#catalogs.get(network) === entry) {
          this.#catalogs.delete(network);
        }
        entry.controller.abort(new Error("catalog baseline has no consumers"));
      }
    });
  }
}

function unambiguousCoinMap(
  catalog: MarketCatalog,
): Readonly<Record<string, string>> {
  const identities = new Map<string, string | null>();
  for (const market of catalog.markets) {
    const existing = identities.get(market.coin);
    identities.set(
      market.coin,
      existing === undefined || existing === market.canonicalId
        ? market.canonicalId
        : null,
    );
  }
  return Object.fromEntries(
    Array.from(identities, ([coin, marketId]) => [coin, marketId]).filter(
      (entry): entry is [string, string] => entry[1] !== null,
    ),
  );
}

function waitForShared<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}
