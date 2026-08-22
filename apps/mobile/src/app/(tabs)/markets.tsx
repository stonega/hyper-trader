import type { Market, MarketFamily } from "@hyper-trader/hyperliquid/public";
import { useRouter } from "expo-router";
import { Card } from "heroui-native/card";
import { Chip } from "heroui-native/chip";
import { Input } from "heroui-native/input";
import { TextField } from "heroui-native/text-field";
import type { JSX } from "react";
import {
  useCallback,
  useDeferredValue,
  useMemo,
  useRef,
  useState,
} from "react";
import { FlatList, RefreshControl, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText as Text } from "../../components/app-text";
import { floatingTabBarInset } from "../../components/navigation/floating-tab-bar";
import { ScreenHeading } from "../../components/screen-heading";
import { LoadingSkeletons } from "../../components/ui/loading-skeletons";
import { useReducedMotion } from "../../components/use-reduced-motion";
import { useTradingContext } from "../../core/context/provider";
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
import { useMarketCatalogPresentation } from "../../features/markets/query";
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
const EMPTY_MARKETS: readonly Market[] = [];
const MARKET_LOADING_ITEMS = ["market-1", "market-2", "market-3"] as const;
const INITIAL_DISCOVERY_OPTIONS: MarketDiscoveryOptions = {
  query: "",
  families: [],
  availability: "enabled",
  lifecycle: "active",
  favoritesOnly: false,
  recentsOnly: false,
  favoriteIds: EMPTY_MARKET_IDS,
  recentIds: EMPTY_MARKET_IDS,
  sort: "volume",
};

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
      accessibilityLabel="Loading market catalog"
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
  const { catalog, catalogQuery, presentation } = useMarketCatalogPresentation(
    current.network,
  );
  const reducedMotion = useReducedMotion();
  const manualRefreshGate = useRef(false);
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
  const sourceMarkets = catalog?.markets ?? EMPTY_MARKETS;
  const discoveryOptions = useMemo<MarketDiscoveryOptions>(
    () => ({
      query,
      families: family === "all" ? [] : [family],
      availability: catalogMode === "strict" ? "enabled" : "all",
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
  const deferredMarkets = useDeferredValue(sourceMarkets, EMPTY_MARKETS);
  const deferredDiscoveryOptions = useDeferredValue(
    discoveryOptions,
    INITIAL_DISCOVERY_OPTIONS,
  );
  const isDiscoveryPending =
    deferredMarkets !== sourceMarkets ||
    deferredDiscoveryOptions !== discoveryOptions;
  const markets = useMemo(
    () => discoverMarkets(deferredMarkets, deferredDiscoveryOptions),
    [deferredDiscoveryOptions, deferredMarkets],
  );
  const refetchCatalog = catalogQuery.refetch;
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

  const openMarket = (market: Market) => {
    preferences.selectMarket(market.canonicalId);
    router.navigate(tradeMarketRoute(market.canonicalId));
  };

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
            {markets.length} markets
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

  const footer = <View className="h-6" />;
  const emptyTitle =
    presentation.content === "unavailable"
      ? "Catalog unavailable"
      : presentation.content === "empty"
        ? "No validated markets"
        : "No markets match";
  const emptyDescription =
    presentation.content === "ready"
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
    <FlatList
      className="flex-1 bg-background"
      contentContainerStyle={{
        paddingBottom: floatingTabBarInset(insets.bottom) + 16,
      }}
      data={presentation.content === "ready" ? markets : []}
      initialNumToRender={6}
      ItemSeparatorComponent={() => <View className="h-3" />}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      keyExtractor={(market) => market.canonicalId}
      ListEmptyComponent={emptyContent}
      ListFooterComponent={footer}
      ListHeaderComponent={header}
      maxToRenderPerBatch={6}
      refreshControl={
        <RefreshControl
          accessibilityLabel="Refresh market catalog"
          onRefresh={() => void refreshFromPullGesture()}
          refreshing={isPullRefreshing}
        />
      }
      renderItem={({ item }) => (
        <View className="px-5">
          <MarketRow
            isFavorite={favoriteSet.has(item.canonicalId)}
            market={item}
            onOpen={() => openMarket(item)}
            onToggleFavorite={() =>
              preferences.toggleFavorite(item.canonicalId)
            }
            preferencesReady={preferences.status !== "loading"}
          />
        </View>
      )}
      updateCellsBatchingPeriod={50}
      windowSize={5}
    />
  );
}
