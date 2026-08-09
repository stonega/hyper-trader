import {
  assertSignerBinding,
  assertTestnetSigningCapability,
  normalizeSignerBinding,
} from "@hyper-trader/hyperliquid";

import type { ExpoSqliteSyncConnection } from "../../platform/persistence/action-journal";
import { LOWERCASE_HASH_PATTERN } from "../../platform/persistence/validation";
import {
  AGENT_REGISTRATION_NAME_PATTERN,
  CONNECTOR_SESSION_PATTERN,
} from "../../platform/wallet/setup-identifiers";
import {
  AGENT_AUTHORIZATION_DURATION_MS,
  bindingFromAttempt,
  normalizeSetupTarget,
  SETUP_ATTEMPT_DURATION_MS,
  type SetupAttempt,
  type SetupRepository,
} from "./setup-coordinator";

interface SetupAttemptRow {
  readonly attempt_id: string;
  readonly status: "pending" | "consumed" | "cancelled" | "failed";
  readonly network: "testnet";
  readonly connector_session_id: string;
  readonly master_account: string;
  readonly target_account: string;
  readonly agent_address: string;
  readonly registration_name: string;
  readonly registration_generation: number;
  readonly approval_nonce: number;
  readonly requested_expiry: number;
  readonly effective_expiry: number | null;
  readonly created_at: number;
  readonly expires_at: number;
}

function assertAttemptContract(attempt: SetupAttempt): void {
  bindingFromAttempt(attempt);
  if (
    !LOWERCASE_HASH_PATTERN.test(attempt.id) ||
    !CONNECTOR_SESSION_PATTERN.test(attempt.connectorSessionId) ||
    !AGENT_REGISTRATION_NAME_PATTERN.test(attempt.registrationName) ||
    !Number.isSafeInteger(attempt.approvalNonce) ||
    !Number.isSafeInteger(attempt.requestedExpiry) ||
    !Number.isSafeInteger(attempt.createdAt) ||
    !Number.isSafeInteger(attempt.expiresAt) ||
    attempt.approvalNonce !== attempt.createdAt ||
    attempt.expiresAt - attempt.createdAt !== SETUP_ATTEMPT_DURATION_MS ||
    attempt.requestedExpiry - attempt.approvalNonce !==
      AGENT_AUTHORIZATION_DURATION_MS
  ) {
    throw new TypeError("The setup attempt checkpoint is malformed.");
  }
}

