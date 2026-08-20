import { describe, expect, test } from "bun:test";

import {
  HyperliquidApiError,
  HyperliquidValidationError,
  UnknownInfoRequestWeightError,
} from "../errors";
import { HYPERLIQUID_NETWORK_ORIGINS } from "../network";
import { createInfoHttpTransport, getInfoRequestBudget } from "./http";

type PromiseOutcome<T> =
  | { readonly status: "fulfilled"; readonly value: T }
  | { readonly status: "rejected"; readonly reason: unknown }
  | { readonly status: "pending" };

function observeWithin<T>(
  promise: Promise<T>,
  milliseconds = 100,
): Promise<PromiseOutcome<T>> {
  return new Promise((resolve) => {
    const timer = setTimeout(
      () => resolve({ status: "pending" }),
      milliseconds,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve({ status: "fulfilled", value });
      },
      (reason: unknown) => {
        clearTimeout(timer);
        resolve({ status: "rejected", reason });
      },
    );
  });
}

describe("info HTTP transport", () => {
  test("keeps compile-owned origins immutable at runtime", () => {
    expect(Object.isFrozen(HYPERLIQUID_NETWORK_ORIGINS)).toBe(true);
    expect(Object.isFrozen(HYPERLIQUID_NETWORK_ORIGINS.mainnet)).toBe(true);
    expect(Object.isFrozen(HYPERLIQUID_NETWORK_ORIGINS.testnet)).toBe(true);
  });

  test("isolates fixed endpoints and gives an already-aborted caller precedence", async () => {
    const requests: {
      url: string;
      redirect?: RequestRedirect;
      signal?: AbortSignal | null;
    }[] = [];
    const controller = new AbortController();
    const callerReason = new DOMException("Caller cancelled", "AbortError");
    controller.abort(callerReason);
    const transport = createInfoHttpTransport({
      network: "testnet",
      fetch: (input, init) => {
        requests.push({
          url: String(input),
          redirect: init?.redirect,
          signal: init?.signal,
        });
        return new Promise<Response>(() => {});
      },
    });

    const outcome = await observeWithin(
      transport.request({ type: "allMids" }, { signal: controller.signal }),
    );

    expect(outcome.status).toBe("rejected");
    if (outcome.status === "rejected") {
      expect(outcome.reason).toBe(callerReason);
    }
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      url: HYPERLIQUID_NETWORK_ORIGINS.testnet.http,
      redirect: "error",
    });
    expect(requests[0]?.signal?.aborted).toBe(true);
    expect(requests[0]?.signal?.reason).toBe(callerReason);
    expect(transport.endpoint).not.toBe(
      HYPERLIQUID_NETWORK_ORIGINS.mainnet.http,
    );
  });

  test("bounds a fetch that never settles with an internal deadline", async () => {
    let requestSignal: AbortSignal | null | undefined;
    const transport = createInfoHttpTransport({
      timeoutMs: 5,
      fetch: (_input, init) => {
        requestSignal = init?.signal;
        return new Promise<Response>(() => {});
      },
    });

    const outcome = await observeWithin(transport.request({ type: "allMids" }));

    expect(outcome.status).toBe("rejected");
    if (outcome.status === "rejected") {
      expect(outcome.reason).toMatchObject({ name: "TimeoutError" });
      expect(requestSignal?.reason).toBe(outcome.reason);
    }
    expect(requestSignal?.aborted).toBe(true);
  });

  test("clears the deadline and caller listener after a request settles", async () => {
    let requestSignal: AbortSignal | null | undefined;
    const controller = new AbortController();
    const transport = createInfoHttpTransport({
      timeoutMs: 5,
      fetch: async (_input, init) => {
        requestSignal = init?.signal;
        return new Response("[]");
      },
    });

    await expect(
      transport.request({ type: "allMids" }, { signal: controller.signal }),
    ).resolves.toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(requestSignal?.aborted).toBe(false);

    controller.abort();
    expect(requestSignal?.aborted).toBe(false);
  });

  test("validates the configured info request timeout", () => {
    for (const timeoutMs of [0, 60_001, 1.5, Number.NaN]) {
      expect(() => createInfoHttpTransport({ timeoutMs })).toThrow(
        HyperliquidValidationError,
      );
    }

    expect(createInfoHttpTransport({ timeoutMs: 60_000 }).network).toBe(
      "mainnet",
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
    expect(getInfoRequestBudget("activeAssetData")).toEqual({
      requestType: "activeAssetData",
      baseWeight: 20,
      totalWeight: 20,
    });
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
