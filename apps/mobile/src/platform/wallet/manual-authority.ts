import {
  createAccountDataClient,
  type NamedApiWalletRegistration,
} from "@hyper-trader/hyperliquid";

import type { AgentRegistrationAuthority } from "../../features/accounts/setup-coordinator";

export const HYPERLIQUID_TESTNET_API_WALLET_URL =
  "https://app.hyperliquid-testnet.xyz/API";

type AuthorityFetch = (
  input: Parameters<typeof globalThis.fetch>[0],
  init?: Parameters<typeof globalThis.fetch>[1],
) => Promise<Response>;

function responseTime(response: Response): number {
  const value = response.headers.get("date");
  const parsed = value === null ? Number.NaN : Date.parse(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error("Hyperliquid did not provide a trustworthy server time.");
  }
  return parsed;
}

export function createManualAgentRegistrationAuthority(options: {
  readonly fetch: AuthorityFetch;
}): AgentRegistrationAuthority {
  const readNamedAgents = async (
    masterAccount: string,
  ): Promise<{
    readonly authoritativeTime: number;
    readonly agents: readonly NamedApiWalletRegistration[];
  }> => {
    let authoritativeTime: number | null = null;
    const client = createAccountDataClient({
      network: "testnet",
      fetch: (async (input, init) => {
        const response = await options.fetch(input, init);
        authoritativeTime = responseTime(response);
        return response;
      }) as typeof globalThis.fetch,
      timeoutMs: 10_000,
    });
    const result = await client.getNamedApiWallets({
      kind: "master",
      address: masterAccount,
    });
    if (authoritativeTime === null) {
      throw new Error("Hyperliquid registration time was unavailable.");
    }
    return { authoritativeTime, agents: result.data };
  };

  return {
    async inspect(input) {
      const targetAuthorized = input.masterAccount === input.targetAccount;
      const result = await readNamedAgents(input.masterAccount);
      return {
        authoritativeTime: result.authoritativeTime,
        targetAuthorized,
        targetKind: "master",
      };
    },
    async verify(input) {
      const targetAuthorized = input.masterAccount === input.targetAccount;
      const result = await readNamedAgents(input.masterAccount);
      const registration = result.agents.find(
        (agent) => agent.address === input.agentAddress,
      );
      return {
        authoritativeTime: result.authoritativeTime,
        targetAuthorized,
        registration:
          registration === undefined
            ? null
            : {
                agentAddress: registration.address,
                registrationName: registration.name,
                validUntil: registration.validUntil,
              },
      };
    },
  };
}
