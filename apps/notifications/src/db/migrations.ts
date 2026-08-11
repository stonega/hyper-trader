import { createHash } from "node:crypto";
import type { ReservedSQL, SQL } from "bun";

const MIGRATION_LOCK = 824_179_311;
interface ConcurrentIndexDefinition {
  readonly name: string;
  readonly table: string;
  readonly keys: string;
  readonly predicate: string;
}

interface MigrationDefinition {
  readonly version: number;
  readonly name: string;
  readonly concurrentIndexes?: readonly ConcurrentIndexDefinition[];
}

const WORKER_INDEXES = [
  {
    name: "notification_push_tokens_active_delivery_idx",
    table: "notification_push_tokens",
    keys: "installation_id,provider",
    predicate: "delivery_state = 'active'::text",
  },
  {
    name: "notification_outbox_bounded_dispatch_idx",
    table: "notification_outbox",
    keys: "state,created_at",
    predicate: "state = 'pending'::text AND claim_attempts < 8",
  },
  {
    name: "notification_dispatch_submission_deadline_idx",
    table: "notification_dispatch_permits",
    keys: "provider_deadline_at",
    predicate: "state = 'submission_started'::text",
  },
  {
    name: "notification_dispatch_active_expiry_idx",
    table: "notification_dispatch_permits",
    keys: "expires_at",
    predicate: "state = 'active'::text",
  },
  {
    name: "notification_outbox_leased_expiry_idx",
    table: "notification_outbox",
    keys: "lease_expires_at",
    predicate: "state = 'leased'::text",
  },
  {
    name: "notification_provider_tickets_due_receipt_idx",
    table: "notification_provider_tickets",
    keys: "next_receipt_at,accepted_at",
    predicate: "receipt_state = 'pending'::text AND receipt_attempts < 5",
  },
] as const satisfies readonly ConcurrentIndexDefinition[];

const MIGRATIONS: readonly MigrationDefinition[] = [
  { version: 1, name: "expand" },
  { version: 2, name: "migrate" },
  { version: 3, name: "contract" },
  { version: 4, name: "workers", concurrentIndexes: WORKER_INDEXES },
];

export interface NotificationMigrationStatus {
  readonly currentVersion: number;
  readonly schemaPhase: "absent" | "expand" | "migrated" | "contracted";
  readonly restoreState: "blocked" | "replaying" | "ready";
  readonly mutationsEnabled: boolean;
  readonly monitorsEnabled: boolean;
  readonly deliveryEnabled: boolean;
  readonly ledgerWatermark: number;
  readonly ledgerHead: number;
}

