import {
  ACTION_EXPIRY_MS,
  type ActionJournalRepository,
  assertJournalResultClass,
  assertJournalTransition,
  assertSecretFreeIntent,
  JOURNAL_ACTION_TYPES,
  JOURNAL_STATES,
  type JournalResultClass,
  type JournalState,
  mayMarkSubmissionStarted,
  type PreparedActionRecord,
  type ReconciliationLease,
  restartRecoveryDecision,
  type SubmissionStartReceipt,
  TERMINAL_JOURNAL_STATE_VALUES,
  type TransportWritePermit,
} from "@hyper-trader/hyperliquid";
import type { SQLiteDatabase } from "expo-sqlite";

import {
  assertTime,
  CORRELATION_ID_PATTERN,
  JOURNAL_ID_PATTERN,
  LOWERCASE_ADDRESS_PATTERN,
  LOWERCASE_HASH_PATTERN,
} from "./validation";

type SqliteValue = string | number | null | Uint8Array;
type SqliteParameters = readonly SqliteValue[];

export interface ExpoSqliteSyncConnection {
  execSync(sql: string): void;
  runSync(
    sql: string,
    parameters?: SqliteParameters,
  ): { readonly changes: number; readonly lastInsertRowId: number };
  getFirstSync<T>(sql: string, parameters?: SqliteParameters): T | null;
  getAllSync<T>(sql: string, parameters?: SqliteParameters): T[];
}

/** Compile-time/native adapter; no wrapper changes Expo transaction semantics. */
export function expoSqliteSyncConnection(
  database: SQLiteDatabase,
): ExpoSqliteSyncConnection {
  return {
    execSync(sql) {
      database.execSync(sql);
    },
    runSync(sql, parameters = []) {
      return database.runSync(sql, [...parameters]);
    },
    getFirstSync<T>(sql: string, parameters: SqliteParameters = []): T | null {
      return database.getFirstSync<T>(sql, [...parameters]);
    },
    getAllSync<T>(sql: string, parameters: SqliteParameters = []): T[] {
      return database.getAllSync<T>(sql, [...parameters]);
    },
  };
}

const CLOID_PATTERN = /^0x[0-9a-f]{32}$/;
const ACTION_TYPES: ReadonlySet<string> = new Set(JOURNAL_ACTION_TYPES);
const JOURNAL_STATE_SET: ReadonlySet<string> = new Set(JOURNAL_STATES);
const JOURNAL_STATES_SQL = JOURNAL_STATES.map((state) => `'${state}'`).join(
  ", ",
);
export const TERMINAL_JOURNAL_STATES_SQL = TERMINAL_JOURNAL_STATE_VALUES.map(
  (state) => `'${state}'`,
).join(", ");

