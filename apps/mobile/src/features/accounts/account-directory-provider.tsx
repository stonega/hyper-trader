import AsyncStorage from "@react-native-async-storage/async-storage";
import type { JSX, PropsWithChildren } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";

import {
  type AccountDirectory,
  type AccountDirectorySnapshot,
  createAccountDirectory,
} from "./account-directory";
import type { SavedAccount } from "./account-scope";

export interface AccountDirectoryValue extends AccountDirectorySnapshot {
  reload(): Promise<boolean>;
  save(account: SavedAccount): Promise<boolean>;
  select(accountId: string | null): Promise<boolean>;
  remove(accountId: string): Promise<boolean>;
}

const AccountDirectoryContext = createContext<AccountDirectoryValue | null>(
  null,
);

export function AccountDirectoryProvider({
  children,
  directory: suppliedDirectory,
}: PropsWithChildren<{
  readonly directory?: AccountDirectory;
}>): JSX.Element {
  const defaultDirectory = useRef<AccountDirectory | null>(null);
  defaultDirectory.current ??= createAccountDirectory(AsyncStorage);
  const directory = suppliedDirectory ?? defaultDirectory.current;
  const snapshot = useSyncExternalStore(
    directory.subscribe,
    directory.read,
    directory.read,
  );

  useEffect(() => {
    void directory.hydrate();
  }, [directory]);

  const reload = useCallback(async () => {
    const next = await directory.hydrate();
    return next.status === "ready";
  }, [directory]);
  const save = useCallback(
    async (account: SavedAccount) => {
      try {
        await directory.save(account);
        return true;
      } catch {
        return false;
      }
    },
    [directory],
  );
  const select = useCallback(
    async (accountId: string | null) => {
      try {
        await directory.select(accountId);
        return true;
      } catch {
        return false;
      }
    },
    [directory],
  );
  const remove = useCallback(
    async (accountId: string) => {
      try {
        await directory.remove(accountId);
        return true;
      } catch {
        return false;
      }
    },
    [directory],
  );
  const value = useMemo<AccountDirectoryValue>(
    () => ({ ...snapshot, reload, save, select, remove }),
    [reload, remove, save, select, snapshot],
  );

  return (
    <AccountDirectoryContext.Provider value={value}>
      {children}
    </AccountDirectoryContext.Provider>
  );
}

export function useAccountDirectory(): AccountDirectoryValue {
  const value = useContext(AccountDirectoryContext);
  if (value === null) {
    throw new Error(
      "useAccountDirectory must be used inside AccountDirectoryProvider.",
    );
  }
  return value;
}