export async function migrateNotifications(
  sql: SQL,
  options: { readonly target?: number } = {},
): Promise<void> {
  const target = validateTarget(options.target ?? MIGRATIONS.length);
  await ensureHistoryTable(sql);
  const connection = await sql.reserve();
  let locked = false;
  try {
    await connection`SELECT pg_advisory_lock(${MIGRATION_LOCK})`;
    locked = true;
    let history = await inspectNotificationMigrationHistory(connection, true);
    if (target < (history.pendingVersion ?? history.currentVersion)) {
      throw new Error("migration target is behind current version");
    }
    for (const migration of MIGRATIONS) {
      if (migration.version > target) break;
      if (migration.version <= history.currentVersion) continue;
      if (
        history.pendingVersion !== undefined &&
        history.pendingVersion !== migration.version
      ) {
        throw new Error("notification migration history is not continuous");
      }
      const [source, downSource] = await Promise.all([
        migrationSql(migration.version, migration.name, "up"),
        migrationSql(migration.version, migration.name, "down"),
      ]);
      if (migration.concurrentIndexes) {
        const phases = splitConcurrentMigrationSource(migration, source);
        if (history.pendingVersion === undefined) {
          await closeNotificationGates(connection);
          await connection.begin(async (transaction) => {
            const current = await inspectNotificationMigrationHistory(
              transaction,
              true,
            );
            if (current.currentVersion >= migration.version) return;
            if (
              current.pendingVersion !== undefined ||
              current.currentVersion !== migration.version - 1
            ) {
              throw new Error(
                "notification migration history is not continuous",
              );
            }
            await transaction.unsafe(phases.transactionalSource);
            await recordMigration(
              transaction,
              migration,
              source,
              downSource,
              "applying",
            );
          });
        }
        history = await inspectNotificationMigrationHistory(connection, true);
        if (history.currentVersion >= migration.version) continue;
        if (history.pendingVersion !== migration.version) {
          throw new Error("notification migration history is not continuous");
        }
        await applyConcurrentIndexes(
          connection,
          migration.concurrentIndexes,
          phases.concurrentStatements,
        );
        await connection.begin(async (transaction) => {
          const current = await inspectNotificationMigrationHistory(
            transaction,
            true,
          );
          if (current.currentVersion >= migration.version) return;
          if (current.pendingVersion !== migration.version) {
            throw new Error("notification migration history is not continuous");
          }
          await assertNotificationGatesClosed(transaction);
          await assertConcurrentIndexes(
            transaction,
            migration.concurrentIndexes ?? [],
          );
          await transaction`
            UPDATE notification_migration_history
            SET state = 'applied', applied_at = clock_timestamp()
            WHERE version = ${migration.version} AND state = 'applying'
          `;
        });
      } else {
        await connection.begin(async (transaction) => {
          const current = await inspectNotificationMigrationHistory(
            transaction,
            true,
          );
          if (current.currentVersion >= migration.version) return;
          if (
            current.pendingVersion !== undefined ||
            current.currentVersion !== migration.version - 1
          ) {
            throw new Error("notification migration history is not continuous");
          }
          await transaction.unsafe(source);
          await recordMigration(
            transaction,
            migration,
            source,
            downSource,
            "applied",
          );
        });
      }
      history = await inspectNotificationMigrationHistory(connection, true);
    }
    await inspectNotificationMigrationHistory(connection, false);
  } finally {
    try {
      if (locked) {
        await connection`SELECT pg_advisory_unlock(${MIGRATION_LOCK})`;
      }
    } finally {
      connection.release();
    }
  }
}

export async function rollbackNotificationMigrations(
  sql: SQL,
  options: { readonly target: number },
): Promise<void> {
  const target = validateTarget(options.target);
  await ensureHistoryTable(sql);
  let current = await assertNotificationMigrationIntegrity(sql);
  while (current > target) {
    const migration = MIGRATIONS.find(
      (candidate) => candidate.version === current,
    );
    if (!migration)
      throw new Error(`unknown notification migration version ${current}`);
    await sql.begin(async (transaction) => {
      await transaction`SELECT pg_advisory_xact_lock(${MIGRATION_LOCK})`;
      const lockedCurrent =
        await assertNotificationMigrationIntegrity(transaction);
      if (lockedCurrent < migration.version) return;
      if (lockedCurrent !== migration.version) {
        throw new Error("notification migration history is not continuous");
      }
      const source = await migrationSql(
        migration.version,
        migration.name,
        "down",
      );
      const recorded = await transaction<{ down_checksum: string }[]>`
        SELECT down_checksum FROM notification_migration_history
        WHERE version = ${migration.version}
      `;
      if (recorded[0]?.down_checksum.trim() !== sourceChecksum(source)) {
        throw new Error("notification migration down source has drifted");
      }
      await transaction.unsafe(source);
      await transaction`
        DELETE FROM notification_migration_history WHERE version = ${migration.version}
      `;
    });
    current -= 1;
  }
}