export function initializeActionPersistence(
  database: ExpoSqliteSyncConnection,
): void {
  database.execSync("PRAGMA journal_mode = WAL");
  database.execSync("PRAGMA foreign_keys = ON");
  database.execSync("PRAGMA busy_timeout = 5000");
  database.execSync(`
    CREATE TABLE IF NOT EXISTS signer_scopes (
      network TEXT NOT NULL CHECK (network IN ('mainnet', 'testnet')),
      agent_address TEXT NOT NULL,
      master_account TEXT NOT NULL,
      target_account TEXT NOT NULL,
      signer_generation INTEGER NOT NULL CHECK (signer_generation > 0),
      status TEXT NOT NULL CHECK (status IN ('active', 'retiring', 'retired')),
      last_issued_nonce INTEGER,
      last_observed_wall_ms INTEGER,
      activated_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (network, agent_address)
    );

    CREATE TABLE IF NOT EXISTS retired_signer_tombstones (
      installation_epoch TEXT NOT NULL,
      sequence INTEGER NOT NULL CHECK (sequence > 0),
      prior_chain_root TEXT NOT NULL,
      chain_root TEXT NOT NULL,
      network TEXT NOT NULL CHECK (network IN ('mainnet', 'testnet')),
      agent_address_fingerprint TEXT NOT NULL,
      last_issued_nonce INTEGER NOT NULL,
      signer_generation INTEGER NOT NULL CHECK (signer_generation > 0),
      retired_at INTEGER NOT NULL,
      reason TEXT NOT NULL,
      PRIMARY KEY (installation_epoch, sequence),
      UNIQUE (network, agent_address_fingerprint),
      UNIQUE (installation_epoch, chain_root)
    );

    CREATE TABLE IF NOT EXISTS action_journal (
      journal_id TEXT PRIMARY KEY NOT NULL,
      correlation_id TEXT NOT NULL UNIQUE,
      network TEXT NOT NULL CHECK (network IN ('mainnet', 'testnet')),
      master_account TEXT NOT NULL,
      target_account TEXT NOT NULL,
      agent_address TEXT NOT NULL,
      signer_generation INTEGER NOT NULL CHECK (signer_generation > 0),
      captured_context_epoch INTEGER NOT NULL CHECK (captured_context_epoch >= 0),
      action_type TEXT NOT NULL,
      intent_version INTEGER NOT NULL CHECK (intent_version > 0),
      normalized_secret_free_intent TEXT NOT NULL,
      intent_digest TEXT NOT NULL,
      equivalence_fingerprint TEXT NOT NULL,
      nonce INTEGER NOT NULL,
      expires_after_ms INTEGER NOT NULL,
      cloid TEXT,
      asset_id INTEGER,
      target_oid INTEGER,
      reconciliation_key TEXT NOT NULL,
      prepared_at INTEGER NOT NULL,
      state TEXT NOT NULL CHECK (state IN (${JOURNAL_STATES_SQL})),
      submission_started_at INTEGER,
      last_result_class TEXT,
      lease_owner TEXT,
      lease_expires_at INTEGER,
      reconciliation_attempts INTEGER NOT NULL DEFAULT 0,
      next_reconciliation_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (network, agent_address)
        REFERENCES signer_scopes(network, agent_address),
      UNIQUE (network, agent_address, nonce)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS action_journal_cloid_unique
      ON action_journal(network, target_account, cloid)
      WHERE cloid IS NOT NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS action_journal_active_fingerprint_unique
      ON action_journal(
        network,
        master_account,
        target_account,
        action_type,
        equivalence_fingerprint
      )
      WHERE state NOT IN (${TERMINAL_JOURNAL_STATES_SQL});

    CREATE INDEX IF NOT EXISTS action_journal_reconciliation_queue
      ON action_journal(state, next_reconciliation_at, lease_expires_at);
  `);
}

interface ActionJournalRow {
  readonly journal_id: string;
  readonly correlation_id: string;
  readonly network: "mainnet" | "testnet";
  readonly master_account: string;
  readonly target_account: string;
  readonly agent_address: string;
  readonly signer_generation: number;
  readonly captured_context_epoch: number;
  readonly action_type: PreparedActionRecord["actionType"];
  readonly intent_version: number;
  readonly normalized_secret_free_intent: string;
  readonly intent_digest: `0x${string}`;
  readonly equivalence_fingerprint: `0x${string}`;
  readonly nonce: number;
  readonly expires_after_ms: number;
  readonly cloid: string | null;
  readonly asset_id: number | null;
  readonly target_oid: number | null;
  readonly reconciliation_key: string;
  readonly prepared_at: number;
  readonly state: JournalState;
  readonly submission_started_at: number | null;
  readonly last_result_class: JournalResultClass | null;
  readonly lease_owner: string | null;
  readonly lease_expires_at: number | null;
  readonly reconciliation_attempts: number;
  readonly next_reconciliation_at: number;
  readonly created_at: number;
  readonly updated_at: number;
}

