import { describe, expect, test } from "bun:test";
import { HYPERLIQUID_NETWORK_ORIGINS } from "../network";
import { MAINNET_TRADING_RELEASE_STAGE } from "../signing/boundary";
import {
  classifyExchangeResponse,
  createExchangeClient,
} from "./exchange-client";

describe("exchange response boundary", () => {
  test("classifies documented order and cancel responses without guessing", () => {
    expect(
      classifyExchangeResponse({
        status: "ok",
        response: {
          type: "order",
          data: { statuses: [{ resting: { oid: 42 } }] },
        },
      }),
    ).toEqual({ kind: "accepted", providerOrderIds: [42] });
    expect(
      classifyExchangeResponse({
        status: "ok",
        response: {
          type: "cancel",
          data: { statuses: ["success"] },
        },
      }),
    ).toEqual({ kind: "accepted", providerOrderIds: [] });
    expect(
      classifyExchangeResponse({
        status: "ok",
        response: {
          type: "order",
          data: {
            statuses: [{ error: "Order must have minimum value of $10." }],
          },
        },
      }),
    ).toEqual({ kind: "rejected", reason: "minimum_notional" });
    expect(classifyExchangeResponse({ status: "wat" })).toEqual({
      kind: "unresolved",
      reason: "malformed_response",
    });
  });

  test("applies the compile-owned mainnet stage before transport", async () => {
    let writes = 0;
    const client = createExchangeClient({
      network: "mainnet",
      fetch: (async () => {
        writes += 1;
        return new Response(
          JSON.stringify({ status: "ok", response: { type: "default" } }),
          { headers: { "Content-Type": "application/json" } },
        );
      }) as typeof fetch,
    });
    const submission = client.submit({
      action: {
        type: "updateLeverage",
        asset: 0,
        isCross: true,
        leverage: 2,
      },
      nonce: 1_000,
      expiresAfter: 2_000,
      signature: {
        r: `0x${"11".repeat(32)}`,
        s: `0x${"22".repeat(32)}`,
        v: 27,
      },
    });
    if (MAINNET_TRADING_RELEASE_STAGE === "preactivation") {
      await expect(submission).rejects.toThrow("mainnet");
      expect(writes).toBe(0);
    } else {
      await expect(submission).resolves.toEqual({
        kind: "accepted",
        providerOrderIds: [],
      });
      expect(writes).toBe(1);
    }
  });

  test("performs exactly one fixed-origin POST with redirects and retries disabled", async () => {
    const calls: { readonly url: string; readonly init: RequestInit }[] = [];
    const client = createExchangeClient({
      network: "testnet",
      fetch: (async (input: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(input), init: init ?? {} });
        return new Response(
          JSON.stringify({ status: "ok", response: { type: "default" } }),
          { headers: { "Content-Type": "application/json" } },
        );
      }) as typeof fetch,
    });
    const result = await client.submit({
      action: {
        type: "updateLeverage",
        asset: 0,
        isCross: true,
        leverage: 2,
      },
      nonce: 1_000,
      expiresAfter: 2_000,
      signature: {
        r: `0x${"11".repeat(32)}`,
        s: `0x${"22".repeat(32)}`,
        v: 27,
      },
    });
    expect(result).toEqual({ kind: "accepted", providerOrderIds: [] });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(HYPERLIQUID_NETWORK_ORIGINS.testnet.exchange);
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.init.redirect).toBe("error");
  });

  test.each([
    { signature: { r: "0x1", s: `0x${"22".repeat(32)}`, v: 27 } },
    { expiresAfter: 20_001 },
    {
      action: {
        type: "updateLeverage",
        asset: 0,
        isCross: true,
        leverage: 101,
      },
    },
    { vaultAddress: "0xnot-an-address" },
  ])(
    "rejects malformed signed request fields before fetch",
    async (mutation) => {
      let writes = 0;
      const client = createExchangeClient({
        network: "testnet",
        fetch: (async () => {
          writes += 1;
          return new Response("{}");
        }) as typeof fetch,
      });
      const request = {
        action: {
          type: "updateLeverage",
          asset: 0,
          isCross: true,
          leverage: 2,
        },
        nonce: 1_000,
        expiresAfter: 2_000,
        signature: {
          r: `0x${"11".repeat(32)}`,
          s: `0x${"22".repeat(32)}`,
          v: 27,
        },
        ...mutation,
      };
      await expect(client.submit(request as never)).rejects.toThrow();
      expect(writes).toBe(0);
    },
  );

  test("keeps an error-looking non-2xx response unresolved", async () => {
    const client = createExchangeClient({
      network: "testnet",
      fetch: (async () =>
        new Response(JSON.stringify({ status: "err", response: "bad order" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        })) as typeof fetch,
    });
    expect(
      await client.submit({
        action: {
          type: "updateLeverage",
          asset: 0,
          isCross: true,
          leverage: 2,
        },
        nonce: 1_000,
        expiresAfter: 2_000,
        signature: {
          r: `0x${"11".repeat(32)}`,
          s: `0x${"22".repeat(32)}`,
          v: 27,
        },
      }),
    ).toEqual({ kind: "unresolved", reason: "transport_uncertain" });
  });

  test("bounds response bytes and cancel status work", async () => {
    const oversized = createExchangeClient({
      network: "testnet",
      fetch: (async () =>
        new Response(`{"padding":"${"x".repeat(70_000)}"}`)) as typeof fetch,
    });
    const request = {
      action: {
        type: "updateLeverage" as const,
        asset: 0,
        isCross: true,
        leverage: 2,
      },
      nonce: 1_000,
      expiresAfter: 2_000,
      signature: {
        r: `0x${"11".repeat(32)}` as `0x${string}`,
        s: `0x${"22".repeat(32)}` as `0x${string}`,
        v: 27 as const,
      },
    };
    expect(await oversized.submit(request)).toEqual({
      kind: "unresolved",
      reason: "malformed_response",
    });
    expect(
      classifyExchangeResponse({
        status: "ok",
        response: {
          type: "cancel",
          data: { statuses: Array.from({ length: 101 }, () => "success") },
        },
      }),
    ).toEqual({ kind: "unresolved", reason: "malformed_response" });
  });

  test("turns a stalled transport into reconciliation-owned uncertainty", async () => {
    const client = createExchangeClient({
      network: "testnet",
      timeoutMs: 5,
      fetch: ((_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        })) as typeof fetch,
    });
    expect(
      await client.submit({
        action: {
          type: "updateLeverage",
          asset: 0,
          isCross: true,
          leverage: 2,
        },
        nonce: 1_000,
        expiresAfter: 2_000,
        signature: {
          r: `0x${"11".repeat(32)}`,
          s: `0x${"22".repeat(32)}`,
          v: 27,
        },
      }),
    ).toEqual({ kind: "unresolved", reason: "transport_uncertain" });
  });
});
