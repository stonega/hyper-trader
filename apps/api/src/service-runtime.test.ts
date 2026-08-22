import { describe, expect, test } from "bun:test";
import type { NotificationApplication } from "./application";
import type { NotificationServiceConfig } from "./config";
import type { PostgresNotificationStore } from "./db/notification-store";
import {
  composeNotificationServiceRuntime,
  NotificationServiceRuntime,
} from "./service-runtime";
import { NotificationWorkerSupervisor } from "./worker-supervisor";

const config: NotificationServiceConfig = {
  serviceOrigin: "https://notify.example.com",
  databaseUrl: "postgres://notification.internal/hyper_trader",
  port: 8788,
  providerWorkersEnabled: true,
  upstreamUtilizationPercent: 70,
};

describe("notification service runtime", () => {
  test("suppresses overlapping ticks and performs expensive activation once", async () => {
    let activations = 0;
    let releaseDelivery: (() => void) | undefined;
    const supervisor = new NotificationWorkerSupervisor({
      config,
      ownerId: "runtime-a",
      ownership: {
        acquire: async () => ({ acquired: true, generation: 1 }),
        renew: async () => true,
        release: async () => undefined,
      },
      store: {
        activateWorkerGates: async () => {
          activations += 1;
        },
        deactivateWorkerGates: async () => undefined,
      },
      rules: {
        reconcileRules: async () => undefined,
        close: async () => undefined,
      },
      delivery: {
        runOnce: () =>
          new Promise<boolean>((resolve) => {
            releaseDelivery = () => resolve(true);
          }),
      },
      receipts: { runOnce: async () => 0 },
      dependenciesReady: async () => true,
    });
    const runtime = new NotificationServiceRuntime({
      server: { start: async () => undefined, stop: async () => undefined },
      workers: supervisor,
    });
    const first = runtime.tickOnce();
    expect(await runtime.tickOnce()).toBe(false);
    await waitUntil(() => releaseDelivery !== undefined);
    releaseDelivery?.();
    expect(await first).toBe(true);
    releaseDelivery = undefined;
    const next = runtime.tickOnce();
    await waitUntil(() => releaseDelivery !== undefined);
    releaseDelivery?.();
    expect(await next).toBe(true);
    expect(activations).toBe(1);
  });

  test("runs catalog synchronization independently of disabled provider workers", async () => {
    let catalogRuns = 0;
    const supervisor = new NotificationWorkerSupervisor({
      config: { ...config, providerWorkersEnabled: false },
      ownerId: "runtime-catalog",
      ownership: {
        acquire: async () => ({ acquired: false as const }),
        renew: async () => false,
        release: async () => undefined,
      },
      store: {
        activateWorkerGates: async () => undefined,
        deactivateWorkerGates: async () => undefined,
      },
      rules: {
        reconcileRules: async () => undefined,
        close: async () => undefined,
      },
      delivery: { runOnce: async () => false },
      receipts: { runOnce: async () => 0 },
      dependenciesReady: async () => false,
    });
    const runtime = new NotificationServiceRuntime({
      server: { start: async () => undefined, stop: async () => undefined },
      workers: supervisor,
      catalogSync: {
        runOnce: async () => {
          catalogRuns += 1;
          return true;
        },
      },
    });

    expect(await runtime.tickOnce()).toBe(true);
    expect(catalogRuns).toBe(1);
  });

  test("uses bounded retry delay and aborts server and workers on stop", async () => {
    const lifecycle: string[] = [];
    const delays: number[] = [];
    const controller = new AbortController();
    const supervisor = new NotificationWorkerSupervisor({
      config,
      ownerId: "runtime-b",
      ownership: {
        acquire: async () => ({ acquired: false as const }),
        renew: async () => false,
        release: async () => undefined,
      },
      store: {
        activateWorkerGates: async () => undefined,
        deactivateWorkerGates: async () => lifecycle.push("gates-closed"),
      },
      rules: {
        reconcileRules: async () => undefined,
        close: async () => lifecycle.push("workers-closed"),
      },
      delivery: { runOnce: async () => false },
      receipts: { runOnce: async () => 0 },
      dependenciesReady: async () => false,
    });
    const runtime = new NotificationServiceRuntime({
      workers: supervisor,
      jitter: () => 0.5,
      server: {
        start: async () => lifecycle.push("server-started"),
        stop: async () => lifecycle.push("server-stopped"),
      },
      sleep: async (milliseconds, signal) => {
        delays.push(milliseconds);
        controller.abort(new Error("test stop"));
        throw signal.reason;
      },
    });
    await runtime.run(controller.signal);
    expect(delays).toEqual([250]);
    expect(delays.every((delay) => delay <= 30_000)).toBe(true);
    expect(lifecycle).toEqual([
      "server-started",
      "workers-closed",
      "server-stopped",
    ]);
  });

  test("composes server, public clients, store, and every worker behind one runtime", async () => {
    let activations = 0;
    let ruleReads = 0;
    let dispatchClaims = 0;
    let receiptClaims = 0;
    const lifecycle: string[] = [];
    const store = {
      activateWorkerGates: async () => {
        activations += 1;
      },
      deactivateWorkerGates: async () => undefined,
      acquireMonitorLease: async () => ({
        acquired: true as const,
        generation: 1,
      }),
      renewMonitorLease: async () => true,
      releaseMonitorLease: async () => undefined,
      listActiveRules: async () => {
        ruleReads += 1;
        return [];
      },
      createAlertForRuleMatch: async () => ({ created: false as const }),
      recoverExpiredDispatches: async () => undefined,
      claimNextDispatch: async () => {
        dispatchClaims += 1;
        return {
          permitId: "11".repeat(16),
          outboxId: "12".repeat(16),
          alertId: "13".repeat(16),
          category: "execution" as const,
          network: "testnet" as const,
          routeHint: "portfolio",
          providerDeadlineAt: Date.now() + 10_000,
        };
      },
      markProviderSubmissionStarted: async () => undefined,
      readDecryptedPushToken: async () => "ExponentPushToken[composition]",
      authorizeProviderFetch: async () => ({
        providerDeadlineAt: Date.now() + 10_000,
      }),
      abandonUnstartedDispatch: async () => undefined,
      recordProviderAccepted: async () => undefined,
      recordProviderRejected: async () => undefined,
      recordProviderOutcomeUnknown: async () => undefined,
      recoverExpiredReceiptLeases: async () => undefined,
      claimDueReceipts: async () => {
        receiptClaims += 1;
        return ["ticket-health"];
      },
      completeReceipt: async () => undefined,
      deferReceipt: async () => undefined,
      readWorkerHealthSnapshot: async () => ({
        monitorLeases: 2,
        outboxPending: 3,
        receiptPending: 4,
      }),
    } as unknown as PostgresNotificationStore;
    const composition = composeNotificationServiceRuntime({
      config,
      ownerId: "composition-owner",
      store,
      application: {} as NotificationApplication,
      clients: {
        testnet: { network: "testnet" },
        mainnet: { network: "mainnet" },
      } as never,
      openWebSocket: () => {
        throw new Error("no rule may open a stream in this fixture");
      },
      expo: {
        send: async () => ({ kind: "accepted", ticketId: "ticket-health" }),
        getReceipts: async () => ({
          "ticket-health": {
            kind: "failed",
            errorCode: "provider_unavailable",
          },
        }),
      },
      dependenciesReady: async () => true,
      server: {
        start: async () => lifecycle.push("server-started"),
        stop: async () => lifecycle.push("server-stopped"),
      },
    });
    expect(await composition.runtime.tickOnce()).toBe(true);
    expect({ activations, ruleReads, dispatchClaims, receiptClaims }).toEqual({
      activations: 1,
      ruleReads: 1,
      dispatchClaims: 1,
      receiptClaims: 1,
    });
    expect(composition.metrics.snapshot()).toEqual(
      expect.arrayContaining([
        { name: "monitor_leases", value: 2, labels: {} },
        { name: "outbox_pending", value: 3, labels: {} },
        { name: "receipt_pending", value: 4, labels: {} },
        {
          name: "upstream_utilization_percent",
          value: 0,
          labels: {},
        },
        {
          name: "delivery_attempts",
          value: 1,
          labels: { provider: "expo" },
        },
        {
          name: "delivery_accepted",
          value: 1,
          labels: { provider: "expo", outcome: "accepted" },
        },
        {
          name: "receipt_failed",
          value: 1,
          labels: { provider: "expo" },
        },
      ]),
    );
    const stopped = new AbortController();
    stopped.abort(new Error("composition shutdown"));
    await composition.runtime.run(stopped.signal);
    expect(lifecycle).toEqual(["server-started", "server-stopped"]);
  });
});

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error("test condition did not become ready");
}
