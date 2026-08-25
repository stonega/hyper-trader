import { describe, expect, test } from "bun:test";
import { HYPERLIQUID_NETWORK_ORIGINS } from "@hyper-trader/hyperliquid";

import {
  createManualAgentRegistrationAuthority,
  HYPERLIQUID_API_WALLET_URLS,
} from "./manual-authority";

const MASTER = "0x1111111111111111111111111111111111111111";
const AGENT = "0x2222222222222222222222222222222222222222";
const SERVER_TIME = 1_800_000_000_000;

function response(payload: unknown, date = SERVER_TIME): Response {
  return Response.json(payload, {
    headers: { date: new Date(date).toUTCString() },
  });
}

describe("manual Hyperliquid agent authority", () => {
  test("inspects and verifies one exact named testnet agent", async () => {
    const bodies: unknown[] = [];
    const authority = createManualAgentRegistrationAuthority({
      fetch: async (_input, init) => {
        bodies.push(JSON.parse(String(init?.body)) as unknown);
        return response([
          {
            name: "Different label",
            address: AGENT,
            validUntil: SERVER_TIME + 1_000_000,
          },
        ]);
      },
    });

    await expect(
      authority.inspect({
        network: "testnet",
        masterAccount: MASTER,
        targetAccount: MASTER,
      }),
    ).resolves.toMatchObject({
      authoritativeTime: SERVER_TIME,
      targetAuthorized: true,
    });
    await expect(
      authority.verify({
        network: "testnet",
        masterAccount: MASTER,
        targetAccount: MASTER,
        agentAddress: AGENT,
      }),
    ).resolves.toMatchObject({
      authoritativeTime: SERVER_TIME,
      targetAuthorized: true,
      registration: {
        agentAddress: AGENT,
        registrationName: "Different label",
      },
    });
    expect(bodies).toEqual([
      { type: "extraAgents", user: MASTER },
      { type: "extraAgents", user: MASTER },
    ]);
  });

  test("fails closed without an authoritative HTTP date", async () => {
    const authority = createManualAgentRegistrationAuthority({
      fetch: async () => Response.json([]),
    });

    await expect(
      authority.inspect({
        network: "testnet",
        masterAccount: MASTER,
        targetAccount: MASTER,
      }),
    ).rejects.toThrow("trustworthy server time");
  });

  test("uses the exact selected mainnet origins without weakening setup activation", async () => {
    const urls: string[] = [];
    const authority = createManualAgentRegistrationAuthority({
      fetch: async (input) => {
        urls.push(String(input));
        return response([]);
      },
    });

    await authority.inspect({
      network: "mainnet",
      masterAccount: MASTER,
      targetAccount: MASTER,
    });
    expect(urls).toEqual([HYPERLIQUID_NETWORK_ORIGINS.mainnet.http]);
    expect(HYPERLIQUID_API_WALLET_URLS).toEqual({
      mainnet: "https://app.hyperliquid.xyz/API",
      testnet: "https://app.hyperliquid-testnet.xyz/API",
    });
    expect(Object.isFrozen(HYPERLIQUID_API_WALLET_URLS)).toBe(true);
  });
});
