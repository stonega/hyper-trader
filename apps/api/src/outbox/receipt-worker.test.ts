import { describe, expect, test } from "bun:test";

import type { ExpoReceiptResult } from "../push/expo-push-client";
import type { RuntimeEgressFence } from "../worker-fence";
import {
  type NotificationReceiptStore,
  NotificationReceiptWorker,
} from "./receipt-worker";

const fence: RuntimeEgressFence = {
  leaseKey: "runtime:egress",
  ownerId: "receipt-test-owner",
  generation: 1,
};

class ReceiptStore implements NotificationReceiptStore {
  due = ["ticket-a"];
  attempts = 0;
  results = new Map<string, ExpoReceiptResult>();
  invalidToken = false;

  async recoverExpiredReceiptLeases() {}

  async claimDueReceipts() {
    const claimed = this.due;
    this.due = [];
    return claimed;
  }

  async completeReceipt(
    ticketId: string,
    _workerId: string,
    result: Exclude<ExpoReceiptResult, { kind: "pending" }>,
  ) {
    this.results.set(ticketId, result);
    if (
      result.kind === "failed" &&
      result.errorCode === "device_not_registered"
    ) {
      this.invalidToken = true;
    }
  }

  async deferReceipt(ticketId: string) {
    this.attempts += 1;
    if (this.attempts < 5) this.due.push(ticketId);
  }
}

describe("notification receipt worker", () => {
  test("retries missing receipts in bounded store-managed windows", async () => {
    const store = new ReceiptStore();
    let queries = 0;
    const worker = new NotificationReceiptWorker({
      workerId: "receipt-a",
      store,
      provider: {
        getReceipts: async (ids) => {
          queries += 1;
          return Object.fromEntries(
            ids.map((id) => [
              id,
              queries === 1 ? { kind: "pending" } : { kind: "delivered" },
            ]),
          );
        },
      },
    });
    expect(await worker.runOnce(fence)).toBe(1);
    expect(store.attempts).toBe(1);
    expect(await worker.runOnce(fence)).toBe(1);
    expect(store.results.get("ticket-a")).toEqual({ kind: "delivered" });
  });

  test("invalidates a token from DeviceNotRegistered without retaining provider detail", async () => {
    const store = new ReceiptStore();
    const worker = new NotificationReceiptWorker({
      workerId: "receipt-a",
      store,
      provider: {
        getReceipts: async () => ({
          "ticket-a": {
            kind: "failed",
            errorCode: "device_not_registered",
          },
        }),
      },
    });
    expect(await worker.runOnce(fence)).toBe(1);
    expect(store.invalidToken).toBe(true);
    expect(JSON.stringify(store.results)).not.toContain("raw");
  });

  test("does not loop inside one tick when the provider is exhausted", async () => {
    const store = new ReceiptStore();
    let calls = 0;
    const worker = new NotificationReceiptWorker({
      workerId: "receipt-a",
      store,
      provider: {
        getReceipts: async () => {
          calls += 1;
          throw new Error("provider unavailable");
        },
      },
    });
    expect(await worker.runOnce(fence)).toBe(1);
    expect(calls).toBe(1);
    expect(store.attempts).toBe(1);
  });

  test("emits bounded pending and failed receipt events", async () => {
    const store = new ReceiptStore();
    store.due = ["ticket-a", "ticket-b"];
    const events: string[] = [];
    const worker = new NotificationReceiptWorker({
      workerId: "receipt-metrics",
      store,
      provider: {
        getReceipts: async () => ({
          "ticket-a": { kind: "pending" },
          "ticket-b": {
            kind: "failed",
            errorCode: "provider_unavailable",
          },
        }),
      },
      onEvent: (event) => events.push(event),
    });
    expect(await worker.runOnce(fence)).toBe(2);
    expect(events.sort()).toEqual(["failed", "pending"]);
  });
});