export function assertPreparedActionFields(
  input: Pick<
    PreparedActionRecord,
    | "actionType"
    | "intentVersion"
    | "cloid"
    | "assetId"
    | "targetOid"
    | "reconciliationKey"
  >,
): void {
  if (!ACTION_TYPES.has(input.actionType)) {
    throw new TypeError("actionType is not supported by this journal version.");
  }
  if (input.intentVersion !== 1) {
    throw new TypeError("intentVersion is not supported by this repository.");
  }
  if (input.cloid !== null && !CLOID_PATTERN.test(input.cloid)) {
    throw new TypeError("cloid must be a lowercase 128-bit client order ID.");
  }
  if (
    input.assetId !== null &&
    (!Number.isSafeInteger(input.assetId) || input.assetId < 0)
  ) {
    throw new TypeError(
      "assetId must be a non-negative safe integer when present.",
    );
  }
  if (
    input.targetOid !== null &&
    (!Number.isSafeInteger(input.targetOid) || input.targetOid <= 0)
  ) {
    throw new TypeError(
      "targetOid must be a positive safe integer when present.",
    );
  }
  if (
    input.reconciliationKey.length < 3 ||
    input.reconciliationKey.length > 256 ||
    !/^[a-z0-9:_-]+$/.test(input.reconciliationKey)
  ) {
    throw new TypeError(
      "reconciliationKey must be a bounded derived identifier.",
    );
  }
  const hasCloid = input.cloid !== null;
  const hasAsset = input.assetId !== null;
  const hasOid = input.targetOid !== null;
  switch (input.actionType) {
    case "market_order":
    case "limit_order":
    case "reduce_only_close":
      if (!hasCloid || !hasAsset || hasOid) {
        throw new TypeError(
          `${input.actionType} requires assetId and cloid, and forbids targetOid.`,
        );
      }
      return;
    case "cancel":
      if (!hasAsset || hasCloid === hasOid) {
        throw new TypeError(
          "cancel requires assetId and exactly one of cloid or targetOid.",
        );
      }
      return;
    case "bulk_cancel":
      if (hasAsset || hasCloid || hasOid) {
        throw new TypeError(
          "bulk_cancel stores its targets only in the normalized intent.",
        );
      }
      return;
    case "update_leverage":
      if (!hasAsset || hasCloid || hasOid) {
        throw new TypeError(
          "update_leverage requires assetId and forbids cloid and targetOid.",
        );
      }
      return;
    default:
      throw new TypeError(
        "actionType is not supported by this journal version.",
      );
  }
}

function assertStoredRecord(record: PreparedActionRecord): void {
  if (
    !JOURNAL_ID_PATTERN.test(record.journalId) ||
    !CORRELATION_ID_PATTERN.test(record.correlationId)
  ) {
    throw new TypeError("The stored action has an invalid opaque identifier.");
  }
  if (
    (record.network !== "mainnet" && record.network !== "testnet") ||
    !LOWERCASE_ADDRESS_PATTERN.test(record.masterAccount) ||
    !LOWERCASE_ADDRESS_PATTERN.test(record.targetAccount) ||
    !LOWERCASE_ADDRESS_PATTERN.test(record.agentAddress)
  ) {
    throw new TypeError("The stored action has an invalid signer binding.");
  }
  if (
    !LOWERCASE_HASH_PATTERN.test(record.intentDigest) ||
    !LOWERCASE_HASH_PATTERN.test(record.equivalenceFingerprint)
  ) {
    throw new TypeError("The stored action has an invalid digest.");
  }
  if (!JOURNAL_STATE_SET.has(record.state)) {
    throw new TypeError("The stored action has an invalid state.");
  }
  for (const [path, value, minimum] of [
    ["signerGeneration", record.signerGeneration, 1],
    ["capturedContextEpoch", record.capturedContextEpoch, 0],
    ["nonce", record.nonce, 0],
    ["expiresAfterMs", record.expiresAfterMs, 0],
    ["preparedAt", record.preparedAt, 0],
    ["reconciliationAttempts", record.reconciliationAttempts, 0],
    ["nextReconciliationAt", record.nextReconciliationAt, 0],
    ["createdAt", record.createdAt, 0],
    ["updatedAt", record.updatedAt, 0],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < minimum) {
      throw new TypeError(`The stored action has an invalid ${path}.`);
    }
  }
  if (
    record.expiresAfterMs <= record.nonce ||
    record.expiresAfterMs - record.nonce > ACTION_EXPIRY_MS
  ) {
    throw new TypeError(
      "The stored action expiry must be after its nonce and within 15 seconds.",
    );
  }
  assertPreparedActionFields(record);
  assertJournalResultClass(record.state, record.lastResultClass);
  const wasSubmitted = record.submissionStartedAt !== null;
  if (
    (wasSubmitted &&
      (!Number.isSafeInteger(record.submissionStartedAt) ||
        record.submissionStartedAt < record.preparedAt)) ||
    ((record.state === "prepared" ||
      record.state === "abandoned_before_submission") &&
      wasSubmitted) ||
    (record.state !== "prepared" &&
      record.state !== "abandoned_before_submission" &&
      !wasSubmitted) ||
    (record.submissionStartedAt !== null &&
      record.submissionStartedAt >= record.expiresAfterMs)
  ) {
    throw new TypeError(
      "The stored action has an inconsistent submission marker.",
    );
  }
  if ((record.leaseOwner === null) !== (record.leaseExpiresAt === null)) {
    throw new TypeError("The stored action has an incomplete lease.");
  }
  if (record.leaseOwner !== null) {
    assertLeaseOwner(record.leaseOwner);
    assertTime(record.leaseExpiresAt as number, "leaseExpiresAt");
    if (
      record.state !== "submission_started" &&
      record.state !== "unresolved"
    ) {
      throw new TypeError("Only a reconcilable action may hold a lease.");
    }
  }
}

