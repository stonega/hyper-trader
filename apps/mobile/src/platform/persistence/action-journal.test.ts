import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  AtomicActionReservationInput,
  ContextEpochAuthority,
  SignerBinding,
} from "@hyper-trader/hyperliquid";

import {
  type ExpoSqliteSyncConnection,
  initializeActionPersistence,
} from "./action-journal";
import { SqliteNonceAndJournalRepository } from "./nonce-repository";
import { bunSqliteConnection } from "./sqlite-test.fixture";

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true });
  }
});

const binding: SignerBinding = {
  network: "testnet",
  masterAccount: "0x1111111111111111111111111111111111111111",
  targetAccount: "0x2222222222222222222222222222222222222222",
  agentAddress: "0x3333333333333333333333333333333333333333",
  generation: 1,
};

const currentEpoch: ContextEpochAuthority = {
  commitIfCurrent(input, commit) {
    if (input.capturedContextEpoch !== 1) {
      throw new Error("stale context");
    }
    return commit();
  },
};

function databasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), "hyper-trader-journal-"));
  tempDirectories.push(directory);
  return join(directory, "actions.sqlite");
}

function open(path: string): {
  readonly database: Database;
  readonly connection: ExpoSqliteSyncConnection;
  readonly repository: SqliteNonceAndJournalRepository;
} {
  const database = new Database(path);
  const connection = bunSqliteConnection(database);
  initializeActionPersistence(connection);
  return {
    database,
    connection,
    repository: new SqliteNonceAndJournalRepository(connection, currentEpoch),
  };
}

function reservation(index: number): AtomicActionReservationInput {
  const hex = index.toString(16).padStart(32, "0");
  return {
    binding,
    capturedContextEpoch: 1,
    clock: {
      wallTimeMs: 1_725_000_000_000 + index,
      monotonicTimeMs: 10_000 + index,
      serverTimeMs: 1_725_000_000_000,
      serverSampledAtMonotonicMs: 10_000,
      lastObservedWallMs: null,
    },
    preparedAction: {
      journalId: `jrnl_${hex}`,
      correlationId: `act_${hex}`,
      actionType: "market_order",
      intentVersion: 1,
      normalizedSecretFreeIntent: { assetId: 1, side: "buy", size: "1" },
      intentDigest: `0x${hex.padEnd(64, "1")}`,
      equivalenceFingerprint: `0x${hex.padEnd(64, "2")}`,
      cloid: `0x${hex}`,
      assetId: 1,
      targetOid: null,
      reconciliationKey: `cloid:0x${hex}`,
    },
  };
}

function setup(path: string) {
  const store = open(path);
  store.repository.registerActiveSignerScope({ binding, activatedAt: 1 });
  return store;
}

