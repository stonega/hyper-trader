import type { NotificationNetwork } from "@hyper-trader/notifications";

import { CapacityGovernor } from "./capacity";

const ADDRESS = /^0x[0-9a-f]{40}$/;
const CANONICAL_MARKET =
  /^(?:perp:(?:0|[1-9][0-9]*):(?:0|[1-9][0-9]*)|spot:(?:0|[1-9][0-9]*)|outcome:(?:0|[1-9][0-9]*):[01])$/;
const MONITOR_LEASE_DURATION_MS = 30_000;
const MONITOR_LEASE_RENEW_INTERVAL_MS = 10_000;

export type MonitorTarget =
  | {
      readonly kind: "account";
      readonly network: NotificationNetwork;
      readonly address: string;
    }
  | {
      readonly kind: "market";
      readonly network: NotificationNetwork;
      readonly marketId: string;
    };

export interface MonitorLeasePort {
  acquire(input: {
    readonly leaseKey: string;
    readonly ownerId: string;
  }): Promise<
    | { readonly acquired: false }
    | { readonly acquired: true; readonly generation: number }
  >;
  renew(input: {
    readonly leaseKey: string;
    readonly ownerId: string;
    readonly generation: number;
  }): Promise<boolean>;
  release(input: {
    readonly leaseKey: string;
    readonly ownerId: string;
    readonly generation: number;
  }): Promise<void>;
}

export interface MonitorSource {
  loadAuthoritativeSnapshot(
    target: MonitorTarget,
    signal: AbortSignal,
  ): Promise<unknown>;
  openStream(
    target: MonitorTarget,
    callbacks: {
      readonly onDelta: (value: unknown) => void;
      readonly onGap: () => void;
    },
    signal: AbortSignal,
  ): Promise<() => void>;
}

export type MonitorUpdate =
  | { readonly kind: "baseline"; readonly value: unknown }
  | { readonly kind: "delta"; readonly value: unknown };

interface MonitorEntry {
  readonly target: MonitorTarget;
  readonly leaseKey: string;
  readonly listeners: Set<(update: MonitorUpdate) => void>;
  leaseGeneration?: number;
  nextRenewAt?: number;
  baselineAccepted: boolean;
  baselineValue?: unknown;
  streamClose?: () => void;
  controller?: AbortController;
  reconciling?: Promise<void>;
  cancelLeaseExpiry?: () => void;
}

