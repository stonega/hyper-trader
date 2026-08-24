import type {
  MarketFamily,
  MarketSummary,
} from "@hyper-trader/hyperliquid/public";
import { useRouter } from "expo-router";
import { Card } from "heroui-native/card";
import { Chip } from "heroui-native/chip";
import { Input } from "heroui-native/input";
import { TextField } from "heroui-native/text-field";
import type { JSX } from "react";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  FlatList,
  type ListRenderItem,
  RefreshControl,
  ScrollView,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText as Text } from "../../components/app-text";
import { KeyboardAwareView } from "../../components/keyboard-aware-view";
import { floatingTabBarInset } from "../../components/navigation/floating-tab-bar";
import { ScreenHeading } from "../../components/screen-heading";
import { LoadingSkeletons } from "../../components/ui/loading-skeletons";
import { useReducedMotion } from "../../components/use-reduced-motion";
import { useTradingContext } from "../../core/context/provider";
import {
  createMarketLoadTrace,
  isInitialMarketDataSettled,
  marketTimingNow,
} from "../../core/performance/market-load-timing";
import { GlobalAccountSwitcher } from "../../features/accounts/global-account-switcher";
import {
  type MarketCatalogMode,
  MarketCatalogModeToggle,
} from "../../features/markets/catalog-mode-toggle";
import { CatalogStatus } from "../../features/markets/catalog-status";
import {
  discoverMarkets,
  type MarketDiscoveryOptions,
} from "../../features/markets/discovery";
import { runManualRefresh } from "../../features/markets/manual-refresh";
import { MarketRow } from "../../features/markets/market-row";
import { useMarketPreferences } from "../../features/markets/preferences-provider";
import { useMarketSummaryPages } from "../../features/markets/query";
import { tradeMarketRoute } from "../../navigation/routes";

const FAMILY_FILTERS: readonly {
  readonly value: MarketFamily | "all";
  readonly label: string;
}[] = [
  { value: "all", label: "All types" },
  { value: "perp", label: "Perpetuals" },
  { value: "spot", label: "Spot" },
  { value: "outcome", label: "Outcomes" },
];

const EMPTY_MARKET_IDS: readonly string[] = [];
const MARKET_LOADING_ITEMS = ["market-1", "market-2", "market-3"] as const;

function FilterChip({
  label,
  selected,
  onPress,
}: {
  readonly label: string;
  readonly selected: boolean;
  readonly onPress: () => void;
}): JSX.Element {
  const reducedMotion = useReducedMotion();
  return (
    <Chip
      accessibilityLabel={`${label} filter`}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      animation={reducedMotion ? "disable-all" : undefined}
      className="min-h-11 px-2"
      color={selected ? "accent" : "default"}
      onPress={onPress}
      variant={selected ? "primary" : "secondary"}
    >
      {label}
    </Chip>
  );
}

function LoadingCatalog(): JSX.Element {
  return (
    <LoadingSkeletons
      accessibilityLabel="Loading markets"
      className="gap-3 px-5"
      items={MARKET_LOADING_ITEMS}
    />
  );
}

