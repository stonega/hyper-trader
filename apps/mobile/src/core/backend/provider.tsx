import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createContext,
  Fragment,
  type JSX,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { AsyncKeyValueStorage } from "../storage/public-cache";
import { configuredBackendOrigin } from "./config";
import {
  BACKEND_PREFERENCE_KEY,
  normalizeBackendOrigin,
  parseBackendPreference,
} from "./preference";

interface BackendPreferenceState {
  readonly status: "loading" | "ready" | "error";
  readonly override: string | null;
  readonly saving: boolean;
}

export interface BackendPreferenceValue extends BackendPreferenceState {
  readonly origin: string | null;
  readonly defaultOrigin: string | null;
  setOrigin(
    origin: string | null,
    beforeApply?: () => boolean,
  ): Promise<boolean>;
}

const BackendPreferenceContext = createContext<BackendPreferenceValue | null>(
  null,
);

export function BackendPreferenceProvider({
  children,
  defaultOrigin = configuredBackendOrigin(),
  storage = AsyncStorage,
}: PropsWithChildren<{
  readonly defaultOrigin?: string | null;
  readonly storage?: AsyncKeyValueStorage;
}>): JSX.Element {
  const [state, setState] = useState<BackendPreferenceState>({
    status: "loading",
    override: null,
    saving: false,
  });
  const stateRef = useRef(state);
  const active = useRef(false);
  const writing = useRef(false);
  const publish = useCallback((next: BackendPreferenceState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  useEffect(() => {
    active.current = true;
    let current = true;
    void storage.getItem(BACKEND_PREFERENCE_KEY).then(
      (value) => {
        if (current)
          publish({
            status: "ready",
            override: parseBackendPreference(value),
            saving: false,
          });
      },
      () => {
        if (current)
          publish({ status: "error", override: null, saving: false });
      },
    );
    return () => {
      current = false;
      active.current = false;
    };
  }, [publish, storage]);

  const setOrigin = useCallback(
    async (
      input: string | null,
      beforeApply?: () => boolean,
    ): Promise<boolean> => {
      if (
        writing.current ||
        stateRef.current.status === "loading" ||
        !active.current
      )
        return false;
      const normalized = input === null ? null : normalizeBackendOrigin(input);
      const override = normalized === defaultOrigin ? null : normalized;
      const previous = stateRef.current;
      const persist = async (value: string | null) => {
        if (value === null) await storage.removeItem(BACKEND_PREFERENCE_KEY);
        else
          await storage.setItem(
            BACKEND_PREFERENCE_KEY,
            JSON.stringify({ version: 1, origin: value }),
          );
      };
      writing.current = true;
      publish({ ...previous, saving: true });
      try {
        await persist(override);
        if (!active.current) return false;
        if (
          (override ?? defaultOrigin) !==
            (previous.override ?? defaultOrigin) &&
          beforeApply &&
          !beforeApply()
        ) {
          await persist(previous.override);
          publish({ ...previous, saving: false });
          return false;
        }
        publish({ status: "ready", override, saving: false });
        return true;
      } catch {
        if (active.current)
          publish({ ...previous, status: "error", saving: false });
        return false;
      } finally {
        writing.current = false;
      }
    },
    [defaultOrigin, publish, storage],
  );
  const origin = state.override ?? defaultOrigin;
  const value = useMemo<BackendPreferenceValue>(
    () => ({ ...state, defaultOrigin, origin, setOrigin }),
    [defaultOrigin, origin, setOrigin, state],
  );

  return (
    <BackendPreferenceContext.Provider value={value}>
      {state.status === "loading" ? null : (
        <Fragment key={origin ?? "unconfigured"}>{children}</Fragment>
      )}
    </BackendPreferenceContext.Provider>
  );
}

export function useBackendPreference(): BackendPreferenceValue {
  const value = useContext(BackendPreferenceContext);
  if (value === null) throw new Error("BackendPreferenceProvider is required.");
  return value;
}

export function useBackendOrigin(): string | null {
  const value = useContext(BackendPreferenceContext);
  return value === null ? configuredBackendOrigin() : value.origin;
}
