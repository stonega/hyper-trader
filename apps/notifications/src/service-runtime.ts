import {
  createPublicHyperliquidClient,
  type OpenWebSocketConnection,
  type PublicHyperliquidClient,
} from "@hyper-trader/hyperliquid/public";
import type { NotificationNetwork } from "@hyper-trader/notifications";

import type { NotificationApplication } from "./application";
import type { NotificationServiceConfig } from "./config";
import type { PostgresNotificationStore } from "./db/notification-store";
import { BoundedNotificationMetrics } from "./metrics/bounded-metrics";
import { CapacityGovernor } from "./monitor/capacity";
import {
  HyperliquidMonitorSource,
  HyperliquidPublicStreamPool,
} from "./monitor/hyperliquid-source";
import {
  postgresMonitorLeasePort,
  postgresWorkerRuntimeOwnership,
} from "./monitor/postgres-leases";
import { SharedMonitorRegistry } from "./monitor/registry";
import { NotificationDeliveryWorker } from "./outbox/delivery-worker";
import { NotificationReceiptWorker } from "./outbox/receipt-worker";
import type { ExpoPushClient } from "./push/expo-push-client";
import { NotificationRuleWorker } from "./rules/rule-worker";
import { startNotificationServer } from "./server";
import { NotificationWorkerSupervisor } from "./worker-supervisor";

export interface NotificationServerRuntimePort {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export type RuntimeSleep = (
  milliseconds: number,
  signal: AbortSignal,
) => Promise<void>;

export class NotificationServiceRuntime {
  readonly #server: NotificationServerRuntimePort;
  readonly #workers: NotificationWorkerSupervisor;
  readonly #sleep: RuntimeSleep;
  readonly #jitter: () => number;
  #tick: Promise<void> | null = null;
  #failures = 0;

  constructor(input: {
    readonly server: NotificationServerRuntimePort;
    readonly workers: NotificationWorkerSupervisor;
    readonly sleep?: RuntimeSleep;
    readonly jitter?: () => number;
  }) {
    this.#server = input.server;
    this.#workers = input.workers;
    this.#sleep = input.sleep ?? abortableSleep;
    this.#jitter = input.jitter ?? Math.random;
  }

  async run(signal: AbortSignal): Promise<void> {
    await this.#server.start();
    try {
      while (!signal.aborted) {
        const ran = await this.tickOnce();
        if (ran) this.#failures = 0;
        const base = ran ? 1_000 : Math.min(30_000, 250 * 2 ** this.#failures);
        if (!ran) this.#failures = Math.min(this.#failures + 1, 7);
        const delay = Math.floor(
          base * (0.75 + clampJitter(this.#jitter()) * 0.5),
        );
        await this.#sleep(delay, signal);
      }
    } catch (error) {
      if (!signal.aborted) throw error;
    } finally {
      await this.#workers.stop();
      await this.#server.stop();
    }
  }

  async tickOnce(): Promise<boolean> {
    if (this.#tick) return false;
    let succeeded = false;
    const tick = (async () => {
      try {
        if ((await this.#workers.activate()) !== "active") return;
        await this.#workers.runOnce();
        succeeded = true;
      } catch {
        await this.#workers.deactivate("dependencies_blocked");
      }
    })().finally(() => {
      if (this.#tick === tick) this.#tick = null;
    });
    this.#tick = tick;
    await tick;
    return succeeded;
  }
}

export function composeNotificationServiceRuntime(input: {
  readonly config: NotificationServiceConfig;
  readonly ownerId: string;
  readonly store: PostgresNotificationStore;
  readonly application: NotificationApplication;
  readonly openWebSocket: OpenWebSocketConnection;
  readonly expo: Pick<ExpoPushClient, "send" | "getReceipts">;
  readonly dependenciesReady: () => Promise<boolean>;
  readonly clients?: Readonly<
    Record<NotificationNetwork, PublicHyperliquidClient>
  >;
  readonly server?: NotificationServerRuntimePort;
  readonly metrics?: BoundedNotificationMetrics;
}): {
  readonly runtime: NotificationServiceRuntime;
  readonly metrics: BoundedNotificationMetrics;
} {
  const metrics = input.metrics ?? new BoundedNotificationMetrics();
  const publishedHealth = new Map<string, number>();
  const publishHealth = (
    name:
      | "monitor_leases"
      | "outbox_pending"
      | "receipt_pending"
      | "upstream_utilization_percent",
    value: number,
  ) => {
    if (publishedHealth.get(name) === value) return;
    publishedHealth.set(name, value);
    metrics.set(name, value);
  };
  const capacity = new CapacityGovernor();
  const clients =
    input.clients ??
    ({
      testnet: createPublicHyperliquidClient({ network: "testnet" }),
      mainnet: createPublicHyperliquidClient({ network: "mainnet" }),
    } satisfies Record<NotificationNetwork, PublicHyperliquidClient>);
  const streams = new HyperliquidPublicStreamPool({
    open: input.openWebSocket,
    capacity,
  });
  const registry = new SharedMonitorRegistry({
    ownerId: input.ownerId,
    leases: postgresMonitorLeasePort(input.store),
    source: new HyperliquidMonitorSource({ clients, streams, capacity }),
    capacity,
    onListenerError: () => metrics.increment("subscription_rejections"),
    onMonitorError: () => metrics.increment("subscription_rejections"),
    onRebaseline: () => metrics.increment("monitor_rebaselines"),
  });
  const workers = new NotificationWorkerSupervisor({
    config: input.config,
    ownerId: input.ownerId,
    ownership: postgresWorkerRuntimeOwnership(input.store),
    store: input.store,
    capacity,
    dependenciesReady: input.dependenciesReady,
    onHealth: (health) => {
      publishHealth("monitor_leases", health.monitorLeases);
      publishHealth("outbox_pending", health.outboxPending);
      publishHealth("receipt_pending", health.receiptPending);
      publishHealth(
        "upstream_utilization_percent",
        health.upstreamUtilizationPercent,
      );
    },
    rules: new NotificationRuleWorker({
      store: input.store,
      registry,
      onError: (kind) => {
        if (kind === "degraded") metrics.increment("subscription_rejections");
      },
    }),
    delivery: new NotificationDeliveryWorker({
      workerId: input.ownerId,
      store: input.store,
      provider: input.expo,
      onEvent: (event) => {
        metrics.increment(
          event === "attempt" ? "delivery_attempts" : `delivery_${event}`,
          event === "attempt"
            ? { provider: "expo" }
            : { provider: "expo", outcome: event },
        );
      },
    }),
    receipts: new NotificationReceiptWorker({
      workerId: input.ownerId,
      store: input.store,
      provider: input.expo,
      onEvent: (event) => {
        metrics.increment(
          event === "pending" ? "receipt_pending" : "receipt_failed",
          { provider: "expo" },
        );
      },
    }),
  });
  return {
    runtime: new NotificationServiceRuntime({
      workers,
      server:
        input.server ??
        notificationBunServerPort({
          application: input.application,
          serviceOrigin: input.config.serviceOrigin,
          port: input.config.port,
        }),
    }),
    metrics,
  };
}

function notificationBunServerPort(input: {
  readonly application: NotificationApplication;
  readonly serviceOrigin: string;
  readonly port: number;
}): NotificationServerRuntimePort {
  let server: Bun.Server<undefined> | undefined;
  return {
    async start() {
      if (server) return;
      server = startNotificationServer(input);
    },
    async stop() {
      const active = server;
      server = undefined;
      if (active) await active.stop(true);
    },
  };
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

function clampJitter(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.5;
}
