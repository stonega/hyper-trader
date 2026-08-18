import type { TradingContextCore } from "../../core/context/supervisor";
import type { AsyncKeyValueStorage } from "../../core/storage/public-cache";
import {
  accountScopeKey,
  normalizeSavedAccount,
  type SavedAccount,
} from "./account-scope";

export const ACCOUNT_DIRECTORY_STORAGE_KEY = "@hyper-trader/saved-accounts/v1";

export type AccountDirectoryStorage = Pick<
  AsyncKeyValueStorage,
  "getItem" | "setItem"
>;

export interface AccountDirectorySnapshot {
  readonly status: "loading" | "ready" | "error";
  readonly accounts: readonly SavedAccount[];
  readonly activeAccountId: string | null;
  readonly message: string | null;
}

export interface AccountDirectory {
  read(): AccountDirectorySnapshot;
  subscribe(listener: (snapshot: AccountDirectorySnapshot) => void): () => void;
  hydrate(): Promise<AccountDirectorySnapshot>;
  save(account: SavedAccount): Promise<AccountDirectorySnapshot>;
  select(accountId: string | null): Promise<AccountDirectorySnapshot>;
  remove(accountId: string): Promise<AccountDirectorySnapshot>;
}

export function resolveDirectoryAccount(
  accounts: readonly SavedAccount[],
  activeAccountId: string | null,
  context: TradingContextCore,
): SavedAccount | null {
  let match: SavedAccount | null = null;
  for (const account of accounts) {
    if (
      account.network === context.network &&
      account.masterAccount === context.masterAccount &&
      account.target.address === context.targetAccount
    ) {
      if (activeAccountId !== null) {
        if (account.id === activeAccountId) return account;
        continue;
      }
      if (match !== null) return null;
      match = account;
    }
  }
  return activeAccountId === null ? match : null;
}

interface PersistedAccountDirectory {
  readonly version: 1;
  readonly accounts: readonly SavedAccount[];
  readonly activeAccountId: string | null;
}

const MAX_ACCOUNTS = 32;
const MAX_DIRECTORY_BYTES = 64 * 1024;

function strictDirectoryObject(value: unknown): Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new Error("The saved account directory is malformed.");
  }
  const input = value as Record<string, unknown>;
  const allowed = ["version", "accounts", "activeAccountId"];
  const keys = Object.keys(input);
  if (
    keys.length !== allowed.length ||
    keys.some((key) => !allowed.includes(key))
  ) {
    throw new Error("The saved account directory is malformed.");
  }
  return input;
}

function freezeSnapshot(
  snapshot: AccountDirectorySnapshot,
): AccountDirectorySnapshot {
  return Object.freeze({
    ...snapshot,
    accounts: Object.freeze([...snapshot.accounts]),
  });
}

function parseDirectory(value: string | null): PersistedAccountDirectory {
  if (value === null) {
    return { version: 1, accounts: [], activeAccountId: null };
  }
  if (value.length > MAX_DIRECTORY_BYTES) {
    throw new Error("The saved account directory exceeds its size limit.");
  }
  const parsed = strictDirectoryObject(JSON.parse(value) as unknown);
  if (parsed.version !== 1 || !Array.isArray(parsed.accounts)) {
    throw new Error("The saved account directory is malformed.");
  }
  if (parsed.accounts.length > MAX_ACCOUNTS) {
    throw new Error("The saved account directory exceeds its account limit.");
  }
  const accounts = parsed.accounts.map(normalizeSavedAccount);
  const ids = new Set<string>();
  const scopes = new Set<string>();
  for (const account of accounts) {
    const scope = accountScopeKey(account);
    if (ids.has(account.id) || scopes.has(scope)) {
      throw new Error(
        "The saved account directory contains a duplicate scope.",
      );
    }
    ids.add(account.id);
    scopes.add(scope);
  }
  const activeAccountId = parsed.activeAccountId;
  if (
    activeAccountId !== null &&
    (typeof activeAccountId !== "string" || !ids.has(activeAccountId))
  ) {
    throw new Error("The active saved account no longer exists.");
  }
  return { version: 1, accounts, activeAccountId };
}

