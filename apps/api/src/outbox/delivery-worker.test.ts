import { describe, expect, test } from "bun:test";

import type { ExpoSendResult } from "../push/expo-push-client";
import type { RuntimeEgressFence } from "../worker-fence";
import {
  DeliveryAuthorizationError,
  type DeliveryClaim,
  type NotificationDeliveryStore,
  NotificationDeliveryWorker,
  SimulatedProcessCrash,
} from "./delivery-worker";

const fence: RuntimeEgressFence = {
  leaseKey: "runtime:egress",
  ownerId: "delivery-test-owner",
  generation: 1,
};

const claim: DeliveryClaim = {
  permitId: "11".repeat(16),
  outboxId: "12".repeat(16),
  alertId: "13".repeat(16),
  category: "execution",
  network: "testnet",
  routeHint: "portfolio",
  providerDeadlineAt: Date.now() + 10_000,
};

class Store implements NotificationDeliveryStore {
  state:
    | "pending"
    | "leased"
    | "started"
    | "accepted"
    | "rejected"
    | "unknown" = "pending";
  authorize = true;
  tokenAvailable = true;
  errorCode?: string;
  recovered = 0;

  async recoverExpiredDispatches() {
    this.recovered += 1;
    if (this.state === "leased") this.state = "pending";
    if (this.state === "started") this.state = "unknown";
  }

  async claimNextDispatch() {
    if (this.state !== "pending") return null;
    this.state = "leased";
    return { ...claim, providerDeadlineAt: Date.now() + 10_000 };
  }

  async markProviderSubmissionStarted() {
    if (this.state !== "leased") throw new Error("not leased");
    this.state = "started";
  }

  async readDecryptedPushToken() {
    if (!this.tokenAvailable) throw new Error("key unavailable");
    return "ExponentPushToken[delivery-fixture]";
  }

  async authorizeProviderFetch() {
    if (!this.authorize) throw new DeliveryAuthorizationError();
    return { providerDeadlineAt: Date.now() + 10_000 };
  }

  async abandonUnstartedDispatch() {
    if (this.state === "leased") this.state = "pending";
  }

  async recordProviderAccepted() {
    this.state = "accepted";
  }

  async recordProviderRejected(_permitId: string, errorCode: string) {
    this.errorCode = errorCode;
    this.state = "rejected";
  }

  async recordProviderOutcomeUnknown() {
    this.state = "unknown";
  }
}

