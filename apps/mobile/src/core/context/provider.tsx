import { useQueryClient } from "@tanstack/react-query";
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

import { useDraftRegistry } from "../actions/draft-provider";
import { DEFAULT_HYPERLIQUID_NETWORK } from "../network";
import {
  cancelIncompatiblePrivateQueries,
  removeIncompatiblePrivateQueries,
} from "../query/private-cache";
import { useSignerSession } from "../session/provider";
import { useStreamRuntime } from "../streams/provider";
import {
  type ContextCapture,
  type ContextSupervisor,
  createContextSupervisor,
  type NormalizedTradingContext,
  normalizeTradingContext,
  type TradingContextIdentity,
} from "./supervisor";

export interface TradingContextValue {
  readonly current: NormalizedTradingContext;
  switchContext(next: TradingContextIdentity): Promise<boolean>;
  capture(): ContextCapture;
  canCommit(capture: ContextCapture): boolean;
}

const TradingContext = createContext<TradingContextValue | null>(null);

const READ_ONLY_CONTEXT: TradingContextIdentity = {
  network: DEFAULT_HYPERLIQUID_NETWORK,
  masterAccount: null,
  targetAccount: null,
  signer: null,
};

export function TradingContextProvider({
  children,
  initial = READ_ONLY_CONTEXT,
}: PropsWithChildren<{
  readonly initial?: TradingContextIdentity;
}>): JSX.Element {
  const queryClient = useQueryClient();
  const signerSession = useSignerSession();
  const drafts = useDraftRegistry();
  const streams = useStreamRuntime();
  const [current, setCurrent] = useState(() =>
    normalizeTradingContext(initial),
  );
  const supervisor = useRef<ContextSupervisor | null>(null);
  supervisor.current ??= createContextSupervisor({
    initial,
    cancelPrivateQueries: (next) =>
      cancelIncompatiblePrivateQueries(queryClient, next),
    lockSignerSession: (reason) => signerSession.lock(reason),
    invalidateDrafts: (next) => drafts.invalidateForContext(next),
    removeIncompatiblePrivateQueries: (next) =>
      removeIncompatiblePrivateQueries(queryClient, next),
    onCommit: (next) => {
      streams.setNetwork(next.network);
      setCurrent(next);
    },
  });

  const switchContext = useCallback(async (next: TradingContextIdentity) => {
    const result = await supervisor.current?.switchContext(next);
    return result?.committed ?? false;
  }, []);
  const value = useMemo<TradingContextValue>(
    () => ({
      current,
      switchContext,
      capture: () => {
        if (!supervisor.current) {
          throw new Error("The trading context supervisor is unavailable.");
        }
        return supervisor.current.capture();
      },
      canCommit: (capture) => supervisor.current?.canCommit(capture) ?? false,
    }),
    [current, switchContext],
  );

  return (
    <TradingContext.Provider value={value}>{children}</TradingContext.Provider>
  );
}

export function useTradingContext(): TradingContextValue {
  const value = useContext(TradingContext);
  if (!value) {
    throw new Error(
      "useTradingContext must be used inside TradingContextProvider.",
    );
  }
  return value;
}
