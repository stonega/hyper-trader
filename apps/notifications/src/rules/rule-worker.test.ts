import { describe, expect, test } from "bun:test";

import type {
  MonitorLeasePort,
  MonitorSource,
  MonitorTarget,
} from "../monitor/registry";
import { SharedMonitorRegistry } from "../monitor/registry";
import {
  type ActiveNotificationRule,
  NotificationRuleWorker,
  normalizeRuleUpdate,
} from "./rule-worker";

const priceRule: ActiveNotificationRule = {
  ruleId: "81".repeat(16),
  identityDigest: "82".repeat(32),
  installationId: "83".repeat(16),
  scope: "price",
  network: "testnet",
  marketId: "perp:0:0",
  eventType: "price_above",
  threshold: "100",
};

class Leases implements MonitorLeasePort {
  async acquire() {
    return { acquired: true as const, generation: 1 };
  }
  async renew() {
    return true;
  }
  async release() {}
}

class Source implements MonitorSource {
  callbacks?: {
    readonly onDelta: (value: unknown) => void;
    readonly onGap: () => void;
  };
  opens = 0;
  closes = 0;

  async loadAuthoritativeSnapshot(_target: MonitorTarget) {
    return {
      kind: "market-snapshot",
      receivedAt: 1,
      market: { canonicalId: "perp:0:0", markPx: "99" },
    };
  }

  async openStream(
    _target: MonitorTarget,
    callbacks: {
      readonly onDelta: (value: unknown) => void;
      readonly onGap: () => void;
    },
  ) {
    this.opens += 1;
    this.callbacks = callbacks;
    return () => {
      this.closes += 1;
    };
  }
}