export async function getNotificationMigrationStatus(
  sql: SQL,
): Promise<NotificationMigrationStatus> {
  await ensureHistoryTable(sql);
  const version = await assertNotificationMigrationIntegrity(sql);
  if (version === 0) {
    return {
      currentVersion: 0,
      schemaPhase: "absent",
      restoreState: "blocked",
      mutationsEnabled: false,
      monitorsEnabled: false,
      deliveryEnabled: false,
      ledgerWatermark: 0,
      ledgerHead: 0,
    };
  }
  const rows = await sql<
    {
      schema_phase: "expand" | "migrated" | "contracted";
      restore_state: "blocked" | "replaying" | "ready";
      mutations_enabled: boolean;
      monitors_enabled: boolean;
      delivery_enabled: boolean;
      ledger_watermark: string | number;
      ledger_head: string | number;
    }[]
  >`
    SELECT schema_phase, restore_state, mutations_enabled, monitors_enabled,
           delivery_enabled, ledger_watermark, ledger_head
    FROM notification_service_state WHERE singleton
  `;
  const state = rows[0];
  if (!state) throw new Error("notification service state is missing");
  return {
    currentVersion: version,
    schemaPhase: state.schema_phase,
    restoreState: state.restore_state,
    mutationsEnabled: state.mutations_enabled,
    monitorsEnabled: state.monitors_enabled,
    deliveryEnabled: state.delivery_enabled,
    ledgerWatermark: Number(state.ledger_watermark),
    ledgerHead: Number(state.ledger_head),
  };
}

