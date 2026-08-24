import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  type AtomicActionReservationInput,
  agentAddressFingerprint,
  type ContextEpochAuthority,
  type SignerBinding,
} from "@hyper-trader/hyperliquid";

import { initializeActionPersistence } from "./action-journal";
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

function databasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), "hyper-trader-nonce-"));
  tempDirectories.push(directory);
  return join(directory, "actions.sqlite");
}

class TestContextEpochAuthority implements ContextEpochAuthority {
  currentEpoch = 1;

  commitIfCurrent<T>(
    input: { readonly capturedContextEpoch: number },
    commit: () => T,
  ): T {
    if (input.capturedContextEpoch !== this.currentEpoch) {
      throw new Error("The captured context epoch is stale.");
    }
    return commit();
  }
}

function open(path: string, authority = new TestContextEpochAuthority()) {
  const database = new Database(path);
  const connection = bunSqliteConnection(database);
  initializeActionPersistence(connection);
  return {
    database,
    connection,
    authority,
    repository: new SqliteNonceAndJournalRepository(connection, authority),
  };
}

function reservation(
  index: number,
  overrides: Partial<AtomicActionReservationInput> = {},
): AtomicActionReservationInput {
  const hex = index.toString(16).padStart(32, "0");
  const base: AtomicActionReservationInput = {
    binding,
    capturedContextEpoch: 1,
    clock: {
      wallTimeMs: 1_725_000_000_000,
      monotonicTimeMs: 10_000,
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
  return {
    ...base,
    ...overrides,
    clock: { ...base.clock, ...overrides.clock },
    preparedAction: { ...base.preparedAction, ...overrides.preparedAction },
  };
}

function retireEmptyScope(
  store: ReturnType<typeof open>,
  signerBinding: SignerBinding,
  input: {
    readonly sequence: number;
    readonly priorChainRoot: `0x${string}`;
  },
) {
  store.repository.registerActiveSignerScope({
    binding: signerBinding,
    activatedAt: 1,
  });
  store.repository.markSignerRetiring(signerBinding, 2);
  return store.repository.retireSignerScope(signerBinding, {
    installationEpoch: "installation-epoch-0001",
    sequence: input.sequence,
    priorChainRoot: input.priorChainRoot,
    network: "testnet",
    agentAddressFingerprint: agentAddressFingerprint(
      signerBinding.agentAddress,
    ),
    lastIssuedNonce: 0,
    generation: signerBinding.generation,
    retiredAt: 3 + input.sequence,
    reason: "rotated",
  });
}

describe("SQLite nonce and journal reservation", () => {
  test("atomically reserves unique nonces across independent process connections", async () => {
    const path = databasePath();
    const setup = open(path);
    setup.repository.registerActiveSignerScope({
      binding,
      activatedAt: 1_724_999_000_000,
    });
    setup.database.close();

    const worker = new URL("./nonce-race-worker.fixture.ts", import.meta.url)
      .pathname;
    const processes = Array.from({ length: 8 }, (_, offset) =>
      Bun.spawn([process.execPath, worker, path, String(offset + 1)], {
        stdout: "pipe",
        stderr: "pipe",
      }),
    );
    const outputs = await Promise.all(
      processes.map(async (process) => {
        const stdout = new Response(process.stdout).text();
        const stderr = new Response(process.stderr).text();
        const exitCode = await process.exited;
        const error = await stderr;
        expect(error).toBe("");
        expect(exitCode).toBe(0);
        return JSON.parse(await stdout) as { nonce: number };
      }),
    );
    const nonces = outputs.map(({ nonce }) => nonce).sort((a, b) => a - b);
    expect(new Set(nonces).size).toBe(8);
    expect(nonces).toEqual(
      Array.from({ length: 8 }, (_, index) => 1_725_000_000_000 + index),
    );

    const verify = open(path);
    expect(
      verify.connection.getFirstSync<{ count: number }>(
        "SELECT COUNT(*) AS count FROM action_journal",
      )?.count,
    ).toBe(8);
    verify.database.close();
  }, 15_000);

  test("rolls nonce advancement back on duplicate correlation and active fingerprint", () => {
    const store = open(databasePath());
    store.repository.registerActiveSignerScope({ binding, activatedAt: 1 });
    const first = store.repository.reservePreparedAction(reservation(1));
    expect(() =>
      store.repository.reservePreparedAction(
        reservation(2, {
          preparedAction: {
            ...reservation(2).preparedAction,
            correlationId: reservation(1).preparedAction.correlationId,
          },
        }),
      ),
    ).toThrow("UNIQUE constraint failed");
    expect(() =>
      store.repository.reservePreparedAction(
        reservation(3, {
          preparedAction: {
            ...reservation(3).preparedAction,
            equivalenceFingerprint:
              reservation(1).preparedAction.equivalenceFingerprint,
          },
        }),
      ),
    ).toThrow("UNIQUE constraint failed");
    const next = store.repository.reservePreparedAction(reservation(4));
    expect(next.nonce).toBe(first.nonce + 1);
    store.database.close();
  });

  test("keeps cloid globally unique for its target even after terminal reconciliation", () => {
    const store = open(databasePath());
    store.repository.registerActiveSignerScope({ binding, activatedAt: 1 });
    const first = store.repository.reservePreparedAction(reservation(1));
    const start = store.repository.markSubmissionStarted(
      first.journalId,
      first.preparedAt + 1,
    );
    expect(start.transportPermit.consume(() => "written")).toBe("written");
    store.repository.transitionAction(
      first.journalId,
      "accepted",
      "accepted",
      first.preparedAt + 2,
    );
    const replacement = reservation(2, {
      preparedAction: {
        ...reservation(2).preparedAction,
        cloid: first.cloid,
      },
    });
    expect(() => store.repository.reservePreparedAction(replacement)).toThrow(
      "UNIQUE constraint failed",
    );
    store.database.close();
  });

  test("releases an equivalent intent after an authoritative rejection", () => {
    const store = open(databasePath());
    store.repository.registerActiveSignerScope({ binding, activatedAt: 1 });
    const first = store.repository.reservePreparedAction(reservation(1));
    const start = store.repository.markSubmissionStarted(
      first.journalId,
      first.preparedAt + 1,
    );
    expect(start.transportPermit.consume(() => "written")).toBe("written");
    store.repository.transitionAction(
      first.journalId,
      "rejected",
      "rejected",
      first.preparedAt + 2,
    );

    const replacement = store.repository.reservePreparedAction(
      reservation(2, {
        preparedAction: {
          ...reservation(2).preparedAction,
          equivalenceFingerprint: first.equivalenceFingerprint,
        },
      }),
    );

    expect(replacement.state).toBe("prepared");
    expect(replacement.journalId).not.toBe(first.journalId);
    store.database.close();
  });

  test("blocks clock rollback and cross-target or mainnet scope misuse before mutation", () => {
    const store = open(databasePath());
    store.repository.registerActiveSignerScope({ binding, activatedAt: 1 });
    store.repository.reservePreparedAction(reservation(1));
    expect(() =>
      store.repository.reservePreparedAction(
        reservation(2, {
          clock: {
            ...reservation(2).clock,
            wallTimeMs: 1_724_999_998_999,
            serverTimeMs: 1_724_999_998_999,
          },
        }),
      ),
    ).toThrow("moved backwards");
    expect(() =>
      store.repository.reservePreparedAction(
        reservation(3, {
          binding: {
            ...binding,
            targetAccount: "0x4444444444444444444444444444444444444444",
          },
        }),
      ),
    ).toThrow("not bound to this exact action target");
    expect(() =>
      store.repository.registerActiveSignerScope({
        binding: { ...binding, network: "mainnet" },
        activatedAt: 1,
      }),
    ).toThrow("mainnet signing is disabled");
    store.database.close();
  });

  test("serializes reservation through the live context epoch authority", () => {
    const store = open(databasePath());
    store.repository.registerActiveSignerScope({ binding, activatedAt: 1 });
    store.authority.currentEpoch = 2;
    expect(() =>
      store.repository.reservePreparedAction(reservation(1)),
    ).toThrow("captured context epoch is stale");
    expect(
      store.connection.getFirstSync<{ last_issued_nonce: number | null }>(
        "SELECT last_issued_nonce FROM signer_scopes",
      )?.last_issued_nonce,
    ).toBeNull();
    expect(
      store.connection.getFirstSync<{ count: number }>(
        "SELECT COUNT(*) AS count FROM action_journal",
      )?.count,
    ).toBe(0);
    const current = store.repository.reservePreparedAction(
      reservation(2, { capturedContextEpoch: 2 }),
    );
    expect(current.capturedContextEpoch).toBe(2);
    store.database.close();
  });

  test("locks retirement, requires terminal actions, appends a tombstone, and rejects reuse", () => {
    const store = open(databasePath());
    store.repository.registerActiveSignerScope({ binding, activatedAt: 1 });
    const record = store.repository.reservePreparedAction(reservation(1));
    store.repository.markSignerRetiring(binding, record.preparedAt + 1);
    expect(() =>
      store.repository.reservePreparedAction(reservation(2)),
    ).toThrow("cannot issue another nonce");
    const tombstoneInput = {
      installationEpoch: "installation-epoch-0001",
      sequence: 1,
      priorChainRoot: `0x${"0".repeat(64)}` as `0x${string}`,
      network: "testnet" as const,
      agentAddressFingerprint: agentAddressFingerprint(binding.agentAddress),
      lastIssuedNonce: record.nonce,
      generation: 1,
      retiredAt: record.preparedAt + 10,
      reason: "rotated" as const,
    };
    expect(() =>
      store.repository.retireSignerScope(binding, tombstoneInput),
    ).toThrow("requires terminal actions");
    const start = store.repository.markSubmissionStarted(
      record.journalId,
      record.preparedAt + 2,
    );
    start.transportPermit.consume(() => undefined);
    store.repository.transitionAction(
      record.journalId,
      "accepted",
      "accepted",
      record.preparedAt + 3,
    );
    const tombstone = store.repository.retireSignerScope(
      binding,
      tombstoneInput,
    );
    expect(
      store.repository.compareRetirementManifest({
        installationEpoch: tombstone.installationEpoch,
        sequence: 0,
        chainRoot: tombstone.priorChainRoot,
      }),
    ).toEqual({
      status: "sqlite_ahead",
      sequence: 1,
      chainRoot: tombstone.chainRoot,
    });
    expect(
      store.repository.compareRetirementManifest({
        installationEpoch: tombstone.installationEpoch,
        sequence: tombstone.sequence,
        chainRoot: tombstone.chainRoot,
      }),
    ).toEqual({ status: "match" });
    expect(() =>
      store.repository.registerActiveSignerScope({ binding, activatedAt: 2 }),
    ).toThrow("can never become active again");
    expect(JSON.stringify(tombstone)).not.toContain(binding.masterAccount);
    expect(JSON.stringify(tombstone)).not.toContain(binding.targetAccount);
    store.database.close();
  });

  test("rejects forbidden intent material before it can enter SQLite", () => {
    const store = open(databasePath());
    store.repository.registerActiveSignerScope({ binding, activatedAt: 1 });
    expect(() =>
      store.repository.reservePreparedAction(
        reservation(1, {
          preparedAction: {
            ...reservation(1).preparedAction,
            normalizedSecretFreeIntent: {
              side: "buy",
              signingPayload: "must-not-persist",
            },
          },
        }),
      ),
    ).toThrow("forbidden signing or secret material");
    const columns = store.connection.getAllSync<{ name: string }>(
      "PRAGMA table_info(action_journal)",
    );
    expect(columns.map(({ name }) => name).join(" ")).not.toMatch(
      /private|signature|payload|action_bytes/i,
    );
    store.database.close();
  });

  test("rejects invalid action discriminators, versions, and field applicability", () => {
    const store = open(databasePath());
    store.repository.registerActiveSignerScope({ binding, activatedAt: 1 });
    const invalidActions = [
      { actionType: "withdraw" as never },
      { intentVersion: 2 },
      { actionType: "cancel" as const, cloid: null, targetOid: null },
      {
        actionType: "update_leverage" as const,
        cloid: null,
        assetId: null,
      },
      { targetOid: 42 },
    ];
    for (const [index, invalid] of invalidActions.entries()) {
      const hex = (index + 1).toString(16).padStart(32, "0");
      expect(() =>
        store.repository.reservePreparedAction(
          reservation(index + 10, {
            preparedAction: {
              ...reservation(1).preparedAction,
              journalId: `jrnl_${hex}`,
              correlationId: `act_${hex}`,
              ...invalid,
            },
          }),
        ),
      ).toThrow();
    }
    expect(
      store.connection.getFirstSync<{ count: number }>(
        "SELECT COUNT(*) AS count FROM action_journal",
      )?.count,
    ).toBe(0);
    store.database.close();
  });

  test("quarantines a retirement ledger whose row no longer hashes to its root", () => {
    const store = open(databasePath());
    const tombstone = retireEmptyScope(store, binding, {
      sequence: 1,
      priorChainRoot: `0x${"0".repeat(64)}`,
    });
    store.connection.runSync(
      "UPDATE retired_signer_tombstones SET chain_root = ? WHERE sequence = 1",
      [`0x${"f".repeat(64)}`],
    );
    expect(
      store.repository.compareRetirementManifest({
        installationEpoch: tombstone.installationEpoch,
        sequence: tombstone.sequence,
        chainRoot: tombstone.chainRoot,
      }),
    ).toEqual({
      status: "quarantine",
      reason: "retirement_chain_root_mismatch",
    });
    store.database.close();
  });

  test("quarantines a retirement ledger with a deleted intermediate row", () => {
    const store = open(databasePath());
    const first = retireEmptyScope(store, binding, {
      sequence: 1,
      priorChainRoot: `0x${"0".repeat(64)}`,
    });
    const secondBinding: SignerBinding = {
      ...binding,
      agentAddress: "0x4444444444444444444444444444444444444444",
      generation: 2,
    };
    const second = retireEmptyScope(store, secondBinding, {
      sequence: 2,
      priorChainRoot: first.chainRoot,
    });
    store.connection.runSync(
      "DELETE FROM retired_signer_tombstones WHERE sequence = 1",
    );
    expect(
      store.repository.compareRetirementManifest({
        installationEpoch: second.installationEpoch,
        sequence: second.sequence,
        chainRoot: second.chainRoot,
      }),
    ).toEqual({
      status: "quarantine",
      reason: "retirement_chain_gap_or_link",
    });
    store.database.close();
  });
});