describe("SQLite action journal", () => {
  test("grants one non-reconstructable, one-shot transport permit", () => {
    const path = databasePath();
    const originalProcess = setup(path);
    const record = originalProcess.repository.reservePreparedAction(
      reservation(1),
    );
    const restartedProcess = open(path);

    expect(() =>
      restartedProcess.repository.markSubmissionStarted(
        record.journalId,
        record.preparedAt + 1,
      ),
    ).toThrow("another process lifetime");

    const receipt = originalProcess.repository.markSubmissionStarted(
      record.journalId,
      record.preparedAt + 1,
    );
    expect(receipt.record.state).toBe("submission_started");
    expect(receipt.transportPermit.consume(() => "socket-write")).toBe(
      "socket-write",
    );
    expect(() =>
      receipt.transportPermit.consume(() => "duplicate-write"),
    ).toThrow("already been consumed");
    expect(() =>
      originalProcess.repository.markSubmissionStarted(
        record.journalId,
        record.preparedAt + 2,
      ),
    ).toThrow("another process lifetime");

    restartedProcess.database.close();
    originalProcess.database.close();
  });

  test("abandons every recovered prepared action and never reopens terminal state", () => {
    const path = databasePath();
    const beforeCrash = setup(path);
    const prepared = beforeCrash.repository.reservePreparedAction(
      reservation(1),
    );
    const started = beforeCrash.repository.reservePreparedAction(
      reservation(2),
    );
    beforeCrash.repository
      .markSubmissionStarted(started.journalId, started.preparedAt + 1)
      .transportPermit.consume(() => undefined);
    const accepted = beforeCrash.repository.reservePreparedAction(
      reservation(3),
    );
    beforeCrash.repository
      .markSubmissionStarted(accepted.journalId, accepted.preparedAt + 1)
      .transportPermit.consume(() => undefined);
    beforeCrash.repository.transitionAction(
      accepted.journalId,
      "accepted",
      "accepted",
      accepted.preparedAt + 2,
    );

    const afterCrash = open(path);
    const recovered = afterCrash.repository.recoverAfterRestart(
      prepared.preparedAt + 100,
    );
    expect(recovered.map(({ journalId, state }) => [journalId, state])).toEqual(
      [
        [prepared.journalId, "abandoned_before_submission"],
        [started.journalId, "unresolved"],
      ],
    );
    expect(afterCrash.repository.getAction(accepted.journalId)?.state).toBe(
      "accepted",
    );
    expect(() =>
      afterCrash.repository.markSubmissionStarted(
        prepared.journalId,
        prepared.preparedAt + 101,
      ),
    ).toThrow("another process lifetime");

    afterCrash.database.close();
    beforeCrash.database.close();
  });

  test("denies an expired marker without consuming or mutating transport state", () => {
    const store = setup(databasePath());
    const record = store.repository.reservePreparedAction(reservation(1));
    expect(() =>
      store.repository.markSubmissionStarted(
        record.journalId,
        record.expiresAfterMs,
      ),
    ).toThrow("cannot start submission");
    expect(store.repository.getAction(record.journalId)?.state).toBe(
      "prepared",
    );
    store.database.close();
  });

  test("leases reconcile once, expire, transfer, and preserve durable backoff", () => {
    const path = databasePath();
    const beforeCrash = setup(path);
    const record = beforeCrash.repository.reservePreparedAction(reservation(1));
    beforeCrash.repository
      .markSubmissionStarted(record.journalId, record.preparedAt + 1)
      .transportPermit.consume(() => undefined);
    const afterCrash = open(path);
    afterCrash.repository.recoverAfterRestart(record.preparedAt + 2);

    const first = afterCrash.repository.claimReconciliationLease(
      record.journalId,
      "worker_01",
      record.preparedAt + 3,
      1_000,
    );
    expect(first).not.toBeNull();
    expect(
      afterCrash.repository.claimReconciliationLease(
        record.journalId,
        "worker_02",
        record.preparedAt + 999,
        1_000,
      ),
    ).toBeNull();
    const second = afterCrash.repository.claimReconciliationLease(
      record.journalId,
      "worker_02",
      first?.expiresAt ?? 0,
      1_000,
    );
    expect(second?.owner).toBe("worker_02");
    expect(() =>
      afterCrash.repository.scheduleReconciliation(
        record.journalId,
        "worker_01",
        second?.expiresAt ? second.expiresAt - 500 : 0,
        second?.expiresAt ?? 0,
      ),
    ).toThrow("current reconciliation lease");
    const scheduledAt = (second?.expiresAt ?? 0) - 500;
    const nextAttemptAt = second?.expiresAt ?? 0;
    const scheduled = afterCrash.repository.scheduleReconciliation(
      record.journalId,
      "worker_02",
      scheduledAt,
      nextAttemptAt,
    );
    expect(scheduled.reconciliationAttempts).toBe(1);
    expect(
      afterCrash.repository.claimNextReconciliation(
        "worker_03",
        nextAttemptAt - 1,
      ),
    ).toBeNull();
    const next = afterCrash.repository.claimNextReconciliation(
      "worker_03",
      nextAttemptAt,
    );
    expect(next?.record.journalId).toBe(record.journalId);

    afterCrash.database.close();
    beforeCrash.database.close();
  });

  test("treats SQLite rows as untrusted state", () => {
    const store = setup(databasePath());
    const record = store.repository.reservePreparedAction(reservation(1));
    store.connection.runSync(
      "UPDATE action_journal SET last_result_class = 'accepted' WHERE journal_id = ?",
      [record.journalId],
    );
    expect(() => store.repository.getAction(record.journalId)).toThrow(
      "result class accepted is invalid for state prepared",
    );
    store.connection.runSync(
      "UPDATE action_journal SET last_result_class = NULL, action_type = 'withdraw' WHERE journal_id = ?",
      [record.journalId],
    );
    expect(() => store.repository.getAction(record.journalId)).toThrow(
      "actionType is not supported",
    );
    store.connection.runSync(
      `UPDATE action_journal
       SET action_type = 'market_order', expires_after_ms = nonce + 15001
       WHERE journal_id = ?`,
      [record.journalId],
    );
    expect(() => store.repository.getAction(record.journalId)).toThrow(
      "within 15 seconds",
    );
    store.connection.runSync(
      `UPDATE action_journal
       SET expires_after_ms = nonce + 15000, state = 'submission_started',
           submission_started_at = nonce + 15000
       WHERE journal_id = ?`,
      [record.journalId],
    );
    expect(() => store.repository.getAction(record.journalId)).toThrow(
      "inconsistent submission marker",
    );
    store.database.close();
  });
});
