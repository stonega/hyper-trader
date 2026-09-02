import { describe, expect, test } from "bun:test";

import { createCloudflareWorker } from "./worker";

describe("Cloudflare Worker scheduling", () => {
  test("serves requests without starting catalog synchronization", async () => {
    let handled = 0;
    let synchronized = 0;
    const worker = createCloudflareWorker(() => ({
      async handler() {
        handled += 1;
        return new Response("ok");
      },
      async synchronize() {
        synchronized += 1;
      },
    }));

    const response = await worker.fetch(
      new Request("https://example.test"),
      {} as never,
    );

    expect(response.status).toBe(200);
    expect(handled).toBe(1);
    expect(synchronized).toBe(0);
  });

  test("starts catalog synchronization only from the scheduled handler", async () => {
    let synchronized = 0;
    const pending: Promise<unknown>[] = [];
    const worker = createCloudflareWorker(() => ({
      async handler() {
        return new Response("ok");
      },
      async synchronize() {
        synchronized += 1;
      },
    }));

    worker.scheduled(
      {} as never,
      {} as never,
      {
        waitUntil(promise) {
          pending.push(promise);
        },
      } as ExecutionContext,
    );
    await Promise.all(pending);

    expect(synchronized).toBe(1);
  });
});
