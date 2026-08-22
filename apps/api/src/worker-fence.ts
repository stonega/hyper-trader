export const NOTIFICATION_EGRESS_LEASE_KEY = "runtime:egress";

export interface RuntimeEgressFence {
  readonly leaseKey: typeof NOTIFICATION_EGRESS_LEASE_KEY;
  readonly ownerId: string;
  readonly generation: number;
}
