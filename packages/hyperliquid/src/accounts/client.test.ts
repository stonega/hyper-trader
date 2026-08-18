import { describe, expect, test } from "bun:test";
import {
  ACCOUNT_RESPONSES,
  AGENT_ADDRESS,
  MASTER_ADDRESS,
  SUBACCOUNT_ADDRESS,
  VAULT_ADDRESS,
} from "./account.fixture";
import { createAccountDataClient } from "./client";
import type { AccountTarget } from "./types";

describe("account data client", () => {
  test("validates named API-wallet registrations for a master account", async () => {
    const bodies: Record<string, unknown>[] = [];
    const client = createAccountDataClient({
      network: "testnet",
      fetch: async (_input, init) => {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return Response.json([
          {
            name: "ht-123456789abcd",
            address: AGENT_ADDRESS.toUpperCase().replace("0X", "0x"),
            validUntil: 1_802_592_000_000,
          },
          {
            name: "No expiry",
            address: VAULT_ADDRESS,
            validUntil: null,
          },
        ]);
      },
    });

    await expect(
      client.getNamedApiWallets({ kind: "master", address: MASTER_ADDRESS }),
    ).resolves.toMatchObject({
      data: [
        {
          name: "ht-123456789abcd",
          address: AGENT_ADDRESS,
          validUntil: 1_802_592_000_000,
        },
        {
          name: "No expiry",
          address: VAULT_ADDRESS,
          validUntil: null,
        },
      ],
    });
    expect(bodies).toEqual([{ type: "extraAgents", user: MASTER_ADDRESS }]);
  });

  test("rejects malformed named API-wallet registrations", async () => {
    const client = createAccountDataClient({
      network: "testnet",
      fetch: async () =>
        Response.json([{ name: "", address: AGENT_ADDRESS, validUntil: -1 }]),
    });

    await expect(
      client.getNamedApiWallets({ kind: "master", address: MASTER_ADDRESS }),
    ).rejects.toThrow("extraAgents[0].name");
  });

  test("uses the target address and preserves source identity and decimals", async () => {
    const bodies: Record<string, unknown>[] = [];
    const client = createAccountDataClient({
      network: "testnet",
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as Record<
          string,
          unknown
        > & {
          type: keyof typeof ACCOUNT_RESPONSES;
        };
        bodies.push(body);
        return Response.json(ACCOUNT_RESPONSES[body.type]);
      },
    });
    const target: AccountTarget = {
      kind: "subaccount",
      address: SUBACCOUNT_ADDRESS,
      masterAddress: MASTER_ADDRESS,
    };

    const [perps, spot, orders, historical, fills, funding, status, portfolio] =
      await Promise.all([
        client.getClearinghouseState(target, "alpha"),
        client.getSpotClearinghouseState(target),
        client.getOpenOrders(target, "alpha"),
        client.getHistoricalOrders(target),
        client.getFills(target),
        client.getFunding(target, { startTime: 1_720_000_000_000 }),
        client.getOrderStatus(target, 99),
        client.getPortfolio(target),
      ]);

    expect(perps).toMatchObject({
      target,
      sourceDex: "alpha",
      data: { withdrawable: "123.4567890123456789", positions: [] },
    });
    expect(spot.data.balances[0]?.total).toBe("123.4567890123456789");
    expect(orders).toMatchObject({
      target,
      sourceDex: "alpha",
      data: [{ coin: "alpha:DUP", limitPrice: "1.0000000000000001" }],
    });
    expect(historical.data[0]?.status).toBe("filled");
    expect(fills.data[0]?.price).toBe("1.0000000000000001");
    expect(funding.data[0]?.usdc).toBe("-0.0000000000000001");
    expect(status.data.status).toBe("unknownOid");
    expect(portfolio.data[0]?.accountValueHistory[0]?.[1]).toBe(
      "123.4567890123456789",
    );
    expect(bodies.every(({ user }) => user === SUBACCOUNT_ADDRESS)).toBe(true);
    expect(JSON.stringify(bodies)).not.toContain(AGENT_ADDRESS);
  });

  test("handles an empty master account and uses the vault address", async () => {
    const bodies: Record<string, unknown>[] = [];
    const client = createAccountDataClient({
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as Record<
          string,
          unknown
        > & {
          type: keyof typeof ACCOUNT_RESPONSES;
        };
        bodies.push(body);
        return Response.json(ACCOUNT_RESPONSES[body.type]);
      },
    });
    const master = { kind: "master", address: MASTER_ADDRESS } as const;
    const vault = {
      kind: "vault",
      address: VAULT_ADDRESS,
      masterAddress: MASTER_ADDRESS,
    } as const;

    await expect(client.getSubaccounts(master)).resolves.toMatchObject({
      target: master,
      data: [],
    });
    await expect(client.getVaultDetails(vault)).resolves.toMatchObject({
      target: vault,
      data: { vaultAddress: VAULT_ADDRESS, name: "Test Vault" },
    });
    expect(bodies).toEqual([
      { type: "subAccounts", user: MASTER_ADDRESS },
      { type: "vaultDetails", vaultAddress: VAULT_ADDRESS },
    ]);
  });
});
