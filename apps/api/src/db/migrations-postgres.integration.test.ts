import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { SQL } from "bun";
import {
  getNotificationMigrationStatus,
  migrateNotifications,
  rollbackNotificationMigrations,
} from "./migrations";

const databaseUrl = process.env.NOTIFICATION_TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

const workerIndexes = [
  "notification_push_tokens_active_delivery_idx",
  "notification_outbox_bounded_dispatch_idx",
  "notification_dispatch_submission_deadline_idx",
  "notification_dispatch_active_expiry_idx",
  "notification_outbox_leased_expiry_idx",
  "notification_provider_tickets_due_receipt_idx",
] as const;

integration("PostgreSQL notification migrations", () => {
  let sql: SQL;

  beforeAll(() => {
    sql = new SQL(databaseUrl as string, { max: 2 });
  });

  beforeEach(async () => {
    await rollbackNotificationMigrations(sql, { target: 0 });
    await migrateNotifications(sql, { target: 3 });
  });

  afterEach(async () => {
    await sql.unsafe(`
      DO $cleanup$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM pg_class
          WHERE relname = 'notification_outbox_bounded_dispatch_idx'
            AND relkind IN ('r', 'p')
        ) THEN
          DROP TABLE notification_outbox_bounded_dispatch_idx;
        END IF;
      END
      $cleanup$
    `);
    await migrateNotifications(sql, { target: 4 });
    await rollbackNotificationMigrations(sql, { target: 0 });
  });

  afterAll(async () => {
    await sql.close();
  });

  test("completes the concurrent index phase before recording an applied migration", async () => {
    await sql`
      INSERT INTO notification_monitor_leases (
        lease_key, owner_id, expires_at
      ) VALUES (
        'migration-populated-upgrade', 'migration-test',
        clock_timestamp() + interval '30 seconds'
      )
    `;
    await sql`
      UPDATE notification_service_state
      SET restore_state = 'ready', mutations_enabled = true,
          monitors_enabled = true, delivery_enabled = true
      WHERE singleton
    `;

    await migrateNotifications(sql, { target: 4 });

    const history = await sql<
      { state: string; up_checksum: string; down_checksum: string }[]
    >`
      SELECT state, up_checksum, down_checksum
      FROM notification_migration_history
      WHERE version = 4
    `;
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ state: "applied" });
    expect(history[0]?.up_checksum.trim()).toMatch(/^[0-9a-f]{64}$/);
    expect(history[0]?.down_checksum.trim()).toMatch(/^[0-9a-f]{64}$/);
    expect(
      await sql<{ lease_generation: number }[]>`
        SELECT lease_generation
        FROM notification_monitor_leases
        WHERE lease_key = 'migration-populated-upgrade'
      `,
    ).toEqual([{ lease_generation: 1 }]);

    expect(await readWorkerIndexes(sql)).toEqual(
      workerIndexes.map((name) => ({
        name,
        valid: true,
        ready: true,
      })),
    );
    expect(await getNotificationMigrationStatus(sql)).toMatchObject({
      currentVersion: 4,
      mutationsEnabled: false,
      monitorsEnabled: false,
      deliveryEnabled: false,
    });
  });

  test("keeps gates closed and resumes a failed concurrent index phase", async () => {
    await sql`
      UPDATE notification_service_state
      SET restore_state = 'ready', mutations_enabled = true,
          monitors_enabled = true, delivery_enabled = true
      WHERE singleton
    `;
    await sql.unsafe(
      "CREATE TABLE notification_outbox_bounded_dispatch_idx (id integer)",
    );

    await expect(migrateNotifications(sql, { target: 4 })).rejects.toThrow(
      "concurrent index phase",
    );

    const pending = await sql<{ version: number; state: string }[]>`
      SELECT version, state
      FROM notification_migration_history
      WHERE version = 4
    `;
    expect(pending).toEqual([{ version: 4, state: "applying" }]);
    await expect(getNotificationMigrationStatus(sql)).rejects.toThrow(
      "incomplete concurrent index phase",
    );
    await expect(
      rollbackNotificationMigrations(sql, { target: 3 }),
    ).rejects.toThrow("incomplete concurrent index phase");
    const gates = await sql<
      {
        mutations_enabled: boolean;
        monitors_enabled: boolean;
        delivery_enabled: boolean;
      }[]
    >`
      SELECT mutations_enabled, monitors_enabled, delivery_enabled
      FROM notification_service_state
      WHERE singleton
    `;
    expect(gates).toEqual([
      {
        mutations_enabled: false,
        monitors_enabled: false,
        delivery_enabled: false,
      },
    ]);

    await sql.unsafe("DROP TABLE notification_outbox_bounded_dispatch_idx");
    await migrateNotifications(sql, { target: 4 });

    expect(await readWorkerIndexes(sql)).toEqual(
      workerIndexes.map((name) => ({
        name,
        valid: true,
        ready: true,
      })),
    );
    expect((await getNotificationMigrationStatus(sql)).currentVersion).toBe(4);
  });

  test("preserves checksums when adopting legacy applied history", async () => {
    await migrateNotifications(sql, { target: 4 });
    const before = await sql<{ up_checksum: string; down_checksum: string }[]>`
      SELECT up_checksum, down_checksum
      FROM notification_migration_history
      WHERE version = 4
    `;
    const recorded = before[0];
    if (!recorded) throw new Error("worker migration history missing");

    await sql`ALTER TABLE notification_migration_history DROP COLUMN state`;
    await migrateNotifications(sql, { target: 4 });

    const after = await sql<
      { state: string; up_checksum: string; down_checksum: string }[]
    >`
      SELECT state, up_checksum, down_checksum
      FROM notification_migration_history
      WHERE version = 4
    `;
    expect(after).toEqual([
      {
        state: "applied",
        up_checksum: recorded.up_checksum,
        down_checksum: recorded.down_checksum,
      },
    ]);
    expect((await getNotificationMigrationStatus(sql)).currentVersion).toBe(4);
  });
});

async function readWorkerIndexes(
  sql: SQL,
): Promise<{ name: string; valid: boolean; ready: boolean }[]> {
  return await sql<{ name: string; valid: boolean; ready: boolean }[]>`
    SELECT index_class.relname AS name,
           index_state.indisvalid AS valid,
           index_state.indisready AS ready
    FROM pg_class AS index_class
    JOIN pg_namespace AS index_namespace
      ON index_namespace.oid = index_class.relnamespace
    JOIN pg_index AS index_state
      ON index_state.indexrelid = index_class.oid
    WHERE index_namespace.nspname = current_schema()
      AND index_class.relname IN (
        'notification_push_tokens_active_delivery_idx',
        'notification_outbox_bounded_dispatch_idx',
        'notification_dispatch_submission_deadline_idx',
        'notification_dispatch_active_expiry_idx',
        'notification_outbox_leased_expiry_idx',
        'notification_provider_tickets_due_receipt_idx'
      )
    ORDER BY array_position(
      ARRAY[
        'notification_push_tokens_active_delivery_idx',
        'notification_outbox_bounded_dispatch_idx',
        'notification_dispatch_submission_deadline_idx',
        'notification_dispatch_active_expiry_idx',
        'notification_outbox_leased_expiry_idx',
        'notification_provider_tickets_due_receipt_idx'
      ],
      index_class.relname
    )
  `;
}
