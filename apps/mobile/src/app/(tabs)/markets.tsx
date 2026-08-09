import type {
  Market,
  MarketFamily,
  MarketOrderAvailability,
} from "@hyper-trader/hyperliquid/public";
import { useRouter } from "expo-router";
import { Card } from "heroui-native/card";
import { Chip } from "heroui-native/chip";
import { Input } from "heroui-native/input";
import { Label } from "heroui-native/label";
import { Skeleton } from "heroui-native/skeleton";
import { TextField } from "heroui-native/text-field";
import type { JSX } from "react";
import { useMemo, useState } from "react";
import { FlatList, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ScreenHeading } from "../../components/screen-heading";
import { useReducedMotion } from "../../components/use-reduced-motion";
import { useTradingContext } from "../../core/context/provider";
import { CatalogStatus } from "../../features/markets/catalog-status";
import {
  discoverMarkets,
  type MarketSort,
} from "../../features/markets/discovery";
import { MarketRow } from "../../features/markets/market-row";
import { useMarketPreferences } from "../../features/markets/preferences-provider";
import { useMarketCatalogPresentation } from "../../features/markets/query";
import { tradeMarketRoute } from "../../features/onboarding/routes";

const FAMILY_FILTERS: readonly {
  readonly value: MarketFamily | "all";
  readonly label: string;
}[] = [
  { value: "all", label: "All types" },
  { value: "perp", label: "Perpetuals" },
  { value: "spot", label: "Spot" },
  { value: "outcome", label: "Outcomes" },
];

