import type { HyperliquidNetwork } from "@hyper-trader/hyperliquid/public";
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
import {
  EMPTY_MARKET_PREFERENCES,
  type MarketPreferences,
  parseMarketPreferences,
  recordRecentMarket,
  serializeMarketPreferences,
  toggleFavorite as toggleFavoriteValue,
} from "./preferences";

interface MarketPreferencesValue {
  readonly status: "loading" | "ready" | "error";
  readonly preferences: MarketPreferences;
  toggleFavorite(canonicalId: string): void;
  selectMarket(canonicalId: string): void;
}

const MarketPreferencesContext = createContext<MarketPreferencesValue | null>(
  null,
);

function storageKey(network: HyperliquidNetwork): string {
  return `@hyper-trader/market-preferences:v1:${network}`;
}

export function MarketPreferencesProvider({
  children,
}: PropsWithChildren): JSX.Element {
  const { current } = useTradingContext();
  const [state, setState] = useState<{
    readonly network: HyperliquidNetwork;
    readonly status: "loading" | "ready" | "error";
    readonly preferences: MarketPreferences;
  }>({
    network: current.network,
    status: "loading",
    preferences: EMPTY_MARKET_PREFERENCES,
  });
  const currentPreferences = useRef<MarketPreferences>(
    EMPTY_MARKET_PREFERENCES,
  );
  const loadGeneration = useRef(0);
  const writeQueue = useRef(Promise.resolve());

  const reload = useCallback(async () => {
    const generation = ++loadGeneration.current;
    currentPreferences.current = EMPTY_MARKET_PREFERENCES;
    setState({
      network: current.network,
      status: "loading",
      preferences: EMPTY_MARKET_PREFERENCES,
    });
    try {
      const serialized = await AsyncStorage.getItem(
        storageKey(current.network),
      );
      if (generation !== loadGeneration.current) {
        return;
      }
      const parsed = serialized
        ? parseMarketPreferences(JSON.parse(serialized))
        : EMPTY_MARKET_PREFERENCES;
      if (!parsed) {
        currentPreferences.current = EMPTY_MARKET_PREFERENCES;
        setState({
          network: current.network,
          status: "error",
          preferences: EMPTY_MARKET_PREFERENCES,
        });
        return;
      }
      currentPreferences.current = parsed;
      setState({
        network: current.network,
        status: "ready",
        preferences: parsed,
      });
    } catch {
      if (generation === loadGeneration.current) {
        currentPreferences.current = EMPTY_MARKET_PREFERENCES;
        setState({
          network: current.network,
          status: "error",
          preferences: EMPTY_MARKET_PREFERENCES,
        });
      }
    }
  }, [current.network]);

  useEffect(() => {
    void reload();
    return () => {
      loadGeneration.current += 1;
    };
  }, [reload]);

  const commit = useCallback(
    (update: (value: MarketPreferences) => MarketPreferences) => {
      const next = update(currentPreferences.current);
      if (next === currentPreferences.current) {
        return;
      }
      currentPreferences.current = next;
      setState({
        network: current.network,
        status: "ready",
        preferences: next,
      });
      const key = storageKey(current.network);
      const serialized = serializeMarketPreferences(next);
      writeQueue.current = writeQueue.current
        .catch(() => undefined)
        .then(() => AsyncStorage.setItem(key, serialized))
        .catch(() => {
          setState((latest) =>
            latest.network === current.network
              ? { ...latest, status: "error" }
              : latest,
          );
        });
    },
    [current.network],
  );

  const value = useMemo<MarketPreferencesValue>(
    () => ({
      ...(state.network === current.network
        ? state
        : {
            network: current.network,
            status: "loading" as const,
            preferences: EMPTY_MARKET_PREFERENCES,
          }),
      toggleFavorite: (canonicalId) =>
        commit((preferences) => toggleFavoriteValue(preferences, canonicalId)),
      selectMarket: (canonicalId) =>
        commit((preferences) => recordRecentMarket(preferences, canonicalId)),
    }),
    [commit, current.network, state],
  );

  return (
    <MarketPreferencesContext.Provider value={value}>
      {children}
    </MarketPreferencesContext.Provider>
  );
}

export function useMarketPreferences(): MarketPreferencesValue {
  const value = useContext(MarketPreferencesContext);
  if (!value) {
    throw new Error(
      "useMarketPreferences must be used inside MarketPreferencesProvider.",
    );
  }
  return value;
}
