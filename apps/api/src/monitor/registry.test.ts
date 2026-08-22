import { describe, expect, test } from "bun:test";

import {
  type MonitorLeasePort,
  type MonitorSource,
  SharedMonitorRegistry,
} from "./registry";

const target = {
  kind: "account" as const,
  network: "testnet" as const,
  address: `0x${"11".repeat(20)}`,
};

class LeasePort implements MonitorLeasePort {
  available = true;
  generation = 0;
  renewals = 0;

  async acquire() {
    if (!this.available) return { acquired: false as const };
    this.generation += 1;
    return { acquired: true as const, generation: this.generation };
  }

  async renew() {
    this.renewals += 1;
    return this.available;
  }

  async release() {}
}

class Source implements MonitorSource {
  baselines = 0;
  opens = 0;
  closes = 0;
  onDelta?: (value: unknown) => void;
  onGap?: () => void;

  async loadAuthoritativeSnapshot() {
    this.baselines += 1;
    return { cursor: `baseline-${this.baselines}` };
  }

  async openStream(
    _target: unknown,
    callbacks: {
      readonly onDelta: (value: unknown) => void;
      readonly onGap: () => void;
    },
  ) {
    this.opens += 1;
    this.onDelta = callbacks.onDelta;
    this.onGap = callbacks.onGap;
    return () => {
      this.closes += 1;
    };
  }
}

