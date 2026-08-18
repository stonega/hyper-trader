import { describe, expect, test } from "bun:test";

import {
  createNotificationLocalStateRepository,
  NOTIFICATION_LOCAL_STATE_KEY,
} from "./local-state";

function createStorage(initial: string | null = null) {
  let value = initial;
  let writes = 0;
  return {
    storage: {
      getItem: async () => value,
      setItem: async (_key: string, next: string) => {
        writes += 1;
        value = next;
      },
      removeItem: async () => {
        value = null;
      },
    },
    read: () => value,
    writes: () => writes,
  };
}

describe("notification local state", () => {
  test("queues a bounded offline price edit without persisting credentials or push tokens", async () => {
    const harness = createStorage();
    const repository = createNotificationLocalStateRepository(harness.storage);
    await repository.hydrate();
    await repository.queuePriceRule({
      ruleId: "11".repeat(16),
      scope: "price",
      network: "mainnet",
      marketId: "perp:BTC",
      eventType: "price_above",
      threshold: "100000",
    });
    const serialized = harness.read();
    expect(serialized).toContain("perp:BTC");
    expect(serialized).not.toMatch(
      /credential|pushToken|ExponentPushToken|signature|signedPayload|privateKey/i,
    );
    expect(NOTIFICATION_LOCAL_STATE_KEY).toContain("notification");
  });

  test("deduplicates stable alert IDs and caps the persisted history", async () => {
    const harness = createStorage();
    const repository = createNotificationLocalStateRepository(harness.storage);
    await repository.hydrate();
    for (let index = 0; index < 300; index += 1) {
      await repository.markAlertHandled(index.toString(16).padStart(32, "0"));
    }
    await repository.markAlertHandled("ff".repeat(16));
    await repository.markAlertHandled("ff".repeat(16));
    const snapshot = repository.read();
    expect(snapshot.handledAlertIds.length).toBe(256);
    expect(
      snapshot.handledAlertIds.filter((id) => id === "ff".repeat(16)),
    ).toHaveLength(1);
  });

  test("serializes concurrent rule sync and alert handling without losing either update", async () => {
    const harness = createStorage();
    const repository = createNotificationLocalStateRepository(harness.storage);
    await repository.hydrate();
    const rule = {
      ruleId: "12".repeat(16),
      scope: "price" as const,
      network: "testnet" as const,
      marketId: "spot:BTC/USDC",
      eventType: "price_below" as const,
      threshold: "50000",
    };
    await Promise.all([
      repository.queuePriceRule(rule),
      repository.markAlertHandled("13".repeat(16)),
    ]);
    expect(repository.read()).toMatchObject({
      pendingPriceMutations: [rule],
      handledAlertIds: ["13".repeat(16)],
    });
    const beforeNoOps = repository.read();
    const writes = harness.writes();
    expect(await repository.queuePriceRule(rule)).toBe(beforeNoOps);
    expect(await repository.markAlertHandled("13".repeat(16))).toBe(
      beforeNoOps,
    );
    expect(harness.writes()).toBe(writes);
  });

  test("removes a replayed rule batch in one durable write and preserves no-op identity", async () => {
    const harness = createStorage();
    const repository = createNotificationLocalStateRepository(harness.storage);
    await repository.hydrate();
    await repository.queuePriceRule({
      ruleId: "14".repeat(16),
      scope: "price",
      network: "testnet",
      marketId: "perp:BTC",
      eventType: "price_above",
      threshold: "100000",
    });
    await repository.queuePriceRule({
      ruleId: "15".repeat(16),
      scope: "price",
      network: "testnet",
      marketId: "perp:ETH",
      eventType: "price_below",
      threshold: "1000",
    });
    const writesBeforeRemoval = harness.writes();

    const emptied = await repository.removePendingPriceRules([
      "14".repeat(16),
      "15".repeat(16),
    ]);
    expect(emptied.pendingPriceMutations).toEqual([]);
    expect(harness.writes()).toBe(writesBeforeRemoval + 1);
    expect(await repository.removePendingPriceRules(["14".repeat(16)])).toBe(
      emptied,
    );
    expect(harness.writes()).toBe(writesBeforeRemoval + 1);
  });

  test("fails closed to an error state for malformed or oversized storage", async () => {
    const repository = createNotificationLocalStateRepository(
      createStorage("{".repeat(70_000)).storage,
    );
    expect((await repository.hydrate()).status).toBe("error");
    expect(repository.read().pendingPriceMutations).toEqual([]);
  });
});
