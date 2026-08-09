import { Database } from "bun:sqlite";
import { SqliteNonceAndJournalRepository } from "./nonce-repository";
import { bunSqliteConnection } from "./sqlite-test.fixture";

const databasePath = process.argv[2];
const rawIndex = process.argv[3];
if (databasePath === undefined || rawIndex === undefined) {
  throw new Error("database path and reservation index are required");
}
const index = Number(rawIndex);
const hex = index.toString(16).padStart(32, "0");
const database = new Database(databasePath);
const connection = bunSqliteConnection(database);
connection.execSync("PRAGMA busy_timeout = 5000");
const repository = new SqliteNonceAndJournalRepository(connection, {
  commitIfCurrent({ capturedContextEpoch }, commit) {
    if (capturedContextEpoch !== 1) {
      throw new Error("The captured context epoch is stale.");
    }
    return commit();
  },
});
try {
  const record = repository.reservePreparedAction({
    binding: {
      network: "testnet",
      masterAccount: "0x1111111111111111111111111111111111111111",
      targetAccount: "0x2222222222222222222222222222222222222222",
      agentAddress: "0x3333333333333333333333333333333333333333",
      generation: 1,
    },
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
  });
  process.stdout.write(JSON.stringify({ nonce: record.nonce }));
} finally {
  database.close();
}