describe("shared monitor registry", () => {
  test("shares an exact target and requires a snapshot before deltas", async () => {
    const lease = new LeasePort();
    const source = new Source();
    const registry = new SharedMonitorRegistry({
      ownerId: "worker-a",
      leases: lease,
      source,
    });
    const first: unknown[] = [];
    const second: unknown[] = [];
    const releaseFirst = registry.subscribe(target, (event) =>
      first.push(event),
    );
    const releaseSecond = registry.subscribe(target, (event) =>
      second.push(event),
    );

    source.onDelta?.({ cursor: "too-early" });
    expect(first).toEqual([]);
    await registry.reconcile();
    expect(source.baselines).toBe(1);
    expect(source.opens).toBe(1);
    source.onDelta?.({ cursor: "delta-1" });
    expect(first.at(-1)).toEqual({
      kind: "delta",
      value: { cursor: "delta-1" },
    });
    expect(second.at(-1)).toEqual(first.at(-1));

    await releaseFirst();
    expect(source.closes).toBe(0);
    await releaseSecond();
    expect(source.closes).toBe(1);
  });

  test("rebaselines after a gap and after lease takeover", async () => {
    const lease = new LeasePort();
    lease.available = false;
    const source = new Source();
    const observed: unknown[] = [];
    const registry = new SharedMonitorRegistry({
      ownerId: "worker-b",
      leases: lease,
      source,
    });
    const release = registry.subscribe(target, (event) => observed.push(event));

    await registry.reconcile();
    expect(source.opens).toBe(0);
    lease.available = true;
    await registry.reconcile();
    expect(source.baselines).toBe(1);
    source.onGap?.();
    source.onDelta?.({ cursor: "gap-delta" });
    expect(
      observed.some((event) => JSON.stringify(event).includes("gap-delta")),
    ).toBe(false);
    await registry.reconcile();
    expect(source.baselines).toBe(2);
    expect(source.opens).toBe(2);
    await release();
  });

  test("rejects ambiguous addresses and canonical market IDs", () => {
    const registry = new SharedMonitorRegistry({
      ownerId: "worker-c",
      leases: new LeasePort(),
      source: new Source(),
    });
    expect(() =>
      registry.subscribe(
        { ...target, address: target.address.toUpperCase() },
        () => undefined,
      ),
    ).toThrow("address");
    expect(() =>
      registry.subscribe(
        { kind: "market", network: "testnet", marketId: "ETH" },
        () => undefined,
      ),
    ).toThrow("canonical");
  });

  test("isolates listener failures and closes a stream that gaps while opening", async () => {
    const leases = new LeasePort();
    const marketTarget = {
      kind: "market" as const,
      network: "testnet" as const,
      marketId: "perp:0:0",
    };
    let closes = 0;
    let opens = 0;
    let listenerErrors = 0;
    const source: MonitorSource = {
      loadAuthoritativeSnapshot: async () => ({ markPx: "1" }),
      openStream: async (_target, callbacks) => {
        opens += 1;
        if (opens === 1) callbacks.onGap();
        return () => {
          closes += 1;
        };
      },
    };
    const registry = new SharedMonitorRegistry({
      ownerId: "owner-gap-race",
      leases,
      source,
      onListenerError: () => {
        listenerErrors += 1;
      },
    });
    const received: unknown[] = [];
    registry.subscribe(marketTarget, () => {
      throw new Error("listener failed");
    });
    registry.subscribe(marketTarget, (update) => received.push(update));
    await registry.reconcile();
    expect(listenerErrors).toBe(1);
    expect(received).toHaveLength(1);
    expect(closes).toBe(1);
    await registry.reconcile();
    expect(opens).toBe(2);
    expect(received).toHaveLength(2);
    await registry.close();
  });

  test("isolates one failing target and recovers it without closing a healthy target", async () => {
    const callbacks = new Map<
      string,
      { readonly onDelta: (value: unknown) => void; readonly onGap: () => void }
    >();
    let failing = true;
    let monitorErrors = 0;
    let healthyCloses = 0;
    const source: MonitorSource = {
      loadAuthoritativeSnapshot: async (candidate) => {
        if (
          candidate.kind === "market" &&
          candidate.marketId === "perp:0:1" &&
          failing
        ) {
          throw new Error("delisted target fixture");
        }
        return { target: candidate };
      },
      openStream: async (candidate, next) => {
        const key =
          candidate.kind === "market" ? candidate.marketId : candidate.address;
        callbacks.set(key, next);
        return () => {
          callbacks.delete(key);
          if (key === "perp:0:0") healthyCloses += 1;
        };
      },
    };
    const registry = new SharedMonitorRegistry({
      ownerId: "target-isolation",
      leases: new LeasePort(),
      source,
      onMonitorError: () => {
        monitorErrors += 1;
      },
    });
    const healthy: unknown[] = [];
    const recovered: unknown[] = [];
    registry.subscribe(
      { kind: "market", network: "testnet", marketId: "perp:0:0" },
      (update) => healthy.push(update),
    );
    registry.subscribe(
      { kind: "market", network: "testnet", marketId: "perp:0:1" },
      (update) => recovered.push(update),
    );
    await registry.reconcile();
    expect(monitorErrors).toBe(1);
    callbacks.get("perp:0:0")?.onDelta({ markPx: "2" });
    expect(healthy.at(-1)).toEqual({ kind: "delta", value: { markPx: "2" } });
    expect(healthyCloses).toBe(0);

    failing = false;
    await registry.reconcile();
    expect(recovered[0]).toMatchObject({ kind: "baseline" });
    expect(healthyCloses).toBe(0);
    await registry.close();
  });

  test("renews a healthy thirty-second lease on a ten-second cadence", async () => {
    let now = 0;
    const scheduled: number[] = [];
    const lease = new LeasePort();
    const source = new Source();
    const registry = new SharedMonitorRegistry({
      ownerId: "renewal-cadence",
      leases: lease,
      source,
      now: () => now,
      scheduleLeaseExpiry: (_callback, milliseconds) => {
        scheduled.push(milliseconds);
        return () => undefined;
      },
    });
    registry.subscribe(target, () => undefined);

    await registry.reconcile();
    now = 1_000;
    await registry.reconcile();
    now = 9_999;
    await registry.reconcile();
    expect(lease.renewals).toBe(0);
    expect(scheduled).toEqual([30_000]);

    now = 10_000;
    await registry.reconcile();
    expect(lease.renewals).toBe(1);
    expect(scheduled).toEqual([30_000, 30_000]);
    expect(source.opens).toBe(1);
    await registry.close();
  });
});
