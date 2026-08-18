import { describe, expect, test } from "bun:test";

import {
  createNotificationServiceClient,
  NotificationServiceError,
} from "./service-client";

const installationId = "11".repeat(16);
const credential = "22".repeat(32);

function snapshotResponse(): Response {
  return Response.json({
    installationId,
    state: "active",
    tokenState: "active",
    deliveryHealth: "healthy",
    pendingDeliveryCount: 0,
    unknownDeliveryCount: 0,
    accountLinks: [],
    rules: [],
  });
}

describe("mobile notification service client", () => {
  test("uses one fixed origin, bearer authority, no redirects, and strict responses", async () => {
    const seen: Request[] = [];
    const client = createNotificationServiceClient({
      origin: "https://notify.example.com",
      fetch: async (request) => {
        seen.push(request);
        return snapshotResponse();
      },
    });
    await expect(
      client.readSnapshot(installationId, credential),
    ).resolves.toMatchObject({
      installationId,
      deliveryHealth: "healthy",
    });
    expect(seen[0]?.url).toBe(
      `https://notify.example.com/v1/installations/${installationId}/snapshot`,
    );
    expect(seen[0]?.headers.get("authorization")).toBe(`Bearer ${credential}`);
    expect(seen[0]?.redirect).toBe("error");
  });

  test("rejects extra fields, oversized responses, and unapproved origins", async () => {
    expect(() =>
      createNotificationServiceClient({
        origin: "http://notify.example.com",
        fetch: globalThis.fetch,
      }),
    ).toThrow("exact HTTPS origin");
    expect(() =>
      createNotificationServiceClient({
        origin: "https://notify.example.com",
        fetch: globalThis.fetch,
        timeoutMs: 0,
      }),
    ).toThrow("timeout must be whole milliseconds");
    const extra = createNotificationServiceClient({
      origin: "https://notify.example.com",
      fetch: async () =>
        Response.json({ alertId: "33".repeat(16), secret: "no" }),
    });
    await expect(
      extra.readAlert("33".repeat(16), credential),
    ).rejects.toBeInstanceOf(NotificationServiceError);
    const oversized = createNotificationServiceClient({
      origin: "https://notify.example.com",
      fetch: async () => new Response("x".repeat(65_537)),
    });
    await expect(
      oversized.readSnapshot(installationId, credential),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });

  test("cancels an undeclared streaming response as soon as its byte budget is exceeded", async () => {
    let pulls = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array(40 * 1024).fill(120));
        if (pulls === 3) controller.close();
      },
      cancel() {
        cancelled = true;
      },
    });
    const client = createNotificationServiceClient({
      origin: "https://notify.example.com",
      fetch: async () => new Response(body),
    });

    await expect(
      client.readSnapshot(installationId, credential),
    ).rejects.toMatchObject({ code: "invalid_response" });
    expect(cancelled).toBe(true);
  });

  test("maps safe errors and never retries a mutation", async () => {
    let calls = 0;
    const client = createNotificationServiceClient({
      origin: "https://notify.example.com",
      fetch: async () => {
        calls += 1;
        return Response.json(
          { error: "rate_limited" },
          { status: 429, headers: { "retry-after": "3" } },
        );
      },
    });
    await expect(
      client.deletePriceRule(
        { installationId, ruleId: "44".repeat(16) },
        credential,
      ),
    ).rejects.toMatchObject({ code: "rate_limited", retryAfterMs: 3_000 });
    expect(calls).toBe(1);
  });

  test("times out a stalled mutation and releases a serialized retry", async () => {
    let calls = 0;
    const client = createNotificationServiceClient({
      origin: "https://notify.example.com",
      timeoutMs: 5,
      fetch: async () => {
        calls += 1;
        if (calls === 1) return new Promise<Response>(() => undefined);
        return snapshotResponse();
      },
    });
    let mutation = Promise.resolve();
    const serialize = <T>(work: () => Promise<T>): Promise<T> => {
      const next = mutation.then(work, work);
      mutation = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    };

    const stalled = serialize(() =>
      client.readSnapshot(installationId, credential),
    );
    const retry = serialize(() =>
      client.readSnapshot(installationId, credential),
    );

    await expect(stalled).rejects.toMatchObject({ code: "network" });
    await expect(retry).resolves.toMatchObject({ installationId });
    expect(calls).toBe(2);
  }, 250);

  test("composes caller cancellation and clears request resources after completion", async () => {
    const caller = new AbortController();
    const stalledSignals: AbortSignal[] = [];
    const stalled = createNotificationServiceClient({
      origin: "https://notify.example.com",
      timeoutMs: 100,
      fetch: async (request) => {
        stalledSignals.push(request.signal);
        return new Promise<Response>(() => undefined);
      },
    }).readSnapshot(installationId, credential, caller.signal);

    caller.abort();
    await expect(stalled).rejects.toMatchObject({ code: "network" });
    expect(stalledSignals[0]?.aborted).toBe(true);

    const completedCaller = new AbortController();
    const completedSignals: AbortSignal[] = [];
    const completed = createNotificationServiceClient({
      origin: "https://notify.example.com",
      timeoutMs: 20,
      fetch: async (request) => {
        completedSignals.push(request.signal);
        return snapshotResponse();
      },
    });
    await completed.readSnapshot(
      installationId,
      credential,
      completedCaller.signal,
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    completedCaller.abort();
    expect(completedSignals[0]?.aborted).toBe(false);
  }, 250);
});