function attemptFromRow(row: SetupAttemptRow): SetupAttempt {
  const binding = normalizeSignerBinding({
    network: row.network,
    masterAccount: row.master_account,
    targetAccount: row.target_account,
    agentAddress: row.agent_address,
    generation: row.registration_generation,
  });
  if (
    row.status !== "pending" ||
    row.effective_expiry !== null ||
    !Number.isSafeInteger(row.approval_nonce) ||
    !Number.isSafeInteger(row.requested_expiry) ||
    !Number.isSafeInteger(row.created_at) ||
    !Number.isSafeInteger(row.expires_at) ||
    row.created_at <= 0 ||
    row.expires_at <= row.created_at ||
    row.requested_expiry <= row.approval_nonce
  ) {
    throw new Error("The stored setup checkpoint is malformed.");
  }
  const attempt: SetupAttempt = {
    id: row.attempt_id as `0x${string}`,
    network: "testnet",
    connectorSessionId: row.connector_session_id,
    masterAccount: binding.masterAccount,
    targetAccount: binding.targetAccount,
    agentAddress: binding.agentAddress,
    registrationName: row.registration_name,
    registrationGeneration: binding.generation,
    approvalNonce: row.approval_nonce,
    requestedExpiry: row.requested_expiry,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
  assertAttemptContract(attempt);
  return attempt;
}

export function initializeApiWalletSetupPersistence(
  database: ExpoSqliteSyncConnection,
): void {
  database.execSync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS api_wallet_bindings (
      network TEXT NOT NULL CHECK (network = 'testnet'),
      master_account TEXT NOT NULL,
      target_account TEXT NOT NULL,
      agent_address TEXT NOT NULL,
      registration_name TEXT NOT NULL,
      registration_generation INTEGER NOT NULL CHECK (registration_generation > 0),
      requested_expiry INTEGER NOT NULL,
      effective_expiry INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('active', 'retiring', 'retired', 'quarantined')),
      activated_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (network, agent_address),
      UNIQUE (network, master_account, target_account, registration_generation)
    );

    CREATE TABLE IF NOT EXISTS api_wallet_setup_attempts (
      attempt_id TEXT PRIMARY KEY NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'consumed', 'cancelled', 'failed')),
      failure_reason TEXT,
      network TEXT NOT NULL CHECK (network = 'testnet'),
      connector_session_id TEXT NOT NULL,
      master_account TEXT NOT NULL,
      target_account TEXT NOT NULL,
      agent_address TEXT NOT NULL,
      registration_name TEXT NOT NULL,
      registration_generation INTEGER NOT NULL CHECK (registration_generation > 0),
      approval_nonce INTEGER NOT NULL,
      requested_expiry INTEGER NOT NULL,
      effective_expiry INTEGER,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      consumed_at INTEGER,
      UNIQUE (network, agent_address),
      UNIQUE (network, master_account, target_account, registration_generation)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS api_wallet_one_pending_target
      ON api_wallet_setup_attempts(network, master_account, target_account)
      WHERE status = 'pending';

    CREATE UNIQUE INDEX IF NOT EXISTS api_wallet_one_active_target
      ON api_wallet_bindings(network, master_account, target_account)
      WHERE status = 'active';

    CREATE INDEX IF NOT EXISTS api_wallet_setup_expiry
      ON api_wallet_setup_attempts(status, expires_at);

    CREATE INDEX IF NOT EXISTS api_wallet_binding_registration_name
      ON api_wallet_bindings(registration_name);

    CREATE INDEX IF NOT EXISTS api_wallet_attempt_registration_name
      ON api_wallet_setup_attempts(registration_name);
  `);
}

export class SqliteSetupRepository implements SetupRepository {
  constructor(private readonly database: ExpoSqliteSyncConnection) {
    initializeApiWalletSetupPersistence(database);
  }

  private immediate<T>(operation: () => T): T {
    this.database.execSync("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.database.execSync("COMMIT");
      return result;
    } catch (error) {
      this.database.execSync("ROLLBACK");
      throw error;
    }
  }

  nextGeneration(input: {
    readonly network: "testnet";
    readonly masterAccount: string;
    readonly targetAccount: string;
  }): number {
    const target = normalizeSetupTarget(input);
    const row = this.database.getFirstSync<{ generation: number }>(
      `SELECT COALESCE(MAX(registration_generation), 0) AS generation
       FROM (
         SELECT registration_generation FROM api_wallet_bindings
         WHERE network = ? AND master_account = ? AND target_account = ?
         UNION ALL
         SELECT registration_generation FROM api_wallet_setup_attempts
         WHERE network = ? AND master_account = ? AND target_account = ?
       )`,
      [
        target.network,
        target.masterAccount,
        target.targetAccount,
        target.network,
        target.masterAccount,
        target.targetAccount,
      ],
    );
    const next = (row?.generation ?? 0) + 1;
    if (!Number.isSafeInteger(next) || next < 1) {
      throw new Error("The registration generation is exhausted.");
    }
    return next;
  }

  createAttempt(attempt: SetupAttempt): void {
    assertAttemptContract(attempt);
    const binding = bindingFromAttempt(attempt);
    assertTestnetSigningCapability(binding.network);
    this.database.runSync(
      `INSERT INTO api_wallet_setup_attempts (
          attempt_id, status, failure_reason, network, connector_session_id,
          master_account, target_account, agent_address, registration_name,
          registration_generation, approval_nonce, requested_expiry,
          effective_expiry, created_at, expires_at, consumed_at
        ) VALUES (?, 'pending', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL)`,
      [
        attempt.id,
        binding.network,
        attempt.connectorSessionId,
        binding.masterAccount,
        binding.targetAccount,
        binding.agentAddress,
        attempt.registrationName,
        binding.generation,
        attempt.approvalNonce,
        attempt.requestedExpiry,
        attempt.createdAt,
        attempt.expiresAt,
      ],
    );
  }

  getPendingAttempt(id: string): SetupAttempt | null {
    const row = this.database.getFirstSync<SetupAttemptRow>(
      `SELECT attempt_id, status, network, connector_session_id,
              master_account, target_account, agent_address,
              registration_name, registration_generation, approval_nonce,
              requested_expiry, effective_expiry, created_at, expires_at
       FROM api_wallet_setup_attempts
       WHERE attempt_id = ? AND status = 'pending'`,
      [id],
    );
    return row === null ? null : attemptFromRow(row);
  }

  getPendingAttemptForTarget(input: {
    readonly network: "testnet";
    readonly masterAccount: string;
    readonly targetAccount: string;
  }): SetupAttempt | null {
    const target = normalizeSetupTarget(input);
    const row = this.database.getFirstSync<SetupAttemptRow>(
      `SELECT attempt_id, status, network, connector_session_id,
              master_account, target_account, agent_address,
              registration_name, registration_generation, approval_nonce,
              requested_expiry, effective_expiry, created_at, expires_at
       FROM api_wallet_setup_attempts
       WHERE network = ? AND master_account = ? AND target_account = ?
         AND status = 'pending'`,
      [target.network, target.masterAccount, target.targetAccount],
    );
    return row === null ? null : attemptFromRow(row);
  }

  consumeAndActivate(input: {
    readonly attemptId: string;
    readonly expected: SetupAttempt;
    readonly effectiveExpiry: number;
    readonly now: number;
  }): boolean {
    assertAttemptContract(input.expected);
    const binding = bindingFromAttempt(input.expected);
    assertTestnetSigningCapability(binding.network);
    if (
      !Number.isSafeInteger(input.effectiveExpiry) ||
      input.effectiveExpiry <= input.now ||
      input.effectiveExpiry > input.expected.requestedExpiry
    ) {
      throw new TypeError("The authoritative credential expiry is invalid.");
    }
    return this.immediate(() => {
      const stored = this.getPendingAttempt(input.attemptId);
      if (stored === null) return false;
      assertSignerBinding(binding, bindingFromAttempt(stored));
      if (
        input.attemptId !== input.expected.id ||
        stored.id !== input.expected.id ||
        stored.connectorSessionId !== input.expected.connectorSessionId ||
        stored.registrationName !== input.expected.registrationName ||
        stored.registrationGeneration !==
          input.expected.registrationGeneration ||
        stored.approvalNonce !== input.expected.approvalNonce ||
        stored.requestedExpiry !== input.expected.requestedExpiry ||
        stored.createdAt !== input.expected.createdAt ||
        stored.expiresAt !== input.expected.expiresAt ||
        input.now >= stored.expiresAt
      ) {
        return false;
      }
      const consumed = this.database.runSync(
        `UPDATE api_wallet_setup_attempts
         SET status = 'consumed', effective_expiry = ?, consumed_at = ?
         WHERE attempt_id = ? AND status = 'pending' AND expires_at > ?`,
        [input.effectiveExpiry, input.now, input.attemptId, input.now],
      );
      if (consumed.changes !== 1) return false;
      this.database.runSync(
        `UPDATE api_wallet_bindings
         SET status = 'retiring', updated_at = ?
         WHERE network = ? AND master_account = ? AND target_account = ?
           AND status = 'active'`,
        [
          input.now,
          binding.network,
          binding.masterAccount,
          binding.targetAccount,
        ],
      );
      this.database.runSync(
        `INSERT INTO api_wallet_bindings (
          network, master_account, target_account, agent_address,
          registration_name, registration_generation, requested_expiry,
          effective_expiry, status, activated_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
        [
          binding.network,
          binding.masterAccount,
          binding.targetAccount,
          binding.agentAddress,
          input.expected.registrationName,
          binding.generation,
          input.expected.requestedExpiry,
          input.effectiveExpiry,
          input.now,
          input.now,
        ],
      );
      return true;
    });
  }

  cancelAttempt(id: string, reason = "cancelled"): void {
    this.database.runSync(
      `UPDATE api_wallet_setup_attempts
       SET status = 'cancelled', failure_reason = ?
       WHERE attempt_id = ? AND status = 'pending'`,
      [reason.slice(0, 64), id],
    );
  }

  hasConflictingRegistrationHistory(input: {
    readonly network: "testnet";
    readonly masterAccount: string;
    readonly targetAccount: string;
    readonly registrationName: string;
  }): boolean {
    assertTestnetSigningCapability(input.network);
    const target = normalizeSetupTarget(input);
    const row = this.database.getFirstSync<{ one: number }>(
      `SELECT 1 AS one
       WHERE EXISTS (
         SELECT 1 FROM api_wallet_bindings
         WHERE registration_name = ?
           AND (network <> ? OR master_account <> ? OR target_account <> ?)
       ) OR EXISTS (
         SELECT 1 FROM api_wallet_setup_attempts
         WHERE registration_name = ?
           AND (network <> ? OR master_account <> ? OR target_account <> ?)
       )`,
      [
        input.registrationName,
        target.network,
        target.masterAccount,
        target.targetAccount,
        input.registrationName,
        target.network,
        target.masterAccount,
        target.targetAccount,
      ],
    );
    return row !== null;
  }
}
