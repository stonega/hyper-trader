import { describe, expect, test } from "bun:test";

import {
  ACCOUNT_DIRECTORY_STORAGE_KEY,
  type AccountDirectoryStorage,
  createAccountDirectory,
  resolveDirectoryAccount,
} from "./account-directory";
import { accountMutationGate } from "./account-lifecycle";
import {
  readOnlyTradingContextForSavedAccount,
  type SavedAccount,
} from "./account-scope";

const MASTER = "0x1111111111111111111111111111111111111111";
const TARGET = "0x2222222222222222222222222222222222222222";
const AGENT = "0x3333333333333333333333333333333333333333";

function account(id = "account-1"): SavedAccount {
  return {
    id,
    label: `Account ${id}`,
    network: "testnet",
    masterAccount: MASTER,
    target: {
      kind: "subaccount",
      address: TARGET,
      masterAddress: MASTER,
    },
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
  };
}

function memoryStorage(): AccountDirectoryStorage & {
  readonly values: Map<string, string>;
  readonly writes: string[];
} {
  const values = new Map<string, string>();
  const writes: string[] = [];
  return {
    values,
    writes,
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => {
      writes.push(key);
      values.set(key, value);
    },
  };
}

describe("saved account directory", () => {
  test("publishes one persisted account list to every subscriber", async () => {
    const storage = memoryStorage();
    const directory = createAccountDirectory(storage);
    const first: number[] = [];
    const second: number[] = [];
    directory.subscribe((snapshot) => first.push(snapshot.accounts.length));
    directory.subscribe((snapshot) => second.push(snapshot.accounts.length));

    await directory.hydrate();
    await directory.save(account());

    expect(first.at(-1)).toBe(1);
    expect(second.at(-1)).toBe(1);
    expect(storage.values.get(ACCOUNT_DIRECTORY_STORAGE_KEY)).not.toContain(
      "privateKey",
    );
  });

  test("persists active selection and restores only a known exact account", async () => {
    const storage = memoryStorage();
    const first = createAccountDirectory(storage);
    await first.hydrate();
    await first.save(account());
    await first.select("account-1");

    const restored = createAccountDirectory(storage);
    await restored.hydrate();
    expect(restored.read()).toMatchObject({
      status: "ready",
      activeAccountId: "account-1",
    });
    await expect(restored.select("missing")).rejects.toThrow("not saved");
  });

  test("a no-op selection preserves snapshot identity without storage or publication", async () => {
    const storage = memoryStorage();
    const directory = createAccountDirectory(storage);
    await directory.hydrate();
    await directory.save(account());
    await directory.select("account-1");
    const before = directory.read();
    const writesBefore = storage.writes.length;
    let publications = 0;
    directory.subscribe(() => {
      publications += 1;
    });

    const after = await directory.select("account-1");

    expect(Object.isFrozen(before.accounts)).toBe(true);
    expect(after).toBe(before);
    expect(after.accounts).toBe(before.accounts);
    expect(storage.writes).toHaveLength(writesBefore);
    expect(publications).toBe(0);
  });

  test("isolates the same master and target when the network differs", async () => {
    const storage = memoryStorage();
    const directory = createAccountDirectory(storage);
    await directory.hydrate();
    await directory.save(account("testnet-account"));
    await directory.save({
      ...account("mainnet-account"),
      network: "mainnet",
    });

    expect(directory.read().accounts).toHaveLength(2);
    expect(
      directory
        .read()
        .accounts.map((entry) => entry.network)
        .sort(),
    ).toEqual(["mainnet", "testnet"]);
  });

  test("preserves the explicit target kind when core address context is ambiguous", () => {
    const subaccount = account("subaccount");
    const vault: SavedAccount = {
      ...account("vault"),
      target: { kind: "vault", address: TARGET, masterAddress: MASTER },
    };
    const context = {
      network: "testnet" as const,
      masterAccount: MASTER,
      targetAccount: TARGET,
    };

    expect(
      resolveDirectoryAccount([subaccount, vault], "vault", context)?.target
        .kind,
    ).toBe("vault");
    expect(
      resolveDirectoryAccount([subaccount, vault], null, context),
    ).toBeNull();
    expect(
      resolveDirectoryAccount([subaccount], "stale-selection", context),
    ).toBeNull();
  });

  test("fails closed on malformed persistence instead of publishing partial accounts", async () => {
    const storage = memoryStorage();
    storage.values.set(
      ACCOUNT_DIRECTORY_STORAGE_KEY,
      JSON.stringify({ version: 1, activeAccountId: null, accounts: [{}] }),
    );
    const directory = createAccountDirectory(storage);

    await directory.hydrate();

    expect(directory.read()).toMatchObject({
      status: "error",
      accounts: [],
      activeAccountId: null,
    });
  });

  test("strictly rejects malformed nested persisted account fields", async () => {
    const valid = account("strict");
    const { authorization: _authorization, ...missingAuthorization } = valid;
    const candidates: unknown[] = [
      { ...valid, id: 42 },
      { ...valid, target: { kind: "delegate", address: TARGET } },
      {
        ...valid,
        authorization: { ...valid.authorization, registrationName: 12 },
      },
      {
        ...valid,
        reconciliation: { pendingCount: 0, allDurable: "true" },
      },
      missingAuthorization,
      { ...valid, unexpectedAuthority: true },
    ];

    for (const candidate of candidates) {
      const storage = memoryStorage();
      storage.values.set(
        ACCOUNT_DIRECTORY_STORAGE_KEY,
        JSON.stringify({
          version: 1,
          activeAccountId: null,
          accounts: [candidate],
        }),
      );
      const directory = createAccountDirectory(storage);
      expect((await directory.hydrate()).status).toBe("error");
      expect(directory.read().accounts).toEqual([]);
    }
  });

  test("can retry a transient storage read without retaining partial state", async () => {
    let unavailable = true;
    const directory = createAccountDirectory({
      getItem: async () => {
        if (unavailable) throw new Error("storage unavailable");
        return null;
      },
      setItem: async () => undefined,
    });

    expect((await directory.hydrate()).status).toBe("error");
    unavailable = false;
    expect(await directory.hydrate()).toMatchObject({
      status: "ready",
      accounts: [],
      activeAccountId: null,
    });
  });

  test("persisted authorization metadata can never restore signer authority", async () => {
    const storage = memoryStorage();
    storage.values.set(
      ACCOUNT_DIRECTORY_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        activeAccountId: "tampered",
        accounts: [
          {
            ...account("tampered"),
            authorization: {
              ...account("tampered").authorization,
              registrationState: "active",
              credentialState: "protected",
              effectiveExpiryMs: 9_000_000_000_000,
            },
          },
        ],
      }),
    );
    const directory = createAccountDirectory(storage);

    await directory.hydrate();
    const restored = directory.read().accounts[0];

    expect(restored).toBeDefined();
    expect(
      readOnlyTradingContextForSavedAccount(restored as SavedAccount).signer,
    ).toBeNull();
    expect(
      accountMutationGate({
        operation: "rotate",
        actionPhase: "review",
        actionStatus: { known: false },
        riskAcknowledged: false,
      }),
    ).toEqual({ allowed: false, reason: "action_status_unavailable" });
    expect(restored?.reconciliation).toEqual({
      pendingCount: 0,
      allDurable: true,
    });
  });
});
