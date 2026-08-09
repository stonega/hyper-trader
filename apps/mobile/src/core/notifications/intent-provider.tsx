import type { HyperliquidNetwork } from "@hyper-trader/hyperliquid/public";
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

export interface NotificationIntent {
  readonly network: HyperliquidNetwork;
  readonly targetAccount: string;
  readonly marketCanonicalId?: string;
  readonly destination: "trade" | "portfolio" | "settings";
  readonly receivedAt: number;
}

export interface NotificationIntentValue {
  readonly pending: NotificationIntent | null;
  setPending(intent: NotificationIntent): void;
  consume(): NotificationIntent | null;
  clear(): void;
}

const NotificationIntentContext = createContext<NotificationIntentValue | null>(
  null,
);

export function NotificationIntentProvider({
  children,
}: PropsWithChildren): JSX.Element {
  const [pending, setPendingState] = useState<NotificationIntent | null>(null);
  const pendingRef = useRef<NotificationIntent | null>(null);
  const setPending = useCallback((intent: NotificationIntent) => {
    pendingRef.current = intent;
    setPendingState(intent);
  }, []);
  const clear = useCallback(() => {
    pendingRef.current = null;
    setPendingState(null);
  }, []);
  const consume = useCallback(() => {
    const consumed = pendingRef.current;
    pendingRef.current = null;
    setPendingState(null);
    return consumed;
  }, []);
  const value = useMemo(
    () => ({ pending, setPending, consume, clear }),
    [clear, consume, pending, setPending],
  );

  return (
    <NotificationIntentContext.Provider value={value}>
      {children}
    </NotificationIntentContext.Provider>
  );
}

export function useNotificationIntent(): NotificationIntentValue {
  const value = useContext(NotificationIntentContext);
  if (!value) {
    throw new Error(
      "useNotificationIntent must be used inside NotificationIntentProvider.",
    );
  }
  return value;
}