export class SharedMonitorRegistry {
  readonly #ownerId: string;
  readonly #leases: MonitorLeasePort;
  readonly #source: MonitorSource;
  readonly #capacity: CapacityGovernor;
  readonly #onListenerError?: () => void;
  readonly #onMonitorError?: () => void;
  readonly #onRebaseline?: () => void;
  readonly #now: () => number;
  readonly #scheduleLeaseExpiry: (
    callback: () => void,
    milliseconds: number,
  ) => () => void;
  readonly #entries = new Map<string, MonitorEntry>();

  constructor(input: {
    readonly ownerId: string;
    readonly leases: MonitorLeasePort;
    readonly source: MonitorSource;
    readonly capacity?: CapacityGovernor;
    readonly onListenerError?: () => void;
    readonly onMonitorError?: () => void;
    readonly onRebaseline?: () => void;
    readonly now?: () => number;
    readonly scheduleLeaseExpiry?: (
      callback: () => void,
      milliseconds: number,
    ) => () => void;
  }) {
    if (!/^[a-z0-9:_-]{1,128}$/.test(input.ownerId)) {
      throw new Error("monitor owner ID is invalid");
    }
    this.#ownerId = input.ownerId;
    this.#leases = input.leases;
    this.#source = input.source;
    this.#capacity = input.capacity ?? new CapacityGovernor();
    this.#onListenerError = input.onListenerError;
    this.#onMonitorError = input.onMonitorError;
    this.#onRebaseline = input.onRebaseline;
    this.#now = input.now ?? Date.now;
    this.#scheduleLeaseExpiry =
      input.scheduleLeaseExpiry ?? defaultLeaseExpiryScheduler;
  }

  subscribe(
    target: MonitorTarget,
    listener: (update: MonitorUpdate) => void,
  ): () => Promise<void> {
    const normalized = normalizeMonitorTarget(target);
    const key = monitorLeaseKey(normalized);
    let entry = this.#entries.get(key);
    if (!entry) {
      if (
        normalized.kind === "account" &&
        !this.#capacity.reserveUniqueUser(key)
      ) {
        throw new Error("monitor unique-user capacity is exhausted");
      }
      entry = {
        target: normalized,
        leaseKey: key,
        listeners: new Set(),
        baselineAccepted: false,
      };
      this.#entries.set(key, entry);
    }
    entry.listeners.add(listener);
    if (entry.baselineAccepted && entry.baselineValue !== undefined) {
      this.#notifyListener(listener, {
        kind: "baseline",
        value: entry.baselineValue,
      });
    }
    let released = false;
    return async () => {
      if (released) return;
      released = true;
      const current = this.#entries.get(key);
      if (!current) return;
      current.listeners.delete(listener);
      if (current.listeners.size > 0) return;
      this.#entries.delete(key);
      current.cancelLeaseExpiry?.();
      this.#stopStream(current);
      if (current.leaseGeneration !== undefined) {
        await this.#leases.release({
          leaseKey: key,
          ownerId: this.#ownerId,
          generation: current.leaseGeneration,
        });
      }
      if (current.target.kind === "account") {
        this.#capacity.releaseUniqueUser(key);
      }
    };
  }

  async reconcile(authorizeEgress?: () => Promise<boolean>): Promise<void> {
    const results = await Promise.allSettled(
      Array.from(this.#entries.values(), (entry) =>
        this.#reconcileEntry(entry, authorizeEgress),
      ),
    );
    for (const result of results) {
      if (result.status !== "rejected") continue;
      try {
        this.#onMonitorError?.();
      } catch {
        // Redacted failure telemetry is isolated from healthy monitors.
      }
    }
  }

  async close(): Promise<void> {
    const entries = [...this.#entries.values()];
    this.#entries.clear();
    const releases: Promise<void>[] = [];
    for (const entry of entries) {
      this.#stopStream(entry);
      entry.cancelLeaseExpiry?.();
      if (entry.leaseGeneration !== undefined) {
        releases.push(
          this.#leases.release({
            leaseKey: entry.leaseKey,
            ownerId: this.#ownerId,
            generation: entry.leaseGeneration,
          }),
        );
      }
      if (entry.target.kind === "account") {
        this.#capacity.releaseUniqueUser(entry.leaseKey);
      }
    }
    await Promise.allSettled(releases);
  }

  #reconcileEntry(
    entry: MonitorEntry,
    authorizeEgress?: () => Promise<boolean>,
  ): Promise<void> {
    if (entry.reconciling) return entry.reconciling;
    const work = this.#reconcileEntryOnce(entry, authorizeEgress).finally(
      () => {
        if (entry.reconciling === work) entry.reconciling = undefined;
      },
    );
    entry.reconciling = work;
    return work;
  }

  async #reconcileEntryOnce(
    entry: MonitorEntry,
    authorizeEgress?: () => Promise<boolean>,
  ): Promise<void> {
    if (this.#entries.get(entry.leaseKey) !== entry) return;
    if (entry.leaseGeneration === undefined) {
      if (authorizeEgress && !(await authorizeEgress())) return;
      const acquired = await this.#leases.acquire({
        leaseKey: entry.leaseKey,
        ownerId: this.#ownerId,
      });
      if (!acquired.acquired) return;
      entry.leaseGeneration = acquired.generation;
      entry.nextRenewAt = this.#now() + MONITOR_LEASE_RENEW_INTERVAL_MS;
      this.#armLeaseExpiry(entry);
    } else if (
      entry.nextRenewAt === undefined ||
      this.#now() >= entry.nextRenewAt
    ) {
      if (authorizeEgress && !(await authorizeEgress())) return;
      const renewed = await this.#leases.renew({
        leaseKey: entry.leaseKey,
        ownerId: this.#ownerId,
        generation: entry.leaseGeneration,
      });
      if (!renewed) {
        entry.leaseGeneration = undefined;
        entry.nextRenewAt = undefined;
        entry.cancelLeaseExpiry?.();
        this.#stopStream(entry);
        return;
      }
      entry.nextRenewAt = this.#now() + MONITOR_LEASE_RENEW_INTERVAL_MS;
      this.#armLeaseExpiry(entry);
    }
    if (entry.streamClose) return;

    const controller = new AbortController();
    entry.controller = controller;
    entry.baselineAccepted = false;
    try {
      if (authorizeEgress && !(await authorizeEgress())) return;
      const snapshot = await this.#source.loadAuthoritativeSnapshot(
        entry.target,
        controller.signal,
      );
      if (
        controller.signal.aborted ||
        this.#entries.get(entry.leaseKey) !== entry ||
        entry.leaseGeneration === undefined
      ) {
        return;
      }
      entry.baselineAccepted = true;
      entry.baselineValue = snapshot;
      try {
        this.#onRebaseline?.();
      } catch {
        // Redacted telemetry cannot affect baseline acceptance.
      }
      this.#publish(entry, { kind: "baseline", value: snapshot });
      if (authorizeEgress && !(await authorizeEgress())) {
        this.#stopStream(entry);
        return;
      }
      const close = await this.#source.openStream(
        entry.target,
        {
          onDelta: (value) => {
            if (!entry.baselineAccepted || controller.signal.aborted) return;
            this.#publish(entry, { kind: "delta", value });
          },
          onGap: () => {
            if (controller.signal.aborted) return;
            this.#stopStream(entry);
          },
        },
        controller.signal,
      );
      if (controller.signal.aborted) close();
      else entry.streamClose = close;
    } catch (error) {
      this.#stopStream(entry);
      throw error;
    }
  }

  #stopStream(entry: MonitorEntry): void {
    entry.baselineAccepted = false;
    entry.baselineValue = undefined;
    entry.controller?.abort();
    entry.controller = undefined;
    entry.streamClose?.();
    entry.streamClose = undefined;
  }

  #publish(entry: MonitorEntry, update: MonitorUpdate): void {
    for (const listener of entry.listeners) {
      this.#notifyListener(listener, update);
    }
  }

  #armLeaseExpiry(entry: MonitorEntry): void {
    entry.cancelLeaseExpiry?.();
    entry.cancelLeaseExpiry = this.#scheduleLeaseExpiry(() => {
      entry.cancelLeaseExpiry = undefined;
      entry.leaseGeneration = undefined;
      entry.nextRenewAt = undefined;
      this.#stopStream(entry);
    }, MONITOR_LEASE_DURATION_MS);
  }

  #notifyListener(
    listener: (update: MonitorUpdate) => void,
    update: MonitorUpdate,
  ): void {
    try {
      listener(update);
    } catch {
      try {
        this.#onListenerError?.();
      } catch {
        // Bounded telemetry cannot affect another listener.
      }
    }
  }
}

function defaultLeaseExpiryScheduler(
  callback: () => void,
  milliseconds: number,
): () => void {
  const timer = setTimeout(callback, milliseconds);
  return () => clearTimeout(timer);
}

export function monitorLeaseKey(target: MonitorTarget): string {
  const normalized = normalizeMonitorTarget(target);
  return normalized.kind === "account"
    ? `${normalized.network}:account:${normalized.address}`
    : `${normalized.network}:market:${normalized.marketId}`;
}

export function normalizeMonitorTarget(target: MonitorTarget): MonitorTarget {
  if (target.network !== "testnet" && target.network !== "mainnet") {
    throw new Error("monitor network is invalid");
  }
  if (target.kind === "account") {
    if (!ADDRESS.test(target.address)) {
      throw new Error("monitor address must be exact lowercase hexadecimal");
    }
    return { ...target };
  }
  if (!CANONICAL_MARKET.test(target.marketId)) {
    throw new Error("monitor market ID must be canonical");
  }
  return { ...target };
}