const SORT_OPTIONS: readonly {
  readonly value: MarketSort;
  readonly label: string;
}[] = [
  { value: "volume", label: "Volume" },
  { value: "price_change", label: "Price change" },
  { value: "funding", label: "Funding" },
  { value: "open_interest", label: "Open interest" },
  { value: "symbol", label: "Symbol" },
];
const EMPTY_MARKET_IDS: readonly string[] = [];

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
  const reducedMotion = useReducedMotion();
  return (
    <View accessibilityLabel="Loading market catalog" className="gap-3 px-5">
      {[0, 1, 2].map((index) => (
        <Skeleton
          animation={reducedMotion ? "disable-all" : undefined}
          className="h-40 w-full rounded-2xl"
          key={index}
          variant={reducedMotion ? "none" : "shimmer"}
        />
      ))}
    </View>
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
  const [query, setQuery] = useState("");
  const [family, setFamily] = useState<MarketFamily | "all">("all");
  const [availability, setAvailability] = useState<
    MarketOrderAvailability | "all"
  >("all");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [recentsOnly, setRecentsOnly] = useState(false);
  const [activeOnly, setActiveOnly] = useState(false);
  const [sort, setSort] = useState<MarketSort>("volume");
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
  const markets = useMemo(
    () =>
      discoverMarkets(catalog?.markets ?? [], {
        query,
        families: family === "all" ? [] : [family],
        availability,
        lifecycle: activeOnly ? "active" : "all",
        favoritesOnly,
        recentsOnly,
        favoriteIds,
        recentIds,
        sort,
      }),
    [
      activeOnly,
      availability,
      catalog?.markets,
      family,
      favoriteIds,
      favoritesOnly,
      query,
      recentIds,
      recentsOnly,
      sort,
    ],
  );

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
        description="Search the complete validated catalog. Display symbols may repeat; venue and canonical ID keep each market distinct."
        network={current.network}
      />
      <TextField animation={reducedMotion ? "disable-all" : undefined}>
        <Label>Search every market</Label>
        <Input
          accessibilityHint="Searches display symbol, venue, canonical ID, coin, token identity, and outcome text."
          accessibilityLabel="Search every validated market"
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setQuery}
          placeholder="Symbol, venue, or canonical ID"
          returnKeyType="search"
          value={query}
        />
      </TextField>

      <View className="gap-2">
        <Text className="text-sm font-medium text-foreground">
          Market family
        </Text>
        <ScrollView
          accessibilityRole="none"
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
        </ScrollView>
      </View>

      <View className="gap-2">
        <Text className="text-sm font-medium text-foreground">Saved views</Text>
        <ScrollView
          contentContainerClassName="gap-2"
          horizontal
          keyboardShouldPersistTaps="handled"
          showsHorizontalScrollIndicator={false}
        >
          <FilterChip
            label="Favorites"
            onPress={() => setFavoritesOnly((selected) => !selected)}
            selected={favoritesOnly}
          />
          <FilterChip
            label="Recents"
            onPress={() => setRecentsOnly((selected) => !selected)}
            selected={recentsOnly}
          />
          <FilterChip
            label="Active markets"
            onPress={() => setActiveOnly((selected) => !selected)}
            selected={activeOnly}
          />
          <FilterChip
            label="Order enabled"
            onPress={() =>
              setAvailability((selected) =>
                selected === "enabled" ? "all" : "enabled",
              )
            }
            selected={availability === "enabled"}
          />
          <FilterChip
            label="Browse only"
            onPress={() =>
              setAvailability((selected) =>
                selected === "browse_only" ? "all" : "browse_only",
              )
            }
            selected={availability === "browse_only"}
          />
        </ScrollView>
      </View>

      <View className="gap-2">
        <Text className="text-sm font-medium text-foreground">Sort by</Text>
        <ScrollView
          contentContainerClassName="gap-2"
          horizontal
          keyboardShouldPersistTaps="handled"
          showsHorizontalScrollIndicator={false}
        >
          {SORT_OPTIONS.map((option) => (
            <FilterChip
              key={option.value}
              label={option.label}
              onPress={() => setSort(option.value)}
              selected={sort === option.value}
            />
          ))}
        </ScrollView>
      </View>

      <CatalogStatus
        onRetry={() => void catalogQuery.refetch()}
        sourceErrors={catalog?.sourceErrors ?? []}
        state={presentation}
      />
      {preferences.status === "error" ? (
        <Text accessibilityRole="alert" className="text-sm text-warning">
          Favorites or recents could not be saved. Market data is unaffected.
        </Text>
      ) : null}
      {presentation.content === "ready" ? (
        <Text accessibilityLiveRegion="polite" className="text-sm text-muted">
          {markets.length} of {catalog?.markets.length ?? 0} validated markets
          shown
        </Text>
      ) : null}
    </View>
  );

  const footer = catalog?.quarantined.length ? (
    <View className="gap-3 px-5 pb-8 pt-4">
      <Text
        accessibilityRole="header"
        className="text-xl font-semibold text-foreground"
      >
        Quarantined metadata
      </Text>
      <Text className="text-sm leading-5 text-muted">
        These records remain visible for diagnostics but cannot be selected for
        trading because their metadata is invalid or delisted.
      </Text>
      {catalog.quarantined.map((market) => (
        <Card key={market.canonicalId} variant="secondary">
          <Card.Body className="gap-1">
            <Card.Title>{market.displaySymbol}</Card.Title>
            <Card.Description>{market.canonicalId}</Card.Description>
            <Text className="text-sm text-warning">
              Unavailable: {market.reasons.join(", ")}
            </Text>
          </Card.Body>
        </Card>
      ))}
    </View>
  ) : (
    <View className="h-6" />
  );
  const emptyTitle =
    presentation.content === "unavailable"
      ? "Catalog unavailable"
      : presentation.content === "empty"
        ? "No validated markets"
        : "No markets match";
  const emptyDescription =
    presentation.content === "ready"
      ? "Clear a search or filter to show more markets."
      : presentation.statusLabel;
  const emptyContent =
    presentation.content === "loading" ? (
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
      contentContainerClassName="pb-8"
      data={presentation.content === "ready" ? markets : []}
      ItemSeparatorComponent={() => <View className="h-3" />}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      keyExtractor={(market) => market.canonicalId}
      ListEmptyComponent={emptyContent}
      ListFooterComponent={footer}
      ListHeaderComponent={header}
      refreshControl={
        <RefreshControl
          accessibilityLabel="Refresh market catalog"
          onRefresh={() => void catalogQuery.refetch()}
          refreshing={catalogQuery.isRefetching}
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
    />
  );
}
