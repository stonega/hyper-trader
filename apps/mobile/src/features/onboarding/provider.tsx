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

import { completeOnboarding, loadOnboardingState } from "./storage";

export interface OnboardingPreferenceValue {
  readonly status: "loading" | "ready" | "error";
  readonly hasSetupIntent: boolean;
  requestSetup(): Promise<boolean>;
}

const OnboardingPreferenceContext =
  createContext<OnboardingPreferenceValue | null>(null);

export function OnboardingPreferenceProvider({
  children,
}: PropsWithChildren): JSX.Element {
  const [state, setState] = useState<{
    readonly status: "loading" | "ready" | "error";
    readonly hasSetupIntent: boolean;
  }>({ status: "loading", hasSetupIntent: false });
  const operation = useRef(0);
  const setupRequest = useRef<Promise<boolean> | null>(null);

  const reload = useCallback(async () => {
    const currentOperation = ++operation.current;
    setState((current) => ({ ...current, status: "loading" }));
    const result = await loadOnboardingState();
    if (currentOperation !== operation.current) {
      return;
    }
    if (result.status === "completed") {
      setState({
        status: "ready",
        hasSetupIntent: result.record.setupIntent === "requested",
      });
      return;
    }
    setState({
      status: result.status === "absent" ? "ready" : "error",
      hasSetupIntent: false,
    });
  }, []);

  useEffect(() => {
    void reload();
    return () => {
      operation.current += 1;
    };
  }, [reload]);

  const requestSetup = useCallback((): Promise<boolean> => {
    if (setupRequest.current) {
      return setupRequest.current;
    }
    const currentOperation = ++operation.current;
    setState((current) => ({ ...current, status: "loading" }));
    const request = (async () => {
      try {
        await completeOnboarding("setup");
        if (currentOperation !== operation.current) {
          return false;
        }
        setState({ status: "ready", hasSetupIntent: true });
        return true;
      } catch {
        if (currentOperation === operation.current) {
          setState((current) => ({ ...current, status: "error" }));
        }
        return false;
      } finally {
        setupRequest.current = null;
      }
    })();
    setupRequest.current = request;
    return request;
  }, []);

  const value = useMemo<OnboardingPreferenceValue>(
    () => ({ ...state, requestSetup }),
    [requestSetup, state],
  );
  return (
    <OnboardingPreferenceContext.Provider value={value}>
      {children}
    </OnboardingPreferenceContext.Provider>
  );
}

export function useOnboardingPreference(): OnboardingPreferenceValue {
  const value = useContext(OnboardingPreferenceContext);
  if (!value) {
    throw new Error(
      "useOnboardingPreference must be used inside OnboardingPreferenceProvider.",
    );
  }
  return value;
}
