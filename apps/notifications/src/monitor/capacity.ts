const DOCUMENTED_LIMITS = Object.freeze({
  restWeightPerMinute: 1_200,
  websocketConnections: 10,
  websocketConnectionsPerMinute: 30,
  websocketSubscriptions: 1_000,
  uniqueUsers: 10,
  websocketMessagesPerMinute: 2_000,
  websocketInflightPosts: 100,
  expoNotificationsPerSecond: 600,
  expoBatchSize: 100,
  expoConnections: 6,
});

export type CapacityResource = keyof typeof DOCUMENTED_LIMITS;
export type CapacityLimits = Readonly<Record<CapacityResource, number>>;

const RESERVED_LIMITS = Object.freeze(
  Object.fromEntries(
    Object.entries(DOCUMENTED_LIMITS).map(([name, value]) => [
      name,
      Math.floor(value * 0.7),
    ]),
  ) as Record<CapacityResource, number>,
);

export class CapacityGovernor {
  readonly #observed = new Map<CapacityResource, number>();
  readonly #reserved = new Map<CapacityResource, number>();
  readonly #uniqueUsers = new Set<string>();

  limits(): CapacityLimits {
    return { ...RESERVED_LIMITS };
  }

  observe(resource: CapacityResource, usage: number): void {
    if (!Number.isSafeInteger(usage) || usage < 0) {
      throw new Error("capacity usage is invalid");
    }
    this.#observed.set(resource, usage);
  }

  canReserve(resource: CapacityResource, amount: number): boolean {
    if (!Number.isSafeInteger(amount) || amount < 0) {
      throw new Error("capacity reservation is invalid");
    }
    return (
      (this.#observed.get(resource) ?? 0) +
        (this.#reserved.get(resource) ?? 0) +
        amount <=
      RESERVED_LIMITS[resource]
    );
  }

  tryReserve(resource: CapacityResource, amount: number): (() => void) | null {
    if (!this.canReserve(resource, amount)) return null;
    this.#reserved.set(resource, (this.#reserved.get(resource) ?? 0) + amount);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = (this.#reserved.get(resource) ?? 0) - amount;
      if (next <= 0) this.#reserved.delete(resource);
      else this.#reserved.set(resource, next);
    };
  }

  shouldRunNoncriticalRefresh(): boolean {
    return Array.from(
      this.#observed,
      ([resource, usage]) =>
        usage <= Math.floor(RESERVED_LIMITS[resource] * 0.8),
    ).every(Boolean);
  }

  reserveUniqueUser(identity: string): boolean {
    if (!/^[a-z0-9:_-]{1,128}$/.test(identity)) {
      throw new Error("capacity user identity is invalid");
    }
    if (this.#uniqueUsers.has(identity)) return true;
    if (this.#uniqueUsers.size >= RESERVED_LIMITS.uniqueUsers) return false;
    this.#uniqueUsers.add(identity);
    return true;
  }

  releaseUniqueUser(identity: string): void {
    this.#uniqueUsers.delete(identity);
  }

  maximumUtilizationPercent(): number {
    let maximum = 0;
    for (const resource of Object.keys(RESERVED_LIMITS) as CapacityResource[]) {
      const usage =
        resource === "uniqueUsers"
          ? this.#uniqueUsers.size
          : (this.#observed.get(resource) ?? 0) +
            (this.#reserved.get(resource) ?? 0);
      maximum = Math.max(maximum, (usage / RESERVED_LIMITS[resource]) * 70);
    }
    return Math.min(100, maximum);
  }
}

export const NOTIFICATION_CAPACITY_LIMITS = RESERVED_LIMITS;