function persistedJson(document: PersistedAccountDirectory): string {
  const value = JSON.stringify(document);
  if (value.length > MAX_DIRECTORY_BYTES) {
    throw new Error("The saved account directory exceeds its size limit.");
  }
  return value;
}

export function createAccountDirectory(
  storage: AccountDirectoryStorage,
): AccountDirectory {
  let snapshot = freezeSnapshot({
    status: "loading",
    accounts: [],
    activeAccountId: null,
    message: null,
  });
  let hydrated = false;
  let mutation = Promise.resolve();
  const listeners = new Set<(value: AccountDirectorySnapshot) => void>();

  const publish = (next: AccountDirectorySnapshot) => {
    snapshot = freezeSnapshot(next);
    for (const listener of listeners) listener(snapshot);
    return snapshot;
  };
  const requireHydrated = () => {
    if (!hydrated || snapshot.status !== "ready") {
      throw new Error("The saved account directory is not ready.");
    }
  };
  const commit = async (
    accounts: readonly SavedAccount[],
    activeAccountId: string | null,
  ) => {
    const document: PersistedAccountDirectory = {
      version: 1,
      accounts,
      activeAccountId,
    };
    await storage.setItem(
      ACCOUNT_DIRECTORY_STORAGE_KEY,
      persistedJson(document),
    );
    return publish({
      status: "ready",
      accounts,
      activeAccountId,
      message: null,
    });
  };
  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = mutation.then(operation, operation);
    mutation = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  return {
    read: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    hydrate: () =>
      serialize(async () => {
        if (hydrated) return snapshot;
        try {
          const document = parseDirectory(
            await storage.getItem(ACCOUNT_DIRECTORY_STORAGE_KEY),
          );
          hydrated = true;
          return publish({
            status: "ready",
            accounts: document.accounts,
            activeAccountId: document.activeAccountId,
            message: null,
          });
        } catch {
          hydrated = false;
          return publish({
            status: "error",
            accounts: [],
            activeAccountId: null,
            message:
              "Saved accounts could not be validated. No account context was changed.",
          });
        }
      }),
    save: (account) =>
      serialize(async () => {
        requireHydrated();
        const normalized = normalizeSavedAccount(account);
        const scope = accountScopeKey(normalized);
        const byId = snapshot.accounts.find(
          (candidate) => candidate.id === normalized.id,
        );
        if (byId && accountScopeKey(byId) !== scope) {
          throw new Error("A saved account identity cannot be rebound.");
        }
        const duplicate = snapshot.accounts.find(
          (candidate) =>
            candidate.id !== normalized.id &&
            accountScopeKey(candidate) === scope,
        );
        if (duplicate) {
          throw new Error("This exact account, target, and network is saved.");
        }
        const accounts = byId
          ? snapshot.accounts.map((candidate) =>
              candidate.id === normalized.id ? normalized : candidate,
            )
          : [...snapshot.accounts, normalized];
        if (accounts.length > MAX_ACCOUNTS) {
          throw new Error("The saved account limit has been reached.");
        }
        return commit(accounts, snapshot.activeAccountId);
      }),
    select: (accountId) =>
      serialize(async () => {
        requireHydrated();
        if (accountId === snapshot.activeAccountId) return snapshot;
        if (
          accountId !== null &&
          !snapshot.accounts.some((candidate) => candidate.id === accountId)
        ) {
          throw new Error("The selected account is not saved.");
        }
        return commit(snapshot.accounts, accountId);
      }),
    remove: (accountId) =>
      serialize(async () => {
        requireHydrated();
        const accounts = snapshot.accounts.filter(
          (candidate) => candidate.id !== accountId,
        );
        if (accounts.length === snapshot.accounts.length) return snapshot;
        return commit(
          accounts,
          snapshot.activeAccountId === accountId
            ? null
            : snapshot.activeAccountId,
        );
      }),
  };
}