async function ensureHistoryTable(sql: SQL): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS notification_migration_history (
      version integer PRIMARY KEY CHECK (version > 0),
      name text NOT NULL,
      up_checksum char(64) NOT NULL CHECK (up_checksum ~ '^[0-9a-f]{64}$'),
      down_checksum char(64) NOT NULL CHECK (down_checksum ~ '^[0-9a-f]{64}$'),
      state text NOT NULL DEFAULT 'applied'
        CHECK (state IN ('applying', 'applied')),
      applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )
  `;
  await sql`
    ALTER TABLE notification_migration_history
      ADD COLUMN IF NOT EXISTS up_checksum char(64),
      ADD COLUMN IF NOT EXISTS down_checksum char(64),
      ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'applied'
        CHECK (state IN ('applying', 'applied'))
  `;
}

export async function assertNotificationMigrationIntegrity(
  sql: SQL,
): Promise<number> {
  return (await inspectNotificationMigrationHistory(sql, false)).currentVersion;
}

async function inspectNotificationMigrationHistory(
  sql: SQL,
  allowPending: boolean,
): Promise<{ currentVersion: number; pendingVersion?: number }> {
  const rows = await sql<
    {
      version: number;
      name: string;
      up_checksum: string | null;
      down_checksum: string | null;
      state: string;
    }[]
  >`
    SELECT version, name, up_checksum, down_checksum, state
    FROM notification_migration_history ORDER BY version
  `;
  if (rows.length > MIGRATIONS.length) {
    throw new Error("notification migration history contains unknown rows");
  }
  let currentVersion = 0;
  let pendingVersion: number | undefined;
  for (const [index, row] of rows.entries()) {
    const expected = MIGRATIONS[index];
    if (!expected || row.version !== index + 1 || row.name !== expected.name) {
      throw new Error("notification migration history is not continuous");
    }
    const [upSource, downSource] = await Promise.all([
      migrationSql(expected.version, expected.name, "up"),
      migrationSql(expected.version, expected.name, "down"),
    ]);
    if (
      row.up_checksum?.trim() !== sourceChecksum(upSource) ||
      row.down_checksum?.trim() !== sourceChecksum(downSource)
    ) {
      throw new Error("notification migration source checksum mismatch");
    }
    if (row.state === "applying") {
      if (
        !expected.concurrentIndexes ||
        pendingVersion !== undefined ||
        index !== rows.length - 1
      ) {
        throw new Error("notification migration history is not continuous");
      }
      pendingVersion = row.version;
    } else if (row.state === "applied") {
      if (pendingVersion !== undefined) {
        throw new Error("notification migration history is not continuous");
      }
      currentVersion = row.version;
    } else {
      throw new Error("notification migration history is not continuous");
    }
  }
  if (pendingVersion !== undefined && !allowPending) {
    throw new Error(
      "notification migration has an incomplete concurrent index phase",
    );
  }
  return pendingVersion === undefined
    ? { currentVersion }
    : { currentVersion, pendingVersion };
}

async function recordMigration(
  sql: SQL,
  migration: MigrationDefinition,
  source: string,
  downSource: string,
  state: "applying" | "applied",
): Promise<void> {
  await sql`
    INSERT INTO notification_migration_history (
      version, name, up_checksum, down_checksum, state
    ) VALUES (
      ${migration.version}, ${migration.name}, ${sourceChecksum(source)},
      ${sourceChecksum(downSource)}, ${state}
    )
  `;
}

async function closeNotificationGates(sql: SQL): Promise<void> {
  await sql`
    UPDATE notification_service_state
    SET restore_state = 'blocked', mutations_enabled = false,
        monitors_enabled = false, delivery_enabled = false,
        updated_at = clock_timestamp()
    WHERE singleton
  `;
}

async function assertNotificationGatesClosed(sql: SQL): Promise<void> {
  const rows = await sql<
    {
      restore_state: string;
      mutations_enabled: boolean;
      monitors_enabled: boolean;
      delivery_enabled: boolean;
    }[]
  >`
    SELECT restore_state, mutations_enabled, monitors_enabled, delivery_enabled
    FROM notification_service_state
    WHERE singleton
  `;
  const state = rows[0];
  if (
    state?.restore_state !== "blocked" ||
    state.mutations_enabled ||
    state.monitors_enabled ||
    state.delivery_enabled
  ) {
    throw new Error(
      "notification migration gates opened before the concurrent index phase completed",
    );
  }
}

function splitConcurrentMigrationSource(
  migration: MigrationDefinition,
  source: string,
): {
  transactionalSource: string;
  concurrentStatements: readonly string[];
} {
  const indexes = migration.concurrentIndexes;
  const first = indexes?.[0];
  if (!indexes || !first) {
    throw new Error(
      "notification migration concurrent index metadata is empty",
    );
  }
  const marker = `CREATE INDEX ${first.name}`;
  const offset = source.indexOf(marker);
  if (offset < 0 || source.indexOf(marker, offset + marker.length) >= 0) {
    throw new Error(
      "notification migration concurrent index source is invalid",
    );
  }
  const transactionalSource = source.slice(0, offset).trim();
  const concurrentStatements = source
    .slice(offset)
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
  if (
    transactionalSource.length === 0 ||
    concurrentStatements.length !== indexes.length
  ) {
    throw new Error(
      "notification migration concurrent index source is invalid",
    );
  }
  for (const [index, statement] of concurrentStatements.entries()) {
    const expected = indexes[index];
    if (
      !expected ||
      !statement.startsWith(`CREATE INDEX ${expected.name}`) ||
      !statement.includes(`ON ${expected.table} (`)
    ) {
      throw new Error(
        "notification migration concurrent index source does not match metadata",
      );
    }
  }
  return { transactionalSource, concurrentStatements };
}

async function applyConcurrentIndexes(
  sql: ReservedSQL,
  indexes: readonly ConcurrentIndexDefinition[],
  statements: readonly string[],
): Promise<void> {
  for (const [index, definition] of indexes.entries()) {
    const statement = statements[index];
    if (!statement) {
      throw new Error(
        "notification migration concurrent index source is invalid",
      );
    }
    const existing = await readConcurrentIndex(sql, definition.name);
    if (existing) {
      assertConcurrentIndexDefinition(existing, definition);
      if (existing.valid && existing.ready) continue;
      await sql.unsafe(
        `DROP INDEX CONCURRENTLY IF EXISTS ${quoteIdentifier(definition.name)}`,
      );
    }
    await sql.unsafe(
      `${statement.replace(
        /^CREATE INDEX /u,
        "CREATE INDEX CONCURRENTLY IF NOT EXISTS ",
      )};`,
    );
    const created = await readConcurrentIndex(sql, definition.name);
    if (!created) {
      throw new Error(
        `notification migration concurrent index phase did not create ${definition.name}`,
      );
    }
    assertConcurrentIndexDefinition(created, definition);
    if (!created.valid || !created.ready) {
      throw new Error(
        `notification migration concurrent index phase left ${definition.name} invalid`,
      );
    }
  }
}

async function assertConcurrentIndexes(
  sql: SQL,
  indexes: readonly ConcurrentIndexDefinition[],
): Promise<void> {
  for (const definition of indexes) {
    const index = await readConcurrentIndex(sql, definition.name);
    if (!index) {
      throw new Error(
        `notification migration concurrent index phase is missing ${definition.name}`,
      );
    }
    assertConcurrentIndexDefinition(index, definition);
    if (!index.valid || !index.ready) {
      throw new Error(
        `notification migration concurrent index phase left ${definition.name} invalid`,
      );
    }
  }
}

interface ConcurrentIndexState {
  readonly tableName: string;
  readonly accessMethod: string;
  readonly valid: boolean;
  readonly ready: boolean;
  readonly unique: boolean;
  readonly keys: string;
  readonly predicate: string | null;
}

async function readConcurrentIndex(
  sql: SQL,
  name: string,
): Promise<ConcurrentIndexState | undefined> {
  const rows = await sql<
    {
      table_name: string;
      access_method: string;
      valid: boolean;
      ready: boolean;
      unique: boolean;
      keys: string;
      predicate: string | null;
    }[]
  >`
    SELECT table_class.relname AS table_name,
           access_method.amname AS access_method,
           index_state.indisvalid AS valid,
           index_state.indisready AS ready,
           index_state.indisunique AS unique,
           array_to_string(
             ARRAY(
               SELECT pg_get_indexdef(
                 index_state.indexrelid,
                 key_position,
                 true
               )
               FROM generate_series(
                 1,
                 index_state.indnkeyatts
               ) AS key_position
             ),
             ','
           ) AS keys,
           pg_get_expr(
             index_state.indpred,
             index_state.indrelid,
             true
           ) AS predicate
    FROM pg_class AS index_class
    JOIN pg_namespace AS index_namespace
      ON index_namespace.oid = index_class.relnamespace
    JOIN pg_index AS index_state
      ON index_state.indexrelid = index_class.oid
    JOIN pg_class AS table_class
      ON table_class.oid = index_state.indrelid
    JOIN pg_am AS access_method
      ON access_method.oid = index_class.relam
    WHERE index_namespace.nspname = current_schema()
      AND index_class.relname = ${name}
  `;
  const row = rows[0];
  if (!row) return undefined;
  return {
    tableName: row.table_name,
    accessMethod: row.access_method,
    valid: row.valid,
    ready: row.ready,
    unique: row.unique,
    keys: row.keys,
    predicate: row.predicate,
  };
}

function assertConcurrentIndexDefinition(
  actual: ConcurrentIndexState,
  expected: ConcurrentIndexDefinition,
): void {
  if (
    actual.tableName !== expected.table ||
    actual.accessMethod !== "btree" ||
    actual.unique ||
    actual.keys !== expected.keys ||
    actual.predicate !== expected.predicate
  ) {
    throw new Error(
      `notification migration concurrent index phase found an unexpected definition for ${expected.name}: ${JSON.stringify(actual)}`,
    );
  }
}

function quoteIdentifier(identifier: string): string {
  if (!/^[a-z][a-z0-9_]{0,62}$/u.test(identifier)) {
    throw new Error("notification migration index name is invalid");
  }
  return `"${identifier}"`;
}

async function migrationSql(
  version: number,
  name: string,
  direction: "up" | "down",
): Promise<string> {
  const filename = `${String(version).padStart(4, "0")}_${name}.${direction}.sql`;
  const file = Bun.file(
    new URL(`../../migrations/${filename}`, import.meta.url),
  );
  try {
    return await file.text();
  } catch {
    throw new Error(`missing migration ${filename}`);
  }
}

function sourceChecksum(source: string): string {
  return createHash("sha256").update(source, "utf8").digest("hex");
}

function validateTarget(target: number): number {
  if (
    !Number.isSafeInteger(target) ||
    target < 0 ||
    target > MIGRATIONS.length
  ) {
    throw new Error("notification migration target is invalid");
  }
  return target;
}
