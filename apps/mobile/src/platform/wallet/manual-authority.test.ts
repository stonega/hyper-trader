import { describe, expect, test } from "bun:test";

import { createManualAgentRegistrationAuthority } from "./manual-authority";

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
});
