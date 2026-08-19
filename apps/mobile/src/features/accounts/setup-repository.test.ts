import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import { bunSqliteConnection } from "../../platform/persistence/sqlite-test.fixture";
import type { SetupAttempt } from "./setup-coordinator";
import { SqliteSetupRepository } from "./setup-repository";

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
});
