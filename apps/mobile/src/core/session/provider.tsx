import {
  createContext,
  type JSX,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState } from "react-native";

import type {
  SignerSessionManager,
  SignerSessionSnapshot,
  SignerSessionStopReason,
} from "./manager";

export type SignerSessionLockReason = SignerSessionStopReason;

export interface SignerSessionState {
  readonly locked: boolean;
  readonly epoch: number;
  readonly reason: SignerSessionLockReason | null;
  readonly snapshot: SignerSessionSnapshot;
}

export interface SignerSessionValue extends SignerSessionState {
  lock(reason: SignerSessionLockReason): void;
  read(): SignerSessionState;
  readonly manager: SignerSessionManager | null;
}

const SignerSessionContext = createContext<SignerSessionValue | null>(null);

function stateFromSnapshot(
  snapshot: SignerSessionSnapshot,
): SignerSessionState {
  return {
    locked: snapshot.status !== "unlocked",
    epoch: snapshot.epoch,
    reason: snapshot.status === "locked" ? snapshot.reason : null,
    snapshot,
  };
}

export function SignerSessionProvider({
  children,
  manager = null,
}: PropsWithChildren<{
  readonly manager?: SignerSessionManager | null;
}>): JSX.Element {
  const [state, setState] = useState<SignerSessionState>(() =>
    stateFromSnapshot(
      manager?.read() ?? { status: "locked", epoch: 0, reason: null },
    ),
  );
  const stateRef = useRef(state);
  const lock = useCallback(
    (reason: SignerSessionLockReason) => {
      if (manager) {
        manager.lock(reason);
        return;
      }
      const next = stateFromSnapshot({
        status: "locked" as const,
        epoch: stateRef.current.epoch + 1,
        reason,
      });
      stateRef.current = next;
      setState(next);
    },
    [manager],
  );

  useEffect(() => {
    if (!manager) return;
    const update = (snapshot: SignerSessionSnapshot) => {
      const next = stateFromSnapshot(snapshot);
      stateRef.current = next;
      setState(next);
    };
    update(manager.read());
    return manager.subscribe(update);
  }, [manager]);

  useEffect(() => {
    const subscription = AppState.addEventListener("memoryWarning", () =>
      lock("memory_warning"),
    );
    return () => {
      subscription.remove();
      manager?.lock("app_terminated");
    };
  }, [lock, manager]);

  const value = useMemo(
    () => ({ ...state, lock, read: () => stateRef.current, manager }),
    [lock, manager, state],
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
