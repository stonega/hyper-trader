import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import { bunSqliteConnection } from "../../platform/persistence/sqlite-test.fixture";
import type { SetupAttempt } from "./setup-coordinator";
import {
  initializeApiWalletSetupPersistence,
  SqliteSetupRepository,
} from "./setup-repository";

const ATTEMPT: SetupAttempt = {
  id: `0x${"a".repeat(64)}`,
  network: "testnet",
  connectorSessionId: "session-1",
  masterAccount: "0x1111111111111111111111111111111111111111",
  targetAccount: "0x2222222222222222222222222222222222222222",
  agentAddress: "0x3333333333333333333333333333333333333333",
  registrationName: "ht-123456789abcd",
  registrationGeneration: 1,
  approvalNonce: 1_800_000_000_000,
  requestedExpiry: 1_802_592_000_000,
  createdAt: 1_800_000_000_000,
  expiresAt: 1_800_086_400_000,
};

describe("SQLite setup repository", () => {
  test("consumes an exact checkpoint once and isolates target generations", () => {
    const database = new Database(":memory:");
    const repository = new SqliteSetupRepository(bunSqliteConnection(database));
    repository.createAttempt(ATTEMPT);
    expect(repository.getPendingAttemptForTarget(ATTEMPT)).toEqual(ATTEMPT);
    expect(repository.nextGeneration(ATTEMPT)).toBe(2);
    expect(
      repository.nextGeneration({
        ...ATTEMPT,
        targetAccount: ATTEMPT.masterAccount,
      }),
    ).toBe(1);
    expect(repository.getLatestPendingAttempt()).toEqual(ATTEMPT);

    expect(
      repository.consumeAndActivate({
        attemptId: ATTEMPT.id,
        expected: ATTEMPT,
        effectiveExpiry: ATTEMPT.requestedExpiry,
        now: ATTEMPT.createdAt + 2_000,
      }),
    ).toBe(true);
    expect(repository.getActivatedAttempt(ATTEMPT.id)).toMatchObject({
      attemptId: ATTEMPT.id,
      binding: {
        agentAddress: ATTEMPT.agentAddress,
        generation: ATTEMPT.registrationGeneration,
      },
      registrationName: ATTEMPT.registrationName,
      effectiveExpiry: ATTEMPT.requestedExpiry,
    });
    expect(repository.getActiveBindingForTarget(ATTEMPT)).toMatchObject({
      binding: {
        network: ATTEMPT.network,
        masterAccount: ATTEMPT.masterAccount,
        targetAccount: ATTEMPT.targetAccount,
        agentAddress: ATTEMPT.agentAddress,
        generation: ATTEMPT.registrationGeneration,
      },
      registrationName: ATTEMPT.registrationName,
      requestedExpiry: ATTEMPT.requestedExpiry,
      effectiveExpiry: ATTEMPT.requestedExpiry,
    });
    expect(
      repository.consumeAndActivate({
        attemptId: ATTEMPT.id,
        expected: ATTEMPT,
        effectiveExpiry: ATTEMPT.requestedExpiry,
        now: ATTEMPT.createdAt + 3_000,
      }),
    ).toBe(false);
    database.close();
  });

  test("accepts any finite future authoritative expiry", () => {
    const database = new Database(":memory:");
    const repository = new SqliteSetupRepository(bunSqliteConnection(database));
    const effectiveExpiry =
      ATTEMPT.requestedExpiry + 365 * 24 * 60 * 60 * 1_000;
    repository.createAttempt(ATTEMPT);

    expect(
      repository.consumeAndActivate({
        attemptId: ATTEMPT.id,
        expected: ATTEMPT,
        effectiveExpiry,
        now: ATTEMPT.createdAt + 2_000,
      }),
    ).toBe(true);
    expect(repository.getActivatedAttempt(ATTEMPT.id)?.effectiveExpiry).toBe(
      effectiveExpiry,
    );
    database.close();
  });

  test("leaves an expired or mismatched checkpoint inert", () => {
    const database = new Database(":memory:");
    const repository = new SqliteSetupRepository(bunSqliteConnection(database));
    repository.createAttempt(ATTEMPT);
    expect(
      repository.consumeAndActivate({
        attemptId: ATTEMPT.id,
        expected: { ...ATTEMPT, connectorSessionId: "forged" },
        effectiveExpiry: ATTEMPT.requestedExpiry,
        now: ATTEMPT.createdAt + 2_000,
      }),
    ).toBe(false);
    expect(
      repository.consumeAndActivate({
        attemptId: ATTEMPT.id,
        expected: ATTEMPT,
        effectiveExpiry: ATTEMPT.requestedExpiry,
        now: ATTEMPT.expiresAt,
      }),
    ).toBe(false);
    database.close();
  });

  test("migrates the testnet-only schema to a network-scoped mainnet-capable schema", () => {
    const database = new Database(":memory:");
    database.exec(`
      CREATE TABLE api_wallet_bindings (
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
      CREATE TABLE api_wallet_setup_attempts (
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
    `);

    initializeApiWalletSetupPersistence(bunSqliteConnection(database));
    const schema = database
      .query("SELECT sql FROM sqlite_master WHERE name = 'api_wallet_bindings'")
      .get() as { sql: string };
    expect(schema.sql).toContain("network IN ('mainnet', 'testnet')");
    database.run(
      `INSERT INTO api_wallet_setup_attempts (
        attempt_id, status, failure_reason, network, connector_session_id,
        master_account, target_account, agent_address, registration_name,
        registration_generation, approval_nonce, requested_expiry,
        effective_expiry, created_at, expires_at, consumed_at
      ) VALUES (?, 'pending', NULL, 'mainnet', ?, ?, ?, ?, ?, 1, ?, ?, NULL, ?, ?, NULL)`,
      [
        `0x${"b".repeat(64)}`,
        "session-mainnet",
        ATTEMPT.masterAccount,
        ATTEMPT.targetAccount,
        "0x4444444444444444444444444444444444444444",
        ATTEMPT.registrationName,
        ATTEMPT.approvalNonce,
        ATTEMPT.requestedExpiry,
        ATTEMPT.createdAt,
        ATTEMPT.expiresAt,
      ],
    );
    expect(
      database
        .query(
          "SELECT COUNT(*) AS count FROM api_wallet_setup_attempts WHERE network = 'mainnet'",
        )
        .get(),
    ).toEqual({ count: 1 });
    database.close();
  });
});