export default function MarketsScreen(): JSX.Element {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { current } = useTradingContext();
  const preferences = useMarketPreferences();
  const screenTiming = useMemo(
    () =>
      createMarketLoadTrace({
        network: current.network,
        source: "markets-screen",
      }),
    [current.network],
  );
  const reducedMotion = useReducedMotion();
  const manualRefreshGate = useRef(false);
  const allDataTraceId = useRef<string | null>(null);
  const fetchStartedTraceId = useRef<string | null>(null);
  const firstRowTraceId = useRef<string | null>(null);
  const [isPullRefreshing, setIsPullRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [catalogMode, setCatalogMode] = useState<MarketCatalogMode>("strict");
  const [family, setFamily] = useState<MarketFamily | "all">("all");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [recentsOnly, setRecentsOnly] = useState(false);
  const favoriteIds = favoritesOnly
    ? preferences.preferences.favoriteIds
    : EMPTY_MARKET_IDS;
  const recentIds = recentsOnly
    ? preferences.preferences.recentIds
    : EMPTY_MARKET_IDS;
  const favoriteSet = useMemo(
    () => new Set(preferences.preferences.favoriteIds),
    [preferences.preferences.favoriteIds],
  );
  const discoveryOptions = useMemo<MarketDiscoveryOptions>(
    () => ({
      query,
      families: family === "all" ? [] : [family],
      includeHip3: catalogMode === "all",
      availability: "enabled",
      lifecycle: "active",
      favoritesOnly,
      recentsOnly,
      favoriteIds,
      recentIds,
      sort: "volume",
    }),
    [
      catalogMode,
      family,
      favoriteIds,
      favoritesOnly,
      query,
      recentIds,
      recentsOnly,
    ],
  );
  // A cached first summary page is first content, so never defer it. Only
  // user-driven discovery changes may keep showing the current list briefly.
  const deferredDiscoveryOptions = useDeferredValue(discoveryOptions);
  const isDiscoveryPending = deferredDiscoveryOptions !== discoveryOptions;
  const requestedIds = deferredDiscoveryOptions.favoritesOnly
    ? deferredDiscoveryOptions.favoriteIds
    : deferredDiscoveryOptions.recentsOnly
      ? deferredDiscoveryOptions.recentIds
      : EMPTY_MARKET_IDS;
  const summaryOptions = useMemo(
    () => ({
      query: deferredDiscoveryOptions.query,
      family: deferredDiscoveryOptions.families[0] ?? null,
      includeHip3: deferredDiscoveryOptions.includeHip3,
      availability: deferredDiscoveryOptions.availability,
      lifecycle: deferredDiscoveryOptions.lifecycle,
      sort: deferredDiscoveryOptions.sort,
      restrictToIds:
        deferredDiscoveryOptions.favoritesOnly ||
        deferredDiscoveryOptions.recentsOnly,
      ids: requestedIds,
    }),
    [deferredDiscoveryOptions, requestedIds],
  );
  const {
    loadNextPage: fetchNextSummaryPage,
    markets: sourceMarkets,
    presentation,
    query: summaryQuery,
    total,
  } = useMarketSummaryPages(current.network, summaryOptions);
  const discovery = useMemo(() => {
    const startedAt = marketTimingNow();
    const visibleMarkets = discoverMarkets(
      sourceMarkets,
      deferredDiscoveryOptions,
    );
    return {
      durationMs: marketTimingNow() - startedAt,
      markets: visibleMarkets,
    };
  }, [deferredDiscoveryOptions, sourceMarkets]);
  const markets = discovery.markets;
  const firstOpenState = useRef({
    traceId: screenTiming.traceId,
    hadCachedSummary: summaryQuery.data !== undefined,
    initialDataUpdatedAt: summaryQuery.dataUpdatedAt,
  });
  if (firstOpenState.current.traceId !== screenTiming.traceId) {
    firstOpenState.current = {
      traceId: screenTiming.traceId,
      hadCachedSummary: summaryQuery.data !== undefined,
      initialDataUpdatedAt: summaryQuery.dataUpdatedAt,
    };
  }
  useEffect(() => {
    screenTiming.mark("screen:mounted");
  }, [screenTiming]);
  useEffect(() => {
    if (
      summaryQuery.fetchStatus !== "fetching" ||
      fetchStartedTraceId.current === screenTiming.traceId
    ) {
      return;
    }
    fetchStartedTraceId.current = screenTiming.traceId;
    screenTiming.mark("screen:data-fetch-started", {
      hadCachedSummary: firstOpenState.current.hadCachedSummary,
    });
  }, [screenTiming, summaryQuery.fetchStatus]);
  useEffect(() => {
    if (
      allDataTraceId.current === screenTiming.traceId ||
      !isInitialMarketDataSettled({
        content: presentation.content,
        fetchStatus: summaryQuery.fetchStatus,
        preferencesStatus: preferences.status,
      })
    ) {
      return;
    }
    allDataTraceId.current = screenTiming.traceId;
    const initial = firstOpenState.current;
    const fetchFailed = summaryQuery.isError || summaryQuery.isRefetchError;
    screenTiming.mark("screen:all-data-fetched", {
      outcome:
        summaryQuery.fetchStatus === "paused"
          ? "paused"
          : fetchFailed || presentation.content === "unavailable"
            ? "error"
            : "success",
      hadCachedSummary: initial.hadCachedSummary,
      freshSummaryReceived:
        summaryQuery.dataUpdatedAt > initial.initialDataUpdatedAt,
      marketCount: sourceMarkets.length,
      preferencesStatus: preferences.status,
      total,
    });
  }, [
    preferences.status,
    presentation.content,
    screenTiming,
    sourceMarkets.length,
    summaryQuery.dataUpdatedAt,
    summaryQuery.fetchStatus,
    summaryQuery.isError,
    summaryQuery.isRefetchError,
    total,
  ]);
  useEffect(() => {
    screenTiming.record("screen:discovery", discovery.durationMs, {
      resultCount: markets.length,
      sourceCount: sourceMarkets.length,
    });
  }, [discovery, markets.length, screenTiming, sourceMarkets.length]);
  useEffect(() => {
    if (sourceMarkets.length === 0) return;
    screenTiming.mark("screen:catalog-received", {
      catalogKind: "summary-page",
      marketCount: sourceMarkets.length,
    });
  }, [screenTiming, sourceMarkets]);
  const markFirstRowLayout = useCallback(() => {
    if (firstRowTraceId.current === screenTiming.traceId) return;
    firstRowTraceId.current = screenTiming.traceId;
    screenTiming.mark("screen:first-row-layout", {
      catalogKind: "summary-page",
      visibleMarketCount: markets.length,
    });
  }, [markets.length, screenTiming]);
  const selectMarket = preferences.selectMarket;
  const toggleFavorite = preferences.toggleFavorite;
  const openMarket = useCallback(
    (market: MarketSummary) => {
      selectMarket(market.canonicalId);
      router.navigate(tradeMarketRoute(market.canonicalId));
    },
    [router, selectMarket],
  );
  const toggleMarketFavorite = useCallback(
    (canonicalId: string) => toggleFavorite(canonicalId),
    [toggleFavorite],
  );
  const refetchCatalog = summaryQuery.refetch;
  const refreshFromPullGesture = useCallback(
    () =>
      runManualRefresh(
        manualRefreshGate,
        () => refetchCatalog(),
        setIsPullRefreshing,
      ),
    [refetchCatalog],
  );
  const showCatalogStatus =
    presentation.content !== "ready" ||
    presentation.freshness === "stale" ||
    presentation.freshness === "offline" ||
    presentation.hasPartialSources;
  const loadNextPage = useCallback(() => {
    if (!summaryQuery.hasNextPage || summaryQuery.isFetchingNextPage) return;
    void fetchNextSummaryPage();
  }, [
    fetchNextSummaryPage,
    summaryQuery.hasNextPage,
    summaryQuery.isFetchingNextPage,
  ]);

  const renderMarket = useCallback<ListRenderItem<MarketSummary>>(
    ({ index, item }) => (
      <View
        className="px-5"
        onLayout={index === 0 ? markFirstRowLayout : undefined}
      >
        <MarketRow
          isFavorite={favoriteSet.has(item.canonicalId)}
          market={item}
          onOpen={openMarket}
          onToggleFavorite={toggleMarketFavorite}
          preferencesReady={preferences.status !== "loading"}
        />
      </View>
    ),
    [
      favoriteSet,
      markFirstRowLayout,
      openMarket,
      preferences.status,
      toggleMarketFavorite,
    ],
  );

  const header = (
    <View
      className="gap-5 px-5 pb-5"
      style={{ paddingTop: Math.max(insets.top, 20) }}
    >
      <ScreenHeading
        title="Markets"
        titleAccessory={
          <MarketCatalogModeToggle
            mode={catalogMode}
            onChange={setCatalogMode}
          />
        }
        network={current.network}
        accountLabel={
          current.targetAccount === null
            ? "no account · read only"
            : `target …${current.targetAccount.slice(-6)}${current.signer === null ? " · read only" : ""}`
        }
        rightAccessory={<GlobalAccountSwitcher avatarOnly />}
        showContext={false}
      />
      <TextField animation={reducedMotion ? "disable-all" : undefined}>
        <Input
          accessibilityHint="Searches market names, symbols, and venues."
          accessibilityLabel="Search markets"
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setQuery}
          placeholder="Search markets"
          returnKeyType="search"
          value={query}
        />
      </TextField>

      <ScrollView
        accessibilityLabel="Market filters"
        contentContainerClassName="gap-2"
        horizontal
        keyboardShouldPersistTaps="handled"
        showsHorizontalScrollIndicator={false}
      >
        {FAMILY_FILTERS.map((option) => (
          <FilterChip
            key={option.value}
            label={option.label}
            onPress={() => setFamily(option.value)}
            selected={family === option.value}
          />
        ))}
        <FilterChip
          label="Favorites"
          onPress={() => {
            setFavoritesOnly((selected) => {
              if (!selected) setRecentsOnly(false);
              return !selected;
            });
          }}
          selected={favoritesOnly}
        />
        <FilterChip
          label="Recents"
          onPress={() => {
            setRecentsOnly((selected) => {
              if (!selected) setFavoritesOnly(false);
              return !selected;
            });
          }}
          selected={recentsOnly}
        />
      </ScrollView>

      {preferences.status === "error" ? (
        <Text accessibilityRole="alert" className="text-sm text-warning">
          Favorites could not be saved.
        </Text>
      ) : null}
      {presentation.content === "ready" ? (
        <View className="flex-row items-center justify-between gap-3">
          <Text
            accessibilityLiveRegion="polite"
            className="shrink-0 text-sm text-muted"
          >
            {markets.length < total
              ? `${markets.length} of ${total} markets`
              : `${total} markets`}
          </Text>
          {showCatalogStatus ? (
            <CatalogStatus
              compact
              onRetry={() => void refetchCatalog()}
              state={presentation}
            />
          ) : null}
        </View>
      ) : showCatalogStatus ? (
        <CatalogStatus
          onRetry={() => void refetchCatalog()}
          state={presentation}
        />
      ) : null}
    </View>
  );

  const footer = (
    <View className="h-14 items-center justify-center">
      {summaryQuery.isFetchingNextPage ? (
        <ActivityIndicator accessibilityLabel="Loading more markets" />
      ) : null}
    </View>
  );
  const hasDiscoveryConstraint =
    query !== "" ||
    family !== "all" ||
    catalogMode !== "strict" ||
    favoritesOnly ||
    recentsOnly;
  const emptyTitle =
    presentation.content === "unavailable"
      ? "Catalog unavailable"
      : presentation.content === "empty"
        ? hasDiscoveryConstraint
          ? "No markets match"
          : "No validated markets"
        : "No markets match";
  const emptyDescription = hasDiscoveryConstraint
    ? "Clear a search or filter to show more markets."
    : "Pull to refresh and try again.";
  const emptyContent =
    presentation.content === "loading" ||
    (isDiscoveryPending && markets.length === 0) ? (
      <LoadingCatalog />
    ) : (
      <View className="px-5">
        <Card variant="secondary">
          <Card.Body>
            <Card.Title>{emptyTitle}</Card.Title>
            <Card.Description>{emptyDescription}</Card.Description>
          </Card.Body>
        </Card>
      </View>
    );

  return (
    <KeyboardAwareView className="flex-1 bg-background">
      <FlatList
        className="flex-1 bg-background"
        contentContainerStyle={{
          paddingBottom: floatingTabBarInset(insets.bottom) + 16,
        }}
        data={presentation.content === "ready" ? markets : []}
        initialNumToRender={3}
        ItemSeparatorComponent={() => <View className="h-3" />}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        keyExtractor={(market) => market.canonicalId}
        ListEmptyComponent={emptyContent}
        ListFooterComponent={footer}
        ListHeaderComponent={header}
        maxToRenderPerBatch={4}
        onEndReached={loadNextPage}
        onEndReachedThreshold={0.6}
        refreshControl={
          <RefreshControl
            accessibilityLabel="Refresh markets"
            onRefresh={() => void refreshFromPullGesture()}
            refreshing={isPullRefreshing}
          />
        }
        renderItem={renderMarket}
        updateCellsBatchingPeriod={32}
        windowSize={5}
      />
    </KeyboardAwareView>
  );
}
