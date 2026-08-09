import AsyncStorage from "@react-native-async-storage/async-storage";
import type { JSX, PropsWithChildren } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useTradingContext } from "../../core/context/provider";
import { resolveDirectoryAccount } from "../accounts/account-directory";
import { useAccountDirectory } from "../accounts/account-directory-provider";
import type { SavedAccount } from "../accounts/account-scope";
import {
  DEFAULT_SCOPED_TRADING_PREFERENCES,
  parseScopedTradingPreferences,
  preferenceStorageKey,
  resetScopedTradingPreferences,
  type ScopedTradingPreferences,
  updateScopedTradingPreferences,
} from "./preferences";

export interface ScopedTradingPreferencesValue {
  readonly status: "loading" | "ready" | "unavailable" | "error";
  readonly scopeKey: string | null;
  readonly account: SavedAccount | null;
  readonly preferences: ScopedTradingPreferences;
  update(
    patch: Partial<
      Pick<
        ScopedTradingPreferences,
        "defaultOrderType" | "defaultSlippageBps" | "defaultChartRange"
      >
    >,
  ): Promise<boolean>;
  reset(): Promise<boolean>;
}

const ScopedTradingPreferencesContext =
  createContext<ScopedTradingPreferencesValue | null>(null);

export function ScopedTradingPreferencesProvider({
  children,
}: PropsWithChildren): JSX.Element {
  const directory = useAccountDirectory();
  const { current } = useTradingContext();
  const account = useMemo(
    () =>
      resolveDirectoryAccount(
        directory.accounts,
        directory.activeAccountId,
        current,
      ),
    [directory.accounts, directory.activeAccountId, current],
  );
  const storageKey = account === null ? null : preferenceStorageKey(account);
  const [state, setState] = useState<{
    readonly status: ScopedTradingPreferencesValue["status"];
    readonly preferences: ScopedTradingPreferences;
    readonly scopeKey: string | null;
  }>({
    status: "unavailable",
    preferences: DEFAULT_SCOPED_TRADING_PREFERENCES,
    scopeKey: null,
  });
  const operation = useRef(0);
  const write = useRef<Promise<boolean> | null>(null);

  useEffect(() => {
    const generation = ++operation.current;
    if (storageKey === null) {
      setState({
        status: "unavailable",
        preferences: resetScopedTradingPreferences(),
        scopeKey: null,
      });
      return;
    }
    setState({
      status: "loading",
      preferences: resetScopedTradingPreferences(),
      scopeKey: storageKey,
    });
    void AsyncStorage.getItem(storageKey)
      .then((value) => {
        if (generation !== operation.current) return;
        setState({
          status: "ready",
          preferences: parseScopedTradingPreferences(value),
          scopeKey: storageKey,
        });
      })
      .catch(() => {
        if (generation !== operation.current) return;
        setState({
          status: "error",
          preferences: resetScopedTradingPreferences(),
          scopeKey: storageKey,
        });
      });
    return () => {
      operation.current += 1;
    };
  }, [storageKey]);

  const persist = useCallback(
    (next: ScopedTradingPreferences): Promise<boolean> => {
      if (
        storageKey === null ||
        state.scopeKey !== storageKey ||
        (state.status !== "ready" && state.status !== "error") ||
        write.current !== null
      ) {
        return Promise.resolve(false);
      }
      const generation = operation.current;
      const request = AsyncStorage.setItem(storageKey, JSON.stringify(next))
        .then(() => {
          if (generation !== operation.current) return false;
          setState({
            status: "ready",
            preferences: next,
            scopeKey: storageKey,
          });
          return true;
        })
        .catch(() => {
          if (generation === operation.current) {
            setState((currentState) => ({
              ...currentState,
              status: "error",
            }));
          }
          return false;
        })
        .finally(() => {
          write.current = null;
        });
      write.current = request;
      return request;
    },
    [state.scopeKey, state.status, storageKey],
  );
  const update = useCallback(
    (patch: Parameters<ScopedTradingPreferencesValue["update"]>[0]) => {
      try {
        return persist(
          updateScopedTradingPreferences(state.preferences, patch),
        );
      } catch {
        return Promise.resolve(false);
      }
    },
    [persist, state.preferences],
  );
  const reset = useCallback(
    () => persist(resetScopedTradingPreferences()),
    [persist],
  );
  const visibleState =
    state.scopeKey === storageKey
      ? state
      : {
          status:
            storageKey === null
              ? ("unavailable" as const)
              : ("loading" as const),
          preferences: resetScopedTradingPreferences(),
          scopeKey: storageKey,
        };
  const value = useMemo<ScopedTradingPreferencesValue>(
    () => ({
      status: visibleState.status,
      scopeKey: visibleState.scopeKey,
      preferences: visibleState.preferences,
      account,
      update,
      reset,
    }),
    [
      account,
      reset,
      update,
      visibleState.preferences,
      visibleState.scopeKey,
      visibleState.status,
    ],
  );

  return (
    <ScopedTradingPreferencesContext.Provider value={value}>
      {children}
    </ScopedTradingPreferencesContext.Provider>
  );
}

export function useScopedTradingPreferences(): ScopedTradingPreferencesValue {
  const value = useContext(ScopedTradingPreferencesContext);
  if (value === null) {
    throw new Error(
      "useScopedTradingPreferences must be used inside ScopedTradingPreferencesProvider.",
    );
  }
  return value;
}