function fromRow(row: ActionJournalRow): PreparedActionRecord {
  const intent: unknown = JSON.parse(row.normalized_secret_free_intent);
  assertSecretFreeIntent(intent);
  const record: PreparedActionRecord = {
    journalId: row.journal_id,
    correlationId: row.correlation_id,
    network: row.network,
    masterAccount: row.master_account,
    targetAccount: row.target_account,
    agentAddress: row.agent_address,
    signerGeneration: row.signer_generation,
    capturedContextEpoch: row.captured_context_epoch,
    actionType: row.action_type,
    intentVersion: row.intent_version,
    normalizedSecretFreeIntent: intent,
    intentDigest: row.intent_digest,
    equivalenceFingerprint: row.equivalence_fingerprint,
    nonce: row.nonce,
    expiresAfterMs: row.expires_after_ms,
    cloid: row.cloid,
    assetId: row.asset_id,
    targetOid: row.target_oid,
    reconciliationKey: row.reconciliation_key,
    preparedAt: row.prepared_at,
    state: row.state,
    submissionStartedAt: row.submission_started_at,
    lastResultClass: row.last_result_class,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
    reconciliationAttempts: row.reconciliation_attempts,
    nextReconciliationAt: row.next_reconciliation_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  assertStoredRecord(record);
  return record;
}

function assertLeaseOwner(owner: string): void {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(owner)) {
    throw new TypeError("Lease owner must be a bounded opaque ID.");
  }
}

function leaseDuration(value: number | undefined): number {
  const duration = value ?? 30_000;
  if (
    !Number.isSafeInteger(duration) ||
    duration < 1_000 ||
    duration > 60_000
  ) {
    throw new TypeError("Lease duration must be between 1 and 60 seconds.");
  }
  return duration;
}

function createTransportWritePermit(journalId: string): TransportWritePermit {
  let available = true;
  return Object.freeze({
    journalId,
    consume<T>(write: () => T): T {
      if (!available) {
        throw new Error(
          "This transport write permit has already been consumed.",
        );
      }
      available = false;
      return write();
    },
  });
}

export class SqliteActionJournalRepository implements ActionJournalRepository {
  private readonly preparedInThisProcess = new Map<string, number>();

  constructor(protected readonly database: ExpoSqliteSyncConnection) {}

  protected immediate<T>(operation: () => T): T {
    let began = false;
    try {
      this.database.execSync("BEGIN IMMEDIATE");
      began = true;
      const result = operation();
      this.database.execSync("COMMIT");
      return result;
    } catch (error) {
      if (began) {
        try {
          this.database.execSync("ROLLBACK");
        } catch {
          // Preserve the original failure. Startup integrity checks quarantine a
          // connection that cannot roll back cleanly.
        }
      }
      throw error;
    }
  }

  getAction(journalId: string): PreparedActionRecord | null {
    const row = this.database.getFirstSync<ActionJournalRow>(
      "SELECT * FROM action_journal WHERE journal_id = ?",
      [journalId],
    );
    return row === null ? null : fromRow(row);
  }

