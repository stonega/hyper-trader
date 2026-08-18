import { describe, expect, test } from "bun:test";

import {
  accountAuthorizationKey,
  accountCacheKey,
  accountPreferenceKey,
  accountScopeKey,
  normalizeSavedAccount,
  readOnlyTradingContextForSavedAccount,
  type SavedAccount,
} from "./account-scope";

const MASTER = "0x1111111111111111111111111111111111111111";
const SUBACCOUNT = "0x2222222222222222222222222222222222222222";
const VAULT = "0x3333333333333333333333333333333333333333";
const AGENT = "0x4444444444444444444444444444444444444444";

function account(overrides: Partial<SavedAccount> = {}): SavedAccount {
  return {
    id: "account-1",
    label: "Trading account",
    masterAccount: MASTER,
    target: { kind: "master", address: MASTER },
    network: "testnet",
    authorization: {
      agentAddress: AGENT,
      generation: 1,
      registrationName: "ht-123456789abcd",
      registrationState: "active",
      requestedExpiryMs: 1_800_000_000_000,
      effectiveExpiryMs: 1_799_000_000_000,
      lastVerifiedAtMs: 1_700_000_000_000,
      credentialState: "protected",
    },
    reconciliation: { pendingCount: 0, allDurable: true },
    ...overrides,
  };
}

describe("account identity scopes", () => {
  test("normalizes the discriminated target and rejects cross-master targets", () => {
    expect(normalizeSavedAccount(account()).target).toEqual({
      kind: "master",
      address: MASTER,
    });
    expect(
      normalizeSavedAccount(
        account({
          target: {
            kind: "subaccount",
            address: SUBACCOUNT.toUpperCase(),
            masterAddress: MASTER.toUpperCase(),
          },
        }),
      ).target,
    ).toEqual({
      kind: "subaccount",
      address: SUBACCOUNT,
      masterAddress: MASTER,
    });
    expect(() =>
      normalizeSavedAccount(
        account({
          target: {
            kind: "vault",
            address: VAULT,
            masterAddress: SUBACCOUNT,
          },
        }),
      ),
    ).toThrow("master");
  });

  test("isolates account, preference, cache, and signer authorization keys", () => {
    const master = normalizeSavedAccount(account());
    const subaccount = normalizeSavedAccount(
      account({
        id: "account-2",
        target: {
          kind: "subaccount",
          address: SUBACCOUNT,
          masterAddress: MASTER,
        },
      }),
    );
    const vault = normalizeSavedAccount(
      account({
        id: "account-3",
        target: { kind: "vault", address: VAULT, masterAddress: MASTER },
      }),
    );
    const mainnet = normalizeSavedAccount({ ...master, network: "mainnet" });

    const scopeKeys = [master, subaccount, vault, mainnet].map(accountScopeKey);
    expect(new Set(scopeKeys).size).toBe(4);
    expect(
      new Set([master, subaccount, vault, mainnet].map(accountPreferenceKey))
        .size,
    ).toBe(4);
    expect(
      new Set([master, subaccount, vault, mainnet].map(accountCacheKey)).size,
    ).toBe(4);

    const nextGeneration = normalizeSavedAccount({
      ...master,
      authorization: { ...master.authorization, generation: 2 },
    });
    expect(accountAuthorizationKey(master)).not.toBe(
      accountAuthorizationKey(nextGeneration),
    );
    expect(accountPreferenceKey(master)).toBe(
      accountPreferenceKey(nextGeneration),
    );
  });

  test("allows the same address on another network without merging authority", () => {
    const testnet = normalizeSavedAccount(account());
    const mainnet = normalizeSavedAccount({ ...testnet, network: "mainnet" });

    expect(accountScopeKey(testnet)).not.toBe(accountScopeKey(mainnet));
    expect(accountAuthorizationKey(testnet)).not.toBe(
      accountAuthorizationKey(mainnet),
    );
    expect(mainnet.authorization.registrationState).toBe("inactive");
    expect(mainnet.authorization.credentialState).toBe("absent");
  });

  test("saved authorization summaries are display-only and always navigate read-only", () => {
    const active = normalizeSavedAccount(account());
    expect(readOnlyTradingContextForSavedAccount(active)).toEqual({
      network: "testnet",
      masterAccount: MASTER,
      targetAccount: MASTER,
      signer: null,
    });
    expect(
      readOnlyTradingContextForSavedAccount(
        normalizeSavedAccount({
          ...active,
          authorization: {
            ...active.authorization,
            credentialState: "missing",
          },
        }),
      ).signer,
    ).toBeNull();
    expect(
      readOnlyTradingContextForSavedAccount(
        normalizeSavedAccount({ ...active, network: "mainnet" }),
      ).signer,
    ).toBeNull();
  });

  test("fails closed for unrecognized persisted discriminants", () => {
    expect(() =>
      normalizeSavedAccount({ ...account(), network: "preview" as "testnet" }),
    ).toThrow("network");
    expect(() =>
      normalizeSavedAccount({
        ...account(),
        target: { kind: "delegate", address: MASTER } as never,
      }),
    ).toThrow("target kind");
    expect(() =>
      normalizeSavedAccount({
        ...account(),
        authorization: {
          ...account().authorization,
          registrationState: "unknown" as "active",
        },
      }),
    ).toThrow("registration state");
  });
});
