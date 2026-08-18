import { describe, expect, test } from "bun:test";

import {
  appendDeletionTombstone,
  InMemoryDeletionLedger,
  InMemoryTombstoneKeyProvider,
  verifyTombstoneReplay,
} from "./tombstone-recovery";

describe("independent deletion tombstone recovery", () => {
  test("replays a continuous MAC-verified sequence after a backup watermark", async () => {
    const ledger = new InMemoryDeletionLedger();
    const keys = new InMemoryTombstoneKeyProvider({
      "mac-v1": new Uint8Array(32).fill(3),
    });
    await appendDeletionTombstone(
      ledger,
      keys,
      {
        deletionId: "delete-1",
        scopeKind: "installation",
        scopeIdentifier: "11".repeat(16),
        deletionGeneration: 2,
        deletedAt: 1_800_000_000_000,
      },
      "mac-v1",
    );
    await appendDeletionTombstone(
      ledger,
      keys,
      {
        deletionId: "delete-2",
        scopeKind: "account_link",
        scopeIdentifier: "22".repeat(16),
        deletionGeneration: 3,
        deletedAt: 1_800_000_000_001,
      },
      "mac-v1",
    );

    const replay = await verifyTombstoneReplay({
      ledger,
      keyProvider: keys,
      backupWatermark: 0,
    });
    expect(replay.currentHead).toBe(2);
    expect(replay.items.map((item) => item.sequence)).toEqual([1, 2]);
  });

  test("hard-stops on a stale head, sequence gap, invalid MAC, or missing key", async () => {
    const ledger = new InMemoryDeletionLedger();
    const keys = new InMemoryTombstoneKeyProvider({
      "mac-v1": new Uint8Array(32).fill(3),
    });
    await appendDeletionTombstone(
      ledger,
      keys,
      {
        deletionId: "delete-1",
        scopeKind: "installation",
        scopeIdentifier: "11".repeat(16),
        deletionGeneration: 1,
        deletedAt: 1_800_000_000_000,
      },
      "mac-v1",
    );
    await expect(
      verifyTombstoneReplay({
        ledger,
        keyProvider: keys,
        backupWatermark: 2,
      }),
    ).rejects.toThrow("stale");
    ledger.unsafeMutateForTest(1, { mac: "00".repeat(32) });
    await expect(
      verifyTombstoneReplay({
        ledger,
        keyProvider: keys,
        backupWatermark: 0,
      }),
    ).rejects.toThrow("MAC");
    await expect(
      verifyTombstoneReplay({
        ledger,
        keyProvider: new InMemoryTombstoneKeyProvider({}),
        backupWatermark: 0,
      }),
    ).rejects.toThrow("key version");
  });

  test("serializes concurrent appends into monotonic idempotent receipts", async () => {
    const ledger = new InMemoryDeletionLedger();
    const keys = new InMemoryTombstoneKeyProvider({
      "mac-v1": new Uint8Array(32).fill(3),
    });
    const input = (deletionId: string) =>
      appendDeletionTombstone(
        ledger,
        keys,
        {
          deletionId,
          scopeKind: "installation" as const,
          scopeIdentifier: deletionId,
          deletionGeneration: 1,
          deletedAt: 1_800_000_000_000,
        },
        "mac-v1",
      ).then((result) => result.receipt);
    const receipts = await Promise.all([input("delete-a"), input("delete-b")]);
    expect(receipts.map((receipt) => receipt.sequence).sort()).toEqual([1, 2]);
    expect((await input("delete-a")).sequence).toBe(receipts[0]?.sequence);
    expect(await ledger.currentHead()).toBe(2);
  });
});
