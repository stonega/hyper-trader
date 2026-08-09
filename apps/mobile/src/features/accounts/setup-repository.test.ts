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
  expiresAt: 1_800_000_600_000,
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

    expect(
      repository.consumeAndActivate({
        attemptId: ATTEMPT.id,
        expected: ATTEMPT,
        effectiveExpiry: ATTEMPT.requestedExpiry,
        now: ATTEMPT.createdAt + 2_000,
      }),
    ).toBe(true);
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
