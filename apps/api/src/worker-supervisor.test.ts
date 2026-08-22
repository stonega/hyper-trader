import { describe, expect, test } from "bun:test";

import type { NotificationServiceConfig } from "./config";
import { CapacityGovernor } from "./monitor/capacity";
import { NotificationWorkerSupervisor } from "./worker-supervisor";

function ownership() {
  return {
    acquire: async () => ({ acquired: true as const, generation: 1 }),
    renew: async () => true,
    release: async () => undefined,
  };
}

const config: NotificationServiceConfig = {
  serviceOrigin: "https://notify.example.com",
  databaseUrl: "postgres://notification.internal/hyper_trader",
  port: 8788,
  providerWorkersEnabled: true,
  upstreamUtilizationPercent: 70,
};

describe("notification worker supervisor", () => {
  test("throttles authoritative health reads and suppresses unchanged reports", async () => {
    let now = 0;
    let reads = 0;
    const reports: unknown[] = [];
    const supervisor = new NotificationWorkerSupervisor({
      config,
      now: () => now,
      ownerId: "health-cadence-owner",
      ownership: ownership(),
      store: {
        activateWorkerGates: async () => undefined,
        deactivateWorkerGates: async () => undefined,
        readWorkerHealthSnapshot: async () => {
          reads += 1;
          return { monitorLeases: 1, outboxPending: 2, receiptPending: 3 };
        },
      },
      rules: {
        reconcileRules: async () => undefined,
        close: async () => undefined,
      },
      delivery: { runOnce: async () => false },
      receipts: { runOnce: async () => 0 },
      dependenciesReady: async () => true,
      onHealth: (health) => reports.push(health),
    });
    expect(await supervisor.activate()).toBe("active");
    expect(reads).toBe(1);
    expect(reports).toHaveLength(1);
    await supervisor.runOnce();
    now = 1_000;
    await supervisor.runOnce();
    now = 9_999;
    await supervisor.runOnce();
    expect(reads).toBe(1);
    expect(reports).toHaveLength(1);

    now = 10_000;
    await supervisor.runOnce();
    expect(reads).toBe(2);
    expect(reports).toHaveLength(1);
  });

  test("keeps work disabled until config, dependency, and database gates pass", async () => {
    const calls: string[] = [];
    const input = {
      store: {
        activateWorkerGates: async () => calls.push("activate"),
        deactivateWorkerGates: async () => calls.push("deactivate"),
      },
      rules: {
        reconcileRules: async () => calls.push("rules"),
        close: async () => calls.push("close"),
      },
      delivery: { runOnce: async () => true },
      receipts: { runOnce: async () => 1 },
    };
    const disabled = new NotificationWorkerSupervisor({
      ...input,
      config: { ...config, providerWorkersEnabled: false },
      dependenciesReady: async () => true,
      ownership: ownership(),
      ownerId: "disabled-owner",
    });
    expect(await disabled.activate()).toBe("config_disabled");
    expect(await disabled.runOnce()).toEqual({
      monitorReconciled: false,
      deliveryClaimed: false,
      receiptsQueried: 0,
    });
    const blocked = new NotificationWorkerSupervisor({
      ...input,
      config,
      dependenciesReady: async () => false,
      ownership: ownership(),
      ownerId: "blocked-owner",
    });
    expect(await blocked.activate()).toBe("dependencies_blocked");
    expect(calls).not.toContain("activate");
  });

  test("runs bounded work and sheds provider calls before exhaustion", async () => {
    let deliveryCalls = 0;
    let receiptCalls = 0;
    const capacity = new CapacityGovernor();
    const supervisor = new NotificationWorkerSupervisor({
      config,
      capacity,
      store: {
        activateWorkerGates: async () => undefined,
        deactivateWorkerGates: async () => undefined,
      },
      rules: {
        reconcileRules: async () => undefined,
        close: async () => undefined,
      },
      delivery: {
        runOnce: async () => {
          deliveryCalls += 1;
          return true;
        },
      },
      receipts: {
        runOnce: async () => {
          receiptCalls += 1;
          return 1;
        },
      },
      dependenciesReady: async () => true,
      ownership: ownership(),
      ownerId: "active-owner",
    });
    expect(await supervisor.activate()).toBe("active");
    expect(await supervisor.runOnce()).toEqual({
      monitorReconciled: true,
      deliveryClaimed: true,
      receiptsQueried: 1,
    });
    capacity.observe("expoNotificationsPerSecond", 420);
    expect(await supervisor.runOnce()).toEqual({
      monitorReconciled: true,
      deliveryClaimed: false,
      receiptsQueried: 0,
    });
    expect(deliveryCalls).toBe(1);
    expect(receiptCalls).toBe(1);
  });

  test("deactivates without provider work when a required dependency is lost", async () => {
    let ready = true;
    let deactivations = 0;
    let closes = 0;
    let deliveries = 0;
    const supervisor = new NotificationWorkerSupervisor({
      config,
      ownerId: "dependency-loss-owner",
      ownership: ownership(),
      store: {
        activateWorkerGates: async () => undefined,
        deactivateWorkerGates: async () => {
          deactivations += 1;
        },
      },
      rules: {
        reconcileRules: async () => undefined,
        close: async () => {
          closes += 1;
        },
      },
      delivery: {
        runOnce: async () => {
          deliveries += 1;
          return true;
        },
      },
      receipts: { runOnce: async () => 0 },
      dependenciesReady: async () => ready,
    });
    expect(await supervisor.activate()).toBe("active");
    ready = false;
    expect((await supervisor.runOnce()).deliveryClaimed).toBe(false);
    expect(supervisor.state()).toBe("dependencies_blocked");
    expect(deliveries).toBe(0);
    expect(deactivations).toBe(1);
    expect(closes).toBe(1);
  });

  test("fences two supervisors to one egress owner and permits takeover", async () => {
    let owner: string | undefined;
    let generation = 0;
    const sharedOwnership = {
      acquire: async (input: { ownerId: string }) => {
        if (owner) return { acquired: false as const };
        owner = input.ownerId;
        generation += 1;
        return { acquired: true as const, generation };
      },
      renew: async (input: { ownerId: string; generation: number }) =>
        owner === input.ownerId && generation === input.generation,
      release: async (input: { ownerId: string; generation: number }) => {
        if (owner === input.ownerId && generation === input.generation) {
          owner = undefined;
        }
      },
    };
    let firstDeliveries = 0;
    let secondDeliveries = 0;
    const build = (ownerId: string, delivery: () => void) =>
      new NotificationWorkerSupervisor({
        config,
        ownerId,
        ownership: sharedOwnership,
        store: {
          activateWorkerGates: async () => undefined,
          deactivateWorkerGates: async () => undefined,
        },
        rules: {
          reconcileRules: async () => undefined,
          close: async () => undefined,
        },
        delivery: {
          runOnce: async () => {
            delivery();
            return true;
          },
        },
        receipts: { runOnce: async () => 0 },
        dependenciesReady: async () => true,
      });
    const first = build("egress-a", () => {
      firstDeliveries += 1;
    });
    const second = build("egress-b", () => {
      secondDeliveries += 1;
    });
    expect(await first.activate()).toBe("active");
    expect(await second.activate()).toBe("dependencies_blocked");
    owner = undefined;
    expect((await first.runOnce()).deliveryClaimed).toBe(false);
    expect(firstDeliveries).toBe(0);
    expect(await second.activate()).toBe("active");
    expect((await second.runOnce()).deliveryClaimed).toBe(true);
    expect(secondDeliveries).toBe(1);
    await second.stop();
    expect(owner).toBeUndefined();
  });

  test("fences a stale generation released after blocked monitor reconciliation", async () => {
    let owner: string | undefined;
    let generation = 0;
    const sharedOwnership = {
      acquire: async (input: { ownerId: string }) => {
        if (owner) return { acquired: false as const };
        owner = input.ownerId;
        generation += 1;
        return { acquired: true as const, generation };
      },
      renew: async (input: { ownerId: string; generation: number }) =>
        owner === input.ownerId && generation === input.generation,
      release: async (input: { ownerId: string; generation: number }) => {
        if (owner === input.ownerId && generation === input.generation) {
          owner = undefined;
        }
      },
    };
    let releaseReconcile: (() => void) | undefined;
    let staleExternalAdmissions = 0;
    let staleProviderCalls = 0;
    const first = new NotificationWorkerSupervisor({
      config,
      ownerId: "blocked-egress-a",
      ownership: sharedOwnership,
      store: {
        activateWorkerGates: async () => undefined,
        deactivateWorkerGates: async () => undefined,
      },
      rules: {
        reconcileRules: async (authorizeEgress) => {
          if (!(await authorizeEgress?.())) return;
          await new Promise<void>((resolve) => {
            releaseReconcile = resolve;
          });
          if (await authorizeEgress?.()) staleExternalAdmissions += 1;
        },
        close: async () => undefined,
      },
      delivery: {
        runOnce: async () => {
          staleProviderCalls += 1;
          return true;
        },
      },
      receipts: { runOnce: async () => 0 },
      dependenciesReady: async () => true,
    });
    let newProviderCalls = 0;
    const second = new NotificationWorkerSupervisor({
      config,
      ownerId: "blocked-egress-b",
      ownership: sharedOwnership,
      store: {
        activateWorkerGates: async () => undefined,
        deactivateWorkerGates: async () => undefined,
      },
      rules: {
        reconcileRules: async (authorizeEgress) => {
          expect(await authorizeEgress?.()).toBe(true);
        },
        close: async () => undefined,
      },
      delivery: {
        runOnce: async () => {
          newProviderCalls += 1;
          return true;
        },
      },
      receipts: { runOnce: async () => 0 },
      dependenciesReady: async () => true,
    });

    expect(await first.activate()).toBe("active");
    const staleTick = first.runOnce();
    await waitUntil(() => releaseReconcile !== undefined);
    owner = undefined;
    expect(await second.activate()).toBe("active");
    releaseReconcile?.();
    expect((await staleTick).deliveryClaimed).toBe(false);
    expect(staleExternalAdmissions).toBe(0);
    expect(staleProviderCalls).toBe(0);
    expect((await second.runOnce()).deliveryClaimed).toBe(true);
    expect(newProviderCalls).toBe(1);
    await second.stop();
  });
});

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error("test condition did not become ready");
}
