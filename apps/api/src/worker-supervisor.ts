import type { NotificationServiceConfig } from "./config";
import type {
  NotificationWorkerHealthSnapshot,
  PostgresNotificationStore,
} from "./db/notification-store";
import { CapacityGovernor } from "./monitor/capacity";
import type { NotificationDeliveryWorker } from "./outbox/delivery-worker";
import type { NotificationReceiptWorker } from "./outbox/receipt-worker";
import type { NotificationRuleWorker } from "./rules/rule-worker";
import {
  NOTIFICATION_EGRESS_LEASE_KEY,
  type RuntimeEgressFence,
} from "./worker-fence";

export type WorkerSupervisorState =
  | "config_disabled"
  | "dependencies_blocked"
  | "active"
  | "stopped";

export interface WorkerRuntimeOwnershipPort {
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

type ReportedWorkerHealth = NotificationWorkerHealthSnapshot & {
  readonly upstreamUtilizationPercent: number;
};

const WORKER_HEALTH_INTERVAL_MS = 10_000;

export class NotificationWorkerSupervisor {
  readonly #config: NotificationServiceConfig;
  readonly #store: Pick<
    PostgresNotificationStore,
    "activateWorkerGates" | "deactivateWorkerGates"
  > &
    Partial<Pick<PostgresNotificationStore, "readWorkerHealthSnapshot">>;
  readonly #rules: Pick<NotificationRuleWorker, "reconcileRules" | "close">;
  readonly #delivery: Pick<NotificationDeliveryWorker, "runOnce"> &
    Partial<Pick<NotificationDeliveryWorker, "requestRecovery">>;
  readonly #receipts: Pick<NotificationReceiptWorker, "runOnce">;
  readonly #dependenciesReady: () => Promise<boolean>;
  readonly #capacity: CapacityGovernor;
  readonly #ownership: WorkerRuntimeOwnershipPort;
  readonly #ownerId: string;
  readonly #onHealth?: (snapshot: ReportedWorkerHealth) => void;
  readonly #now: () => number;
  #generation?: number;
  #ownershipRenewal?: Promise<boolean>;
  #nextHealthAt = 0;
  #lastHealth?: ReportedWorkerHealth;
  #state: WorkerSupervisorState = "stopped";

  constructor(input: {
    readonly config: NotificationServiceConfig;
    readonly store: Pick<
      PostgresNotificationStore,
      "activateWorkerGates" | "deactivateWorkerGates"
    > &
      Partial<Pick<PostgresNotificationStore, "readWorkerHealthSnapshot">>;
    readonly rules: Pick<NotificationRuleWorker, "reconcileRules" | "close">;
    readonly delivery: Pick<NotificationDeliveryWorker, "runOnce"> &
      Partial<Pick<NotificationDeliveryWorker, "requestRecovery">>;
    readonly receipts: Pick<NotificationReceiptWorker, "runOnce">;
    readonly dependenciesReady: () => Promise<boolean>;
    readonly capacity?: CapacityGovernor;
    readonly ownership: WorkerRuntimeOwnershipPort;
    readonly ownerId: string;
    readonly onHealth?: (snapshot: ReportedWorkerHealth) => void;
    readonly now?: () => number;
  }) {
    this.#config = input.config;
    this.#store = input.store;
    this.#rules = input.rules;
    this.#delivery = input.delivery;
    this.#receipts = input.receipts;
    this.#dependenciesReady = input.dependenciesReady;
    this.#capacity = input.capacity ?? new CapacityGovernor();
    if (!/^[a-z0-9:_-]{1,128}$/.test(input.ownerId)) {
      throw new Error("notification egress owner ID is invalid");
    }
    this.#ownership = input.ownership;
    this.#ownerId = input.ownerId;
    this.#onHealth = input.onHealth;
    this.#now = input.now ?? Date.now;
  }

  state(): WorkerSupervisorState {
    return this.#state;
  }

  async activate(): Promise<WorkerSupervisorState> {
    if (this.#state === "active" && this.#generation !== undefined) {
      return this.#state;
    }
    if (!this.#config.providerWorkersEnabled) {
      this.#state = "config_disabled";
      return this.#state;
    }
    if (!(await this.#dependenciesReady())) {
      this.#state = "dependencies_blocked";
      return this.#state;
    }
    await this.#store.activateWorkerGates();
    const ownership = await this.#ownership.acquire({
      leaseKey: NOTIFICATION_EGRESS_LEASE_KEY,
      ownerId: this.#ownerId,
    });
    if (!ownership.acquired) {
      this.#state = "dependencies_blocked";
      return this.#state;
    }
    this.#generation = ownership.generation;
    this.#state = "active";
    this.#delivery.requestRecovery?.();
    this.#nextHealthAt = 0;
    this.#lastHealth = undefined;
    await this.#reportHealth(true);
    return this.#state;
  }

