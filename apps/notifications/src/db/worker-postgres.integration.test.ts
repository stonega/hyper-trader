import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  InMemoryDeletionLedger,
  InMemoryTombstoneKeyProvider,
  type PushTokenKeyProvider,
} from "@hyper-trader/notifications";
import { SQL } from "bun";
import { DeliveryAuthorizationError } from "../outbox/delivery-worker";
import type { RuntimeEgressFence } from "../worker-fence";
import {
  getNotificationMigrationStatus,
  migrateNotifications,
  rollbackNotificationMigrations,
} from "./migrations";
import {
  PostgresNotificationStore,
  StoreNotReadyError,
  StoreUnauthorizedError,
} from "./notification-store";

const databaseUrl = process.env.NOTIFICATION_TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const installationId = "d1".repeat(16);
const credential = "d2".repeat(32);
const ruleId = "d3".repeat(16);

class WorkerPushKeyProvider implements PushTokenKeyProvider {
  readonly #key = new Uint8Array(32).fill(21);

  activeKeyVersion(): string {
    return "worker-push-v1";
  }

  async wrapKey(
    version: string,
    plaintextKey: Uint8Array,
  ): Promise<Uint8Array> {
    if (version !== this.activeKeyVersion()) throw new Error("missing key");
    return plaintextKey.map((byte, index) => byte ^ (this.#key[index] ?? 0));
  }

  async unwrapKey(
    version: string,
    wrappedKey: Uint8Array,
  ): Promise<Uint8Array> {
    if (version !== this.activeKeyVersion()) throw new Error("missing key");
    return wrappedKey.map((byte, index) => byte ^ (this.#key[index] ?? 0));
  }
}

integration("PostgreSQL notification workers", () => {
  let first: SQL;
  let second: SQL;
  let store: PostgresNotificationStore;
  let peer: PostgresNotificationStore;
  let claim: NonNullable<
    Awaited<ReturnType<PostgresNotificationStore["claimNextDispatch"]>>
  >;
  let runtimeFence: RuntimeEgressFence;

  beforeAll(async () => {
    first = new SQL(databaseUrl as string, { max: 2 });
    second = new SQL(databaseUrl as string, { max: 2 });
    await rollbackNotificationMigrations(first, { target: 0 });
    await migrateNotifications(first, { target: 4 });
    const dependencies = {
      tokenKeyProvider: new WorkerPushKeyProvider(),
      tombstoneKeyProvider: new InMemoryTombstoneKeyProvider({
        "worker-tombstone-v1": new Uint8Array(32).fill(22),
      }),
      deletionLedger: new InMemoryDeletionLedger(),
      tombstoneKeyVersion: "worker-tombstone-v1",
      serviceOrigin: "https://notify.example.com",
    } as const;
    store = new PostgresNotificationStore(first, dependencies);
    peer = new PostgresNotificationStore(second, dependencies);
    await store.prepareRestore(0);
    await store.replayRestore();
    await store.registerInstallation({
      installationId,
      credential,
      provider: "expo",
      pushToken: "ExponentPushToken[worker-postgres-fixture]",
    });
    await store.putPriceRule(
      {
        ruleId,
        scope: "price",
        network: "testnet",
        marketId: "perp:0:0",
        eventType: "price_above",
        threshold: "100000",
      },
      { installationId, credential },
    );
  });

  afterAll(async () => {
    await rollbackNotificationMigrations(first, { target: 0 });
    await first.close();
    await second.close();
  });

  test("keeps monitor and provider work closed until every database gate passes", async () => {
    await expect(store.listActiveRules()).rejects.toThrow(StoreNotReadyError);
    await store.activateWorkerGates();
    expect(await getNotificationMigrationStatus(first)).toMatchObject({
      currentVersion: 4,
      schemaPhase: "contracted",
      restoreState: "ready",
      monitorsEnabled: true,
      deliveryEnabled: true,
    });
    expect(await store.listActiveRules()).toHaveLength(1);
    expect(await store.readWorkerHealthSnapshot()).toEqual({
      monitorLeases: 0,
      outboxPending: 0,
      receiptPending: 0,
    });
  });

  test("installs partial recovery indexes for each bounded expiry scan", async () => {
    const rows = await first.unsafe<{ indexname: string; indexdef: string }[]>(`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = current_schema()
        AND indexname IN (
          'notification_dispatch_submission_deadline_idx',
          'notification_dispatch_active_expiry_idx',
          'notification_outbox_leased_expiry_idx'
        )
      ORDER BY indexname
    `);
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.indexdef)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("WHERE (state = 'submission_started'"),
        expect.stringContaining("WHERE (state = 'active'"),
        expect.stringContaining("WHERE (state = 'leased'"),
      ]),
    );
  });

  test("shares monitor ownership and fences an expired-owner takeover", async () => {
    const leaseKey = "testnet:market:perp:0:0";
    const initial = await store.acquireMonitorLease({
      leaseKey,
      ownerId: "monitor-a",
    });
    expect(initial).toEqual({ acquired: true, generation: 1 });
    expect(
      await peer.acquireMonitorLease({ leaseKey, ownerId: "monitor-b" }),
    ).toEqual({ acquired: false });
    await first.unsafe(
      `UPDATE notification_monitor_leases SET expires_at = clock_timestamp() - interval '1 second' WHERE lease_key = $1`,
      [leaseKey],
    );
    const takeover = await peer.acquireMonitorLease({
      leaseKey,
      ownerId: "monitor-b",
    });
    expect(takeover).toEqual({ acquired: true, generation: 2 });
    if (!initial.acquired) throw new Error("lease fixture was not acquired");
    expect(
      await store.renewMonitorLease({
        leaseKey,
        ownerId: "monitor-a",
        generation: initial.generation,
      }),
    ).toBe(false);
  });

  test("atomically deduplicates concurrent events into one opaque alert and outbox row", async () => {
    const results = await Promise.all([
      store.createAlertForRuleMatch({
        ruleId,
        eventKey: "e1".repeat(32),
        category: "price",
        routeHint: "trade",
      }),
      peer.createAlertForRuleMatch({
        ruleId,
        eventKey: "e1".repeat(32),
        category: "price",
        routeHint: "trade",
      }),
    ]);
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(results.filter((result) => !result.created)).toHaveLength(1);
    const counts = await first.unsafe<
      { alerts: number; outbox: number; dedupe: number }[]
    >(`
      SELECT
        (SELECT count(*)::int FROM notification_alerts) AS alerts,
        (SELECT count(*)::int FROM notification_outbox) AS outbox,
        (SELECT count(*)::int FROM notification_event_dedupe_keys) AS dedupe
    `);
    expect(counts[0]).toEqual({ alerts: 1, outbox: 1, dedupe: 1 });
  });

  test("lets exactly one database worker lease a pending dispatch", async () => {
    const ownership = await store.acquireMonitorLease({
      leaseKey: "runtime:egress",
      ownerId: "runtime-a",
    });
    if (!ownership.acquired)
      throw new Error("runtime lease fixture was not acquired");
    runtimeFence = {
      leaseKey: "runtime:egress",
      ownerId: "runtime-a",
      generation: ownership.generation,
    };
    const claims = await Promise.all([
      store.claimNextDispatch("delivery-a", runtimeFence),
      peer.claimNextDispatch("delivery-b", runtimeFence),
    ]);
    const acquired = claims.filter((candidate) => candidate !== null);
    expect(acquired).toHaveLength(1);
    const selected = acquired[0];
    if (!selected) throw new Error("dispatch fixture was not leased");
    claim = selected;
    await store.markProviderSubmissionStarted(claim.permitId);
    await expect(store.readDecryptedPushToken(claim.permitId)).resolves.toBe(
      "ExponentPushToken[worker-postgres-fixture]",
    );
    expect(
      (await store.authorizeProviderFetch(claim.permitId, runtimeFence))
        .providerDeadlineAt,
    ).toBeGreaterThan(Date.now());
    await store.recordProviderAccepted(claim.permitId, "worker-ticket-1");
  });

  test("leases receipt work, retries it with a bound, and invalidates a bad token", async () => {
    await first.unsafe(
      `UPDATE notification_provider_tickets SET next_receipt_at = clock_timestamp() WHERE provider_ticket_id = 'worker-ticket-1'`,
    );
    expect(
      await store.claimDueReceipts("receipt-a", 100, runtimeFence),
    ).toEqual(["worker-ticket-1"]);
    await store.deferReceipt("worker-ticket-1", "receipt-a");
    const deferred = await first.unsafe<
      { receipt_attempts: number; leased: boolean }[]
    >(`
      SELECT receipt_attempts, receipt_lease_owner IS NOT NULL AS leased
      FROM notification_provider_tickets
      WHERE provider_ticket_id = 'worker-ticket-1'
    `);
    expect(deferred[0]).toEqual({ receipt_attempts: 1, leased: false });
    await first.unsafe(
      `UPDATE notification_provider_tickets SET next_receipt_at = clock_timestamp() WHERE provider_ticket_id = 'worker-ticket-1'`,
    );
    expect(await peer.claimDueReceipts("receipt-b", 100, runtimeFence)).toEqual(
      ["worker-ticket-1"],
    );
    await peer.completeReceipt("worker-ticket-1", "receipt-b", {
      kind: "failed",
      errorCode: "device_not_registered",
    });
    const token = await first.unsafe<
      { delivery_state: string; invalidated: boolean }[]
    >(`
      SELECT delivery_state, invalidated_at IS NOT NULL AS invalidated
      FROM notification_push_tokens WHERE installation_id = '${installationId}'
    `);
    expect(token[0]).toEqual({ delivery_state: "invalid", invalidated: true });
  });

  test("rejects a stale egress generation after takeover", async () => {
    await first.unsafe(
      `UPDATE notification_push_tokens SET delivery_state = 'active', invalidated_at = NULL WHERE installation_id = $1`,
      [installationId],
    );
    await store.createAlertForRuleMatch({
      ruleId,
      eventKey: "e3".repeat(32),
      category: "price",
      routeHint: "trade",
    });
    const stalePermit = await store.claimNextDispatch(
      "delivery-before-takeover",
      runtimeFence,
    );
    if (!stalePermit) throw new Error("stale permit fixture was not leased");
    await store.markProviderSubmissionStarted(stalePermit.permitId);
    await first.unsafe(
      `UPDATE notification_monitor_leases SET expires_at = clock_timestamp() - interval '1 second' WHERE lease_key = 'runtime:egress'`,
    );
    const takeover = await peer.acquireMonitorLease({
      leaseKey: "runtime:egress",
      ownerId: "runtime-b",
    });
    if (!takeover.acquired) throw new Error("runtime takeover fixture failed");
    await expect(
      store.claimNextDispatch("delivery-stale", runtimeFence),
    ).rejects.toThrow(StoreNotReadyError);
    await expect(
      store.authorizeProviderFetch(stalePermit.permitId, runtimeFence),
    ).rejects.toThrow(DeliveryAuthorizationError);
    await store.recordProviderOutcomeUnknown(stalePermit.permitId);
    runtimeFence = {
      leaseKey: "runtime:egress",
      ownerId: "runtime-b",
      generation: takeover.generation,
    };
  });

  test("rejects a permit immediately before the provider marker after revocation", async () => {
    await first.unsafe(
      `UPDATE notification_push_tokens SET delivery_state = 'active', invalidated_at = NULL WHERE installation_id = $1`,
      [installationId],
    );
    await store.createAlertForRuleMatch({
      ruleId,
      eventKey: "e2".repeat(32),
      category: "price",
      routeHint: "trade",
    });
    const lateClaim = await store.claimNextDispatch(
      "delivery-late",
      runtimeFence,
    );
    if (!lateClaim) throw new Error("late dispatch fixture was not leased");
    await first.unsafe(
      `UPDATE notification_installations SET state = 'draining', revocation_generation = revocation_generation + 1 WHERE installation_id = $1`,
      [installationId],
    );
    await expect(
      store.markProviderSubmissionStarted(lateClaim.permitId),
    ).rejects.toThrow(StoreUnauthorizedError);
    await store.abandonUnstartedDispatch(lateClaim.permitId);
  });

  test("retains only bounded opaque delivery fields, never raw provider payloads", async () => {
    const forbidden = await first.unsafe<
      { table_name: string; column_name: string }[]
    >(`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN (
          'notification_event_dedupe_keys', 'notification_alerts',
          'notification_outbox', 'notification_provider_tickets',
          'notification_delivery_receipts'
        )
        AND column_name IN (
          'raw', 'payload', 'provider_payload', 'message', 'body',
          'details', 'provider_response'
        )
    `);
    expect(forbidden).toEqual([]);
    const ticket = await first.unsafe<
      { provider_ticket_id: string; receipt_error_code: string }[]
    >(`
      SELECT provider_ticket_id, receipt_error_code
      FROM notification_provider_tickets
      WHERE provider_ticket_id = 'worker-ticket-1'
    `);
    expect(ticket).toEqual([
      {
        provider_ticket_id: "worker-ticket-1",
        receipt_error_code: "device_not_registered",
      },
    ]);
  });
});