  markSubmissionStarted(
    journalId: string,
    now: number,
  ): SubmissionStartReceipt {
    assertTime(now, "now");
    const processLocalExpiry = this.preparedInThisProcess.get(journalId);
    if (processLocalExpiry === undefined) {
      throw new Error(
        "Transport authority is unavailable for a reservation from another process lifetime.",
      );
    }
    if (now >= processLocalExpiry) {
      this.preparedInThisProcess.delete(journalId);
    }
    const record = this.immediate(() => {
      const current = this.requireAction(journalId);
      if (!mayMarkSubmissionStarted(current, now)) {
        throw new Error("The action cannot start submission.");
      }
      const result = this.database.runSync(
        `UPDATE action_journal
         SET state = 'submission_started', submission_started_at = ?, updated_at = ?
         WHERE journal_id = ? AND state = 'prepared' AND submission_started_at IS NULL`,
        [now, now, journalId],
      );
      if (result.changes !== 1) {
        throw new Error(
          "The action submission marker lost its compare-and-swap.",
        );
      }
      return this.requireAction(journalId);
    });
    this.preparedInThisProcess.delete(journalId);
    return {
      record,
      transportPermit: createTransportWritePermit(journalId),
    };
  }

  transitionAction(
    journalId: string,
    next: JournalState,
    resultClass: JournalResultClass | null,
    now: number,
  ): PreparedActionRecord {
    assertTime(now, "now");
    const record = this.immediate(() => {
      const current = this.requireAction(journalId);
      assertJournalTransition(current.state, next);
      assertJournalResultClass(next, resultClass);
      const result = this.database.runSync(
        `UPDATE action_journal
         SET state = ?, last_result_class = ?, lease_owner = NULL,
             lease_expires_at = NULL, updated_at = ?
         WHERE journal_id = ? AND state = ?`,
        [next, resultClass, now, journalId, current.state],
      );
      if (result.changes !== 1) {
        throw new Error("The journal transition lost its compare-and-swap.");
      }
      return this.requireAction(journalId);
    });
    this.preparedInThisProcess.delete(journalId);
    return record;
  }

  claimReconciliationLease(
    journalId: string,
    owner: string,
    now: number,
    leaseDurationMs?: number,
  ): ReconciliationLease | null {
    assertLeaseOwner(owner);
    assertTime(now, "now");
    const expiresAt = now + leaseDuration(leaseDurationMs);
    return this.immediate(() => {
      const result = this.database.runSync(
        `UPDATE action_journal
         SET lease_owner = ?, lease_expires_at = ?, updated_at = ?
         WHERE journal_id = ?
           AND state IN ('submission_started', 'unresolved')
           AND (lease_owner IS NULL OR lease_expires_at <= ?)`,
        [owner, expiresAt, now, journalId, now],
      );
      return result.changes === 1 ? { journalId, owner, expiresAt } : null;
    });
  }

  claimNextReconciliation(
    owner: string,
    now: number,
    leaseDurationMs?: number,
  ): {
    readonly record: PreparedActionRecord;
    readonly lease: ReconciliationLease;
  } | null {
    assertLeaseOwner(owner);
    assertTime(now, "now");
    const expiresAt = now + leaseDuration(leaseDurationMs);
    return this.immediate(() => {
      const candidate = this.database.getFirstSync<{ journal_id: string }>(
        `SELECT journal_id FROM action_journal
         WHERE state IN ('submission_started', 'unresolved')
           AND next_reconciliation_at <= ?
           AND (lease_owner IS NULL OR lease_expires_at <= ?)
         ORDER BY next_reconciliation_at, prepared_at, journal_id
         LIMIT 1`,
        [now, now],
      );
      if (candidate === null) {
        return null;
      }
      const result = this.database.runSync(
        `UPDATE action_journal
         SET lease_owner = ?, lease_expires_at = ?, updated_at = ?
         WHERE journal_id = ?
           AND (lease_owner IS NULL OR lease_expires_at <= ?)`,
        [owner, expiresAt, now, candidate.journal_id, now],
      );
      if (result.changes !== 1) {
        return null;
      }
      return {
        record: this.requireAction(candidate.journal_id),
        lease: { journalId: candidate.journal_id, owner, expiresAt },
      };
    });
  }

