import {
  createContext,
  type JSX,
  type PropsWithChildren,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";

import type { SessionLockReason } from "../lifecycle/controller";

export type SignerSessionLockReason =
  | SessionLockReason
  | "context_changed"
  | "manual";

export interface SignerSessionState {
  readonly locked: true;
  readonly epoch: number;
  readonly reason: SignerSessionLockReason | null;
}

export interface SignerSessionValue extends SignerSessionState {
  lock(reason: SignerSessionLockReason): void;
  read(): SignerSessionState;
}

const SignerSessionContext = createContext<SignerSessionValue | null>(null);

export function SignerSessionProvider({
  children,
}: PropsWithChildren): JSX.Element {
  const [state, setState] = useState<SignerSessionState>({
    locked: true,
    epoch: 0,
    reason: null,
  });
  const stateRef = useRef(state);
  const lock = useCallback((reason: SignerSessionLockReason) => {
    const next: SignerSessionState = {
      locked: true,
      epoch: stateRef.current.epoch + 1,
      reason,
    };
    stateRef.current = next;
    setState(next);
  }, []);
  const value = useMemo(
    () => ({ ...state, lock, read: () => stateRef.current }),
    [lock, state],
  );

  return (
    <SignerSessionContext.Provider value={value}>
      {children}
    </SignerSessionContext.Provider>
  );
}

export function useSignerSession(): SignerSessionValue {
  const value = useContext(SignerSessionContext);
  if (!value) {
    throw new Error(
      "useSignerSession must be used inside SignerSessionProvider.",
    );
  }
  return value;
}
