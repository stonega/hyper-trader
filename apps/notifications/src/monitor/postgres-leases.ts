import type { PostgresNotificationStore } from "../db/notification-store";
import type { WorkerRuntimeOwnershipPort } from "../worker-supervisor";
import type { MonitorLeasePort } from "./registry";

export function postgresMonitorLeasePort(
  store: PostgresNotificationStore,
): MonitorLeasePort {
  return {
    acquire: (input) => store.acquireMonitorLease(input),
    renew: (input) => store.renewMonitorLease(input),
    release: (input) => store.releaseMonitorLease(input),
  };
}

export function postgresWorkerRuntimeOwnership(
  store: PostgresNotificationStore,
): WorkerRuntimeOwnershipPort {
  return postgresMonitorLeasePort(store);
}
