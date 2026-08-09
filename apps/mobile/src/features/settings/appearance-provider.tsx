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
import { Uniwind } from "uniwind";

export type AppearancePreference = "system" | "light" | "dark";

export interface AppearancePreferenceValue {
  readonly status: "loading" | "ready" | "error";
  readonly preference: AppearancePreference;
  setPreference(preference: AppearancePreference): Promise<boolean>;
}

const APPEARANCE_KEY = "@hyper-trader/appearance/v1";
const AppearancePreferenceContext =
  createContext<AppearancePreferenceValue | null>(null);

function parseAppearance(value: string | null): AppearancePreference {
  return value === "light" || value === "dark" || value === "system"
    ? value
    : "system";
}

export function AppearancePreferenceProvider({
  children,
}: PropsWithChildren): JSX.Element {
  const [state, setState] = useState<{
    readonly status: AppearancePreferenceValue["status"];
    readonly preference: AppearancePreference;
  }>({ status: "loading", preference: "system" });
  const operation = useRef(0);
  const writeQueue = useRef(Promise.resolve());

  useEffect(() => {
    const generation = ++operation.current;
    void AsyncStorage.getItem(APPEARANCE_KEY)
      .then((value) => {
        if (generation !== operation.current) return;
        const preference = parseAppearance(value);
        Uniwind.setTheme(preference);
        setState({ status: "ready", preference });
      })
      .catch(() => {
        if (generation !== operation.current) return;
        Uniwind.setTheme("system");
        setState({ status: "error", preference: "system" });
      });
    return () => {
      operation.current += 1;
    };
  }, []);

  const setPreference = useCallback(
    async (preference: AppearancePreference) => {
      const generation = ++operation.current;
      const write = writeQueue.current.then(() =>
        AsyncStorage.setItem(APPEARANCE_KEY, preference),
      );
      writeQueue.current = write.catch(() => undefined);
      try {
        await write;
        if (generation !== operation.current) return false;
        Uniwind.setTheme(preference);
        setState({ status: "ready", preference });
        return true;
      } catch {
        if (generation === operation.current) {
          setState((current) => ({ ...current, status: "error" }));
        }
        return false;
      }
    },
    [],
  );
  const value = useMemo<AppearancePreferenceValue>(
    () => ({ ...state, setPreference }),
    [setPreference, state],
  );
  return (
    <AppearancePreferenceContext.Provider value={value}>
      {children}
    </AppearancePreferenceContext.Provider>
  );
}

export function useAppearancePreference(): AppearancePreferenceValue {
  const value = useContext(AppearancePreferenceContext);
  if (value === null) {
    throw new Error(
      "useAppearancePreference must be used inside AppearancePreferenceProvider.",
    );
  }
  return value;
}
