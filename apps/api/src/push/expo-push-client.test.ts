import { describe, expect, test } from "bun:test";

import {
  EXPO_PUSH_RECEIPTS_URL,
  EXPO_PUSH_SEND_URL,
  ExpoPushClient,
} from "./expo-push-client";

describe("Expo push boundary", () => {
  test("uses the fixed origin and sends only one minimal opaque payload", async () => {
    const requests: Request[] = [];
    const client = new ExpoPushClient({
      fetch: async (input, init) => {
        const request = new Request(input, init);
        requests.push(request);
        return Response.json({ data: { status: "ok", id: "ticket-1" } });
      },
    });
    expect(
      await client.send({
        pushToken: "ExponentPushToken[fixture-a]",
        alertId: "11".repeat(16),
        category: "risk",
        network: "testnet",
        routeHint: "portfolio",
        providerDeadlineAt: Date.now() + 10_000,
      }),
    ).toEqual({ kind: "accepted", ticketId: "ticket-1" });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(EXPO_PUSH_SEND_URL);
    expect(requests[0]?.redirect).toBe("error");
    const body = await requests[0]?.json();
    expect(body).toEqual({
      to: "ExponentPushToken[fixture-a]",
      title: "Trading alert available",
      body: "Open Hyper Trader to view current details.",
      data: {
        alertId: "11".repeat(16),
        category: "risk",
        network: "testnet",
        routeHint: "portfolio",
      },
    });
    expect(JSON.stringify(body)).not.toContain("account");
    expect(JSON.stringify(body)).not.toContain("price");
  });

  test("does not transport-retry and reduces provider errors to an allowlist", async () => {
    let calls = 0;
    const client = new ExpoPushClient({
      fetch: async () => {
        calls += 1;
        return Response.json(
          { errors: [{ code: "TOO_MANY_REQUESTS", message: "raw detail" }] },
          { status: 429 },
        );
      },
    });
    expect(
      await client.send({
        pushToken: "ExponentPushToken[fixture-b]",
        alertId: "22".repeat(16),
        category: "execution",
        network: "mainnet",
        routeHint: "trade",
        providerDeadlineAt: Date.now() + 10_000,
      }),
    ).toEqual({ kind: "rejected", errorCode: "provider_rate_limited" });
    expect(calls).toBe(1);
  });

  test("queries receipts in a bounded batch and recognizes invalid tokens", async () => {
    const client = new ExpoPushClient({
      fetch: async (input, init) => {
        const request = new Request(input, init);
        expect(request.url).toBe(EXPO_PUSH_RECEIPTS_URL);
        return Response.json({
          data: {
            "ticket-a": {
              status: "error",
              details: { error: "DeviceNotRegistered" },
              message: "raw provider message",
            },
          },
        });
      },
    });
    expect(await client.getReceipts(["ticket-a", "ticket-missing"])).toEqual({
      "ticket-a": { kind: "failed", errorCode: "device_not_registered" },
      "ticket-missing": { kind: "pending" },
    });
    await expect(
      client.getReceipts(
        Array.from({ length: 101 }, (_, index) => `t-${index}`),
      ),
    ).rejects.toThrow("batch");
  });

  test("inherits a near database deadline instead of starting a fresh timeout", async () => {
    let now = 10_000;
    let abort: (() => void) | undefined;
    let scheduledFor = 0;
    let observedSignal: AbortSignal | undefined;
    const client = new ExpoPushClient({
      now: () => now,
      scheduleAbort(callback, milliseconds) {
        scheduledFor = milliseconds;
        abort = callback;
        return () => {
          abort = undefined;
        };
      },
      fetch: async (_url, init) => {
        observedSignal = init?.signal as AbortSignal;
        return new Promise<Response>((_resolve, reject) => {
          observedSignal?.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
        });
      },
    });
    const request = client.send({
      pushToken: "ExponentPushToken[near-deadline]",
      alertId: "ab".repeat(16),
      category: "risk",
      network: "testnet",
      routeHint: "portfolio",
      providerDeadlineAt: now + 5,
    });
    expect(scheduledFor).toBe(5);
    now += 5;
    abort?.();
    await expect(request).rejects.toThrow("uncertain");
    expect(observedSignal?.aborted).toBe(true);
  });
});