describe("notification delivery worker", () => {
  test("runs idle dispatch recovery at startup and a bounded cadence", async () => {
    let now = 0;
    const store = new Store();
    store.state = "accepted";
    const worker = new NotificationDeliveryWorker({
      workerId: "worker-idle-recovery",
      store,
      now: () => now,
      provider: {
        send: async () => ({ kind: "accepted", ticketId: "unused" }),
      },
    });

    expect(await worker.runOnce(fence)).toBe(false);
    now = 1_000;
    expect(await worker.runOnce(fence)).toBe(false);
    now = 9_999;
    expect(await worker.runOnce(fence)).toBe(false);
    expect(store.recovered).toBe(1);
    now = 10_000;
    expect(await worker.runOnce(fence)).toBe(false);
    expect(store.recovered).toBe(2);

    worker.requestRecovery();
    expect(await worker.runOnce(fence)).toBe(false);
    expect(store.recovered).toBe(3);
  });

  test("recovers a crash before the marker and retries bounded pre-provider work", async () => {
    const store = new Store();
    let calls = 0;
    const crashing = new NotificationDeliveryWorker({
      workerId: "worker-a",
      store,
      provider: {
        send: async () => {
          calls += 1;
          return { kind: "accepted", ticketId: "ticket-a" };
        },
      },
      hooks: {
        afterClaim: () => {
          throw new SimulatedProcessCrash();
        },
      },
    });
    await expect(crashing.runOnce(fence)).rejects.toBeInstanceOf(
      SimulatedProcessCrash,
    );
    expect(store.state).toBe("leased");
    expect(calls).toBe(0);

    const recovered = new NotificationDeliveryWorker({
      workerId: "worker-b",
      store,
      provider: {
        send: async () => {
          calls += 1;
          return { kind: "accepted", ticketId: "ticket-a" };
        },
      },
    });
    expect(await recovered.runOnce(fence)).toBe(true);
    expect(store.state).toBe("accepted");
    expect(calls).toBe(1);
  });

  test("never resubmits a marked attempt after a crash following provider acceptance", async () => {
    const store = new Store();
    let calls = 0;
    const crashing = new NotificationDeliveryWorker({
      workerId: "worker-a",
      store,
      provider: {
        send: async () => {
          calls += 1;
          return { kind: "accepted", ticketId: "ticket-a" };
        },
      },
      hooks: {
        afterProviderResponse: () => {
          throw new SimulatedProcessCrash();
        },
      },
    });
    await expect(crashing.runOnce(fence)).rejects.toBeInstanceOf(
      SimulatedProcessCrash,
    );
    expect(store.state).toBe("started");

    const recovered = new NotificationDeliveryWorker({
      workerId: "worker-b",
      store,
      provider: {
        send: async () => {
          calls += 1;
          return { kind: "accepted", ticketId: "ticket-b" };
        },
      },
    });
    expect(await recovered.runOnce(fence)).toBe(false);
    expect(store.state).toBe("unknown");
    expect(calls).toBe(1);
  });

  test("rechecks authorization immediately before fetch and blocks a late revoke", async () => {
    const store = new Store();
    store.authorize = false;
    let calls = 0;
    const worker = new NotificationDeliveryWorker({
      workerId: "worker-a",
      store,
      provider: {
        send: async () => {
          calls += 1;
          return { kind: "accepted", ticketId: "never" };
        },
      },
    });
    expect(await worker.runOnce(fence)).toBe(true);
    expect(calls).toBe(0);
    expect(store.state).toBe("rejected");
    expect(store.errorCode).toBe("authorization_revoked");
  });

  test("records an invalid token and makes only one transport attempt", async () => {
    const store = new Store();
    let calls = 0;
    const worker = new NotificationDeliveryWorker({
      workerId: "worker-a",
      store,
      provider: {
        send: async (): Promise<ExpoSendResult> => {
          calls += 1;
          return {
            kind: "rejected",
            errorCode: "device_not_registered",
          };
        },
      },
    });
    expect(await worker.runOnce(fence)).toBe(true);
    expect(calls).toBe(1);
    expect(store.state).toBe("rejected");
    expect(store.errorCode).toBe("device_not_registered");
  });

  test("classifies token decryption failure before fetch without claiming uncertainty", async () => {
    const store = new Store();
    store.tokenAvailable = false;
    let calls = 0;
    const worker = new NotificationDeliveryWorker({
      workerId: "worker-a",
      store,
      provider: {
        send: async () => {
          calls += 1;
          return { kind: "accepted", ticketId: "never" };
        },
      },
    });
    expect(await worker.runOnce(fence)).toBe(true);
    expect(calls).toBe(0);
    expect(store.state).toBe("rejected");
    expect(store.errorCode).toBe("token_unavailable");
  });

  test("emits only bounded delivery outcome events after durable transitions", async () => {
    const acceptedEvents: string[] = [];
    const accepted = new NotificationDeliveryWorker({
      workerId: "metrics-accepted",
      store: new Store(),
      provider: {
        send: async () => ({ kind: "accepted", ticketId: "ticket-metrics" }),
      },
      onEvent: (event) => acceptedEvents.push(event),
    });
    expect(await accepted.runOnce(fence)).toBe(true);
    expect(acceptedEvents).toEqual(["attempt", "accepted"]);

    const rejectedStore = new Store();
    rejectedStore.authorize = false;
    const rejectedEvents: string[] = [];
    const rejected = new NotificationDeliveryWorker({
      workerId: "metrics-rejected",
      store: rejectedStore,
      provider: {
        send: async () => ({ kind: "accepted", ticketId: "never" }),
      },
      onEvent: (event) => rejectedEvents.push(event),
    });
    expect(await rejected.runOnce(fence)).toBe(true);
    expect(rejectedEvents).toEqual(["attempt", "rejected"]);

    const unknownEvents: string[] = [];
    const unknown = new NotificationDeliveryWorker({
      workerId: "metrics-unknown",
      store: new Store(),
      provider: {
        send: async () => {
          throw new Error("response lost");
        },
      },
      onEvent: (event) => unknownEvents.push(event),
    });
    expect(await unknown.runOnce(fence)).toBe(true);
    expect(unknownEvents).toEqual(["attempt", "unknown"]);
  });
});