  renewReconciliationLease(
    lease: ReconciliationLease,
    now: number,
    leaseDurationMs?: number,
  ): ReconciliationLease | null {
    assertLeaseOwner(lease.owner);
    assertTime(now, "now");
    const expiresAt = now + leaseDuration(leaseDurationMs);
    const result = this.database.runSync(
      `UPDATE action_journal
       SET lease_expires_at = ?, updated_at = ?
       WHERE journal_id = ? AND lease_owner = ? AND lease_expires_at = ?
         AND lease_expires_at > ?`,
      [expiresAt, now, lease.journalId, lease.owner, lease.expiresAt, now],
    );
    return result.changes === 1
      ? { journalId: lease.journalId, owner: lease.owner, expiresAt }
      : null;
  }

  releaseReconciliationLease(lease: ReconciliationLease, now: number): boolean {
    assertLeaseOwner(lease.owner);
    assertTime(now, "now");
    return (
      this.database.runSync(
        `UPDATE action_journal
         SET lease_owner = NULL, lease_expires_at = NULL, updated_at = ?
         WHERE journal_id = ? AND lease_owner = ? AND lease_expires_at = ?`,
        [now, lease.journalId, lease.owner, lease.expiresAt],
      ).changes === 1
    );
  }

  scheduleReconciliation(
    journalId: string,
    owner: string,
    now: number,
    nextAttemptAt: number,
  ): PreparedActionRecord {
    assertLeaseOwner(owner);
    assertTime(now, "now");
    assertTime(nextAttemptAt, "nextAttemptAt");
    if (nextAttemptAt < now) {
      throw new TypeError(
        "The next reconciliation time cannot be in the past.",
      );
    }
    return this.immediate(() => {
      const current = this.requireAction(journalId);
      if (
        current.leaseOwner !== owner ||
        current.leaseExpiresAt === null ||
        current.leaseExpiresAt <= now
      ) {
        throw new Error("A current reconciliation lease is required.");
      }
      const result = this.database.runSync(
        `UPDATE action_journal
         SET state = 'unresolved', last_result_class = 'unresolved',
             reconciliation_attempts = reconciliation_attempts + 1,
             next_reconciliation_at = ?, lease_owner = NULL,
             lease_expires_at = NULL, updated_at = ?
         WHERE journal_id = ? AND lease_owner = ? AND lease_expires_at > ?`,
        [nextAttemptAt, now, journalId, owner, now],
      );
      if (result.changes !== 1) {
        throw new Error("The reconciliation schedule lost its lease.");
      }
      return this.requireAction(journalId);
    });
  }

  recoverAfterRestart(now: number): readonly PreparedActionRecord[] {
    assertTime(now, "now");
    this.preparedInThisProcess.clear();
    return this.immediate(() => {
      const rows = this.database.getAllSync<ActionJournalRow>(
        `SELECT * FROM action_journal
         WHERE state IN ('prepared', 'submission_started', 'unresolved')
         ORDER BY prepared_at, journal_id`,
      );
      const changed: PreparedActionRecord[] = [];
      for (const row of rows) {
        const current = fromRow(row);
        const decision = restartRecoveryDecision(current);
        if (decision.kind === "unchanged") {
          continue;
        }
        const resultClass =
          decision.state === "unresolved" ? "unresolved" : null;
        const result = this.database.runSync(
          `UPDATE action_journal
           SET state = ?, last_result_class = ?, updated_at = ?
           WHERE journal_id = ? AND state = ?`,
          [decision.state, resultClass, now, current.journalId, current.state],
        );
        if (result.changes !== 1) {
          throw new Error("Restart recovery lost its compare-and-swap.");
        }
        changed.push(this.requireAction(current.journalId));
      }
      return changed;
    });
  }

  protected requireAction(journalId: string): PreparedActionRecord {
    const record = this.getAction(journalId);
    if (record === null) {
      throw new Error("The action journal record does not exist.");
    }
    return record;
  }

  protected registerCurrentProcessReservation(
    journalId: string,
    expiresAfterMs: number,
    now: number,
  ): void {
    for (const [reservedId, expiry] of this.preparedInThisProcess) {
      if (expiry <= now) {
        this.preparedInThisProcess.delete(reservedId);
      }
    }
    this.preparedInThisProcess.set(journalId, expiresAfterMs);
  }
}