describe("notification rule worker", () => {
  test("evaluates a post-baseline crossing and persists only the opaque match", async () => {
    const source = new Source();
    const persisted: unknown[] = [];
    const registry = new SharedMonitorRegistry({
      ownerId: "rule-worker",
      leases: new Leases(),
      source,
    });
    const worker = new NotificationRuleWorker({
      registry,
      store: {
        listActiveRules: async () => [priceRule],
        createAlertForRuleMatch: async (input) => {
          persisted.push(input);
          return {
            created: true as const,
            alertId: "84".repeat(16),
            outboxId: "85".repeat(16),
          };
        },
      },
    });
    await worker.reconcileRules();
    source.callbacks?.onDelta({
      kind: "stream-delta",
      receivedAt: 2,
      message: {
        channel: "activeAssetCtx",
        data: { coin: "BTC", ctx: { markPx: "100" } },
      },
      coinToMarketId: { BTC: "perp:0:0" },
    });
    await worker.close();
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({
      ruleId: priceRule.ruleId,
      identityDigest: priceRule.identityDigest,
      category: "price",
      routeHint: "trade",
    });
    expect(JSON.stringify(persisted)).not.toContain("markPx");
  });

  test("carries the evaluated identity through a replacement-versus-queued-evaluation race", async () => {
    let rules: readonly ActiveNotificationRule[] = [priceRule];
    let activeIdentityDigest = priceRule.identityDigest;
    let releasePersistence: (() => void) | undefined;
    let persistenceFinished = false;
    let createdAlerts = 0;
    const persisted: unknown[] = [];
    const persistenceStarted = Promise.withResolvers<void>();
    const persistenceGate = new Promise<void>((resolve) => {
      releasePersistence = resolve;
    });
    const source = new Source();
    const worker = new NotificationRuleWorker({
      registry: new SharedMonitorRegistry({
        ownerId: "rule-replacement-race",
        leases: new Leases(),
        source,
      }),
      store: {
        listActiveRules: async () => rules,
        createAlertForRuleMatch: async (input) => {
          persisted.push(input);
          persistenceStarted.resolve();
          await persistenceGate;
          persistenceFinished = true;
          if (input.identityDigest !== activeIdentityDigest) {
            return { created: false as const };
          }
          createdAlerts += 1;
          return {
            created: true as const,
            alertId: "86".repeat(16),
            outboxId: "87".repeat(16),
          };
        },
      },
    });

    await worker.reconcileRules();
    source.callbacks?.onDelta({
      kind: "stream-delta",
      receivedAt: 2,
      message: {
        channel: "activeAssetCtx",
        data: { coin: "BTC", ctx: { markPx: "100" } },
      },
      coinToMarketId: { BTC: "perp:0:0" },
    });
    await persistenceStarted.promise;

    const replacement = {
      ...priceRule,
      identityDigest: "88".repeat(32),
      threshold: "200",
    };
    rules = [replacement];
    activeIdentityDigest = replacement.identityDigest;
    await worker.reconcileRules();
    releasePersistence?.();
    await waitUntil(() => persistenceFinished, "stale persistence completion");

    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({
      ruleId: priceRule.ruleId,
      identityDigest: priceRule.identityDigest,
    });
    expect(createdAlerts).toBe(0);
    await worker.close();
  });

  test("normalizes exact execution identities and fails closed on unrelated payloads", () => {
    const accountRule: ActiveNotificationRule = {
      ...priceRule,
      scope: "account",
      accountLinkId: "86".repeat(16),
      accountAddress: `0x${"87".repeat(20)}`,
      eventType: "fill",
      threshold: "0",
    };
    const events = normalizeRuleUpdate(accountRule, new Map(), {
      kind: "delta",
      value: {
        kind: "stream-delta",
        receivedAt: 2,
        message: {
          channel: "userFills",
          data: { fills: [{ coin: "BTC", hash: "0xfill" }] },
        },
        coinToMarketId: { BTC: "perp:0:0" },
      },
    });
    expect(events).toEqual([
      {
        kind: "execution",
        eventType: "fill",
        network: "testnet",
        marketId: "perp:0:0",
        accountLinkId: "86".repeat(16),
        sourceId: "0xfill",
      },
    ]);
    expect(
      normalizeRuleUpdate(accountRule, new Map(), {
        kind: "delta",
        value: { raw: "provider-payload" },
      }),
    ).toEqual([]);
  });

  test("paginates beyond one thousand rules and reconciles a page-boundary update", async () => {
    let rules = Array.from({ length: 1_001 }, (_, index) => ({
      ...priceRule,
      ruleId: index.toString(16).padStart(32, "0"),
      identityDigest: (index + 1).toString(16).padStart(64, "0"),
      marketId: `perp:0:${index}`,
    }));
    const cursors: string[] = [];
    const source = new Source();
    const worker = new NotificationRuleWorker({
      registry: new SharedMonitorRegistry({
        ownerId: "pagination-worker",
        leases: new Leases(),
        source,
      }),
      store: {
        listActiveRules: async (limit, after = "") => {
          cursors.push(after);
          return rules.filter((rule) => rule.ruleId > after).slice(0, limit);
        },
        createAlertForRuleMatch: async () => ({ created: false as const }),
      },
    });
    await worker.reconcileRules();
    expect(cursors).toHaveLength(2);
    expect(source.opens).toBe(1_001);
    rules = rules.map((rule, index) =>
      index === 999 ? { ...rule, identityDigest: "fe".repeat(32) } : rule,
    );
    cursors.length = 0;
    await worker.reconcileRules();
    expect(cursors).toHaveLength(2);
    expect(source.opens).toBe(1_001);
    await worker.close();
  });

  test("reports account overload without dropping existing monitors and recovers capacity", async () => {
    let rules = Array.from({ length: 8 }, (_, index) => ({
      ...priceRule,
      ruleId: (100 + index).toString(16).padStart(32, "0"),
      identityDigest: (200 + index).toString(16).padStart(64, "0"),
      scope: "account" as const,
      accountLinkId: (300 + index).toString(16).padStart(32, "0"),
      accountAddress: `0x${(400 + index).toString(16).padStart(40, "0")}`,
      eventType: "fill" as const,
    }));
    let degraded = 0;
    const source = new Source();
    const worker = new NotificationRuleWorker({
      registry: new SharedMonitorRegistry({
        ownerId: "capacity-worker",
        leases: new Leases(),
        source,
      }),
      store: {
        listActiveRules: async (limit, after = "") =>
          rules.filter((rule) => rule.ruleId > after).slice(0, limit),
        createAlertForRuleMatch: async () => ({ created: false as const }),
      },
      onError: (kind) => {
        if (kind === "degraded") degraded += 1;
      },
    });
    await worker.reconcileRules();
    expect(source.opens).toBe(7);
    expect(degraded).toBe(1);
    rules = rules.slice(1);
    await worker.reconcileRules();
    expect(source.opens).toBe(8);
    await worker.close();
  });

  test("bounds slow rule work, degrades once, detaches, and rebaselines on recovery", async () => {
    const accountRule: ActiveNotificationRule = {
      ...priceRule,
      scope: "account",
      accountLinkId: "91".repeat(16),
      accountAddress: `0x${"92".repeat(20)}`,
      eventType: "fill",
      threshold: "0",
    };
    const source = new Source();
    const resolvers: Array<() => void> = [];
    const persisted: unknown[] = [];
    let degraded = 0;
    const errors: string[] = [];
    const worker = new NotificationRuleWorker({
      maxPendingUpdates: 2,
      registry: new SharedMonitorRegistry({
        ownerId: "bounded-rule-queue",
        leases: new Leases(),
        source,
      }),
      store: {
        listActiveRules: async () => [accountRule],
        createAlertForRuleMatch: async (input) => {
          persisted.push(input);
          await new Promise<void>((resolve) => resolvers.push(resolve));
          return { created: false as const };
        },
      },
      onError: (kind) => {
        errors.push(kind);
        if (kind === "degraded") degraded += 1;
      },
    });
    await worker.reconcileRules();
    await Bun.sleep(5);
    const publishFill = (sourceId: string) =>
      source.callbacks?.onDelta({
        kind: "stream-delta",
        receivedAt: 2,
        message: {
          channel: "userFills",
          data: { fills: [{ coin: "BTC", hash: sourceId }] },
        },
        coinToMarketId: { BTC: "perp:0:0" },
      });
    publishFill("fill-1");
    publishFill("fill-2");
    publishFill("fill-3");
    publishFill("fill-4");
    await waitUntil(() => source.closes === 1, "monitor teardown");
    await waitUntil(() => persisted.length === 1, "first queued event");
    expect(degraded).toBe(1);
    expect(errors).toEqual(["degraded"]);
    expect(persisted).toHaveLength(1);

    resolvers.shift()?.();
    await waitUntil(() => persisted.length === 2, "second queued event");
    resolvers.shift()?.();
    await waitUntil(() => resolvers.length === 0, "queue drain");
    for (let attempt = 0; attempt < 50 && source.opens < 2; attempt += 1) {
      await worker.reconcileRules();
      await Bun.sleep(1);
    }
    expect(source.opens).toBe(2);
    await Bun.sleep(5);

    publishFill("fill-after-rebaseline");
    await waitUntil(() => persisted.length === 3, "post-rebaseline event");
    resolvers.shift()?.();
    await worker.close();
  });
});

async function waitUntil(
  predicate: () => boolean,
  label: string,
): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await Bun.sleep(1);
  }
  throw new Error(`test condition did not become ready: ${label}`);
}
