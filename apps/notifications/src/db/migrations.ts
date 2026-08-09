import { createHash } from "node:crypto";
import type { SQL } from "bun";

const MIGRATION_LOCK = 824_179_311;
const MIGRATIONS = [
  { version: 1, name: "expand" },
  { version: 2, name: "migrate" },
  { version: 3, name: "contract" },
  { version: 4, name: "workers" },
] as const;

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
  const current = await assertNotificationMigrationIntegrity(sql);
  if (target < current)
    throw new Error("migration target is behind current version");
  for (const migration of MIGRATIONS) {
    if (migration.version <= current || migration.version > target) continue;
    const source = await migrationSql(migration.version, migration.name, "up");
    await sql.begin(async (transaction) => {
      await transaction`SELECT pg_advisory_xact_lock(${MIGRATION_LOCK})`;
      const lockedCurrent =
        await assertNotificationMigrationIntegrity(transaction);
      if (lockedCurrent >= migration.version) return;
      if (lockedCurrent !== migration.version - 1) {
        throw new Error("notification migration history is not continuous");
      }
      const downSource = await migrationSql(
        migration.version,
        migration.name,
        "down",
      );
      await transaction.unsafe(source);
      await transaction`
        INSERT INTO notification_migration_history (
          version, name, up_checksum, down_checksum
        ) VALUES (
          ${migration.version}, ${migration.name}, ${sourceChecksum(source)},
          ${sourceChecksum(downSource)}
        )
      `;
    });
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
      applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )
  `;
  await sql`
    ALTER TABLE notification_migration_history
      ADD COLUMN IF NOT EXISTS up_checksum char(64),
      ADD COLUMN IF NOT EXISTS down_checksum char(64)
  `;
}

export async function assertNotificationMigrationIntegrity(
  sql: SQL,
): Promise<number> {
  const rows = await sql<
    {
      version: number;
      name: string;
      up_checksum: string | null;
      down_checksum: string | null;
    }[]
  >`
    SELECT version, name, up_checksum, down_checksum
    FROM notification_migration_history ORDER BY version
  `;
  if (rows.length > MIGRATIONS.length) {
    throw new Error("notification migration history contains unknown rows");
  }
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
  }
  return rows.length;
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