  async runOnce(): Promise<{
    readonly monitorReconciled: boolean;
    readonly deliveryClaimed: boolean;
    readonly receiptsQueried: number;
  }> {
    if (this.#state !== "active") {
      return {
        monitorReconciled: false,
        deliveryClaimed: false,
        receiptsQueried: 0,
      };
    }
    if (!(await this.#renewOwnership()) || !(await this.#dependenciesReady())) {
      await this.deactivate("dependencies_blocked");
      return {
        monitorReconciled: false,
        deliveryClaimed: false,
        receiptsQueried: 0,
      };
    }
    const fence = this.#runtimeFence();
    await this.#rules.reconcileRules(() => this.#authorizeEgress());
    if (!(await this.#renewOwnership())) {
      await this.deactivate("dependencies_blocked");
      return {
        monitorReconciled: false,
        deliveryClaimed: false,
        receiptsQueried: 0,
      };
    }
    const releaseProvider = this.#capacity.tryReserve(
      "expoNotificationsPerSecond",
      2,
    );
    const releaseConnection = this.#capacity.tryReserve("expoConnections", 1);
    if (!releaseProvider || !releaseConnection) {
      releaseProvider?.();
      releaseConnection?.();
      const result = {
        monitorReconciled: true,
        deliveryClaimed: false,
        receiptsQueried: 0,
      };
      await this.#reportHealth();
      return result;
    }
    let result: {
      readonly monitorReconciled: boolean;
      readonly deliveryClaimed: boolean;
      readonly receiptsQueried: number;
    };
    try {
      result = {
        monitorReconciled: true,
        deliveryClaimed: await this.#delivery.runOnce(fence),
        receiptsQueried: await this.#receipts.runOnce(fence),
      };
    } finally {
      releaseConnection();
      releaseProvider();
    }
    await this.#reportHealth();
    return result;
  }

  async stop(): Promise<void> {
    await this.deactivate("stopped");
  }

  async deactivate(
    state: "dependencies_blocked" | "stopped" = "dependencies_blocked",
  ): Promise<void> {
    const generation = this.#generation;
    const stillOwner =
      generation !== undefined && (await this.#renewOwnership());
    if (stillOwner) await this.#store.deactivateWorkerGates();
    await this.#rules.close();
    if (generation !== undefined) {
      await this.#ownership.release({
        leaseKey: NOTIFICATION_EGRESS_LEASE_KEY,
        ownerId: this.#ownerId,
        generation,
      });
    }
    this.#generation = undefined;
    this.#state = state;
  }

  async #renewOwnership(): Promise<boolean> {
    const generation = this.#generation;
    return generation !== undefined
      ? this.#ownership.renew({
          leaseKey: NOTIFICATION_EGRESS_LEASE_KEY,
          ownerId: this.#ownerId,
          generation,
        })
      : false;
  }

  #authorizeEgress(): Promise<boolean> {
    if (this.#ownershipRenewal) return this.#ownershipRenewal;
    const renewal = this.#renewOwnership().finally(() => {
      if (this.#ownershipRenewal === renewal)
        this.#ownershipRenewal = undefined;
    });
    this.#ownershipRenewal = renewal;
    return renewal;
  }

  #runtimeFence(): RuntimeEgressFence {
    const generation = this.#generation;
    if (generation === undefined) {
      throw new Error("notification egress ownership is unavailable");
    }
    return {
      leaseKey: NOTIFICATION_EGRESS_LEASE_KEY,
      ownerId: this.#ownerId,
      generation,
    };
  }

  async #reportHealth(force = false): Promise<void> {
    if (!this.#store.readWorkerHealthSnapshot || !this.#onHealth) return;
    const now = this.#now();
    if (!force && now < this.#nextHealthAt) return;
    this.#nextHealthAt = now + WORKER_HEALTH_INTERVAL_MS;
    try {
      const snapshot = {
        ...(await this.#store.readWorkerHealthSnapshot()),
        upstreamUtilizationPercent: this.#capacity.maximumUtilizationPercent(),
      };
      if (force || !sameWorkerHealth(snapshot, this.#lastHealth)) {
        this.#onHealth(snapshot);
        this.#lastHealth = snapshot;
      }
    } catch {
      // Observability is isolated from worker authorization and delivery.
    }
  }
}

function sameWorkerHealth(
  current: ReportedWorkerHealth,
  previous: ReportedWorkerHealth | undefined,
): boolean {
  return (
    previous !== undefined &&
    current.monitorLeases === previous.monitorLeases &&
    current.outboxPending === previous.outboxPending &&
    current.receiptPending === previous.receiptPending &&
    current.upstreamUtilizationPercent === previous.upstreamUtilizationPercent
  );
}
