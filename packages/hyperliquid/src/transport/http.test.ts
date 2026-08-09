import { describe, expect, test } from "bun:test";

import { HyperliquidApiError, UnknownInfoRequestWeightError } from "../errors";
import { HYPERLIQUID_NETWORK_ORIGINS } from "../network";
import { createInfoHttpTransport, getInfoRequestBudget } from "./http";

describe("info HTTP transport", () => {
  test("isolates fixed network endpoints and propagates abort signals", async () => {
    const requests: {
      url: string;
      redirect?: RequestRedirect;
      signal?: AbortSignal | null;
    }[] = [];
    const controller = new AbortController();
    controller.abort();
    const transport = createInfoHttpTransport({
      network: "testnet",
      fetch: async (input, init) => {
        requests.push({
          url: String(input),
          redirect: init?.redirect,
          signal: init?.signal,
        });
        throw new DOMException("Aborted", "AbortError");
      },
    });

    await expect(
      transport.request({ type: "allMids" }, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(requests).toEqual([
      {
        url: HYPERLIQUID_NETWORK_ORIGINS.testnet.http,
        redirect: "error",
        signal: controller.signal,
      },
    ]);
    expect(transport.endpoint).not.toBe(
      HYPERLIQUID_NETWORK_ORIGINS.mainnet.http,
    );
  });

  test("reports 429 retry metadata and the request weight", async () => {
    const transport = createInfoHttpTransport({
      fetch: async () =>
        new Response(null, {
          status: 429,
          headers: {
            "Retry-After": "3",
            "RateLimit-Limit": "1200",
            "RateLimit-Remaining": "0",
            "RateLimit-Reset": "1720000000",
          },
        }),
    });

    const error = await transport
      .request({ type: "allMids" })
      .catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(HyperliquidApiError);
    expect(error).toMatchObject({
      status: 429,
      requestBudget: { requestType: "allMids", totalWeight: 2 },
      rateLimit: {
        retryAfterMs: 3_000,
        limit: 1_200,
        remaining: 0,
        resetAtMs: 1_720_000_000_000,
      },
    });
  });

  test("fails closed for unknown weights and accounts for response size", () => {
    expect(getInfoRequestBudget("recentTrades", 40)).toEqual({
      requestType: "recentTrades",
      baseWeight: 20,
      responseItemDivisor: 20,
      responseItemCount: 40,
      totalWeight: 22,
    });
    expect(() => getInfoRequestBudget("futureUnknownEndpoint")).toThrow(
      UnknownInfoRequestWeightError,
    );
  });
});
