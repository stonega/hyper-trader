import { describe, expect, test } from "bun:test";

import {
  createNotificationServiceClient,
  NotificationServiceError,
} from "./service-client";

const installationId = "11".repeat(16);
const credential = "22".repeat(32);

describe("mobile notification service client", () => {
  test("uses one fixed origin, bearer authority, no redirects, and strict responses", async () => {
    const seen: Request[] = [];
    const client = createNotificationServiceClient({
      origin: "https://notify.example.com",
      fetch: async (request) => {
        seen.push(request);
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
});
