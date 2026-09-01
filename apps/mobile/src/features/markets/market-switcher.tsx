import Ionicons from "@expo/vector-icons/Ionicons";
import type { MarketSummary } from "@hyper-trader/hyperliquid/public";
import { Button } from "heroui-native/button";
import { Card } from "heroui-native/card";
import { useThemeColor } from "heroui-native/hooks";
import { SearchField } from "heroui-native/search-field";
import type { JSX, ReactNode } from "react";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Modal,
  Platform,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText as Text } from "../../components/app-text";
import { KeyboardAwareView } from "../../components/keyboard-aware-view";
import { useReducedMotion } from "../../components/use-reduced-motion";
import { ACTIVE_MARKET_CATALOG_FILTERS } from "./catalog-filter";
import {
  discoverMarkets,
  marketDisplayLabel,
  marketPairLabel,
} from "./discovery";
import { MarketIcon } from "./market-icon";

const EMPTY_IDS: readonly string[] = [];
const EMPTY_MARKETS: readonly MarketSummary[] = [];

export function MarketSwitcher({
  markets,
  selectedCanonicalId,
  visible,
  isFetchingNextPage = false,
  loading = false,
  onClose,
  onEndReached,
  onQueryChange,
  onSelect,
  filterQuery,
  query: controlledQuery,
  status,
  total,
}: {
  readonly markets: readonly MarketSummary[];
  readonly selectedCanonicalId: string | null;
  readonly visible: boolean;
  readonly isFetchingNextPage?: boolean;
  readonly loading?: boolean;
  readonly onClose: () => void;
  readonly onEndReached?: () => void;
  readonly onQueryChange?: (query: string) => void;
  readonly onSelect: (canonicalId: string) => void;
  readonly filterQuery?: string;
  readonly query?: string;
  readonly status?: ReactNode;
  readonly total?: number;
}): JSX.Element {
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const accent = useThemeColor("accent");
  const background = useThemeColor("background");
  const [localQuery, setLocalQuery] = useState("");
  const query = controlledQuery ?? localQuery;
  const appliedQuery = filterQuery ?? query;
  const setQuery = onQueryChange ?? setLocalQuery;
  const filtered = useMemo(
    () =>
      visible
        ? discoverMarkets(markets, {
            query: appliedQuery,
            families: [],
            includeHip3: ACTIVE_MARKET_CATALOG_FILTERS.includeHip3,
            availability: ACTIVE_MARKET_CATALOG_FILTERS.availability,
            lifecycle: ACTIVE_MARKET_CATALOG_FILTERS.lifecycle,
            favoritesOnly: false,
            recentsOnly: false,
            favoriteIds: EMPTY_IDS,
            recentIds: EMPTY_IDS,
            sort: appliedQuery.trim() === "" ? "volume" : "symbol",
          })
        : EMPTY_MARKETS,
    [appliedQuery, markets, visible],
  );

  const clearQuery = () => {
    setLocalQuery("");
    onQueryChange?.("");
  };

  const requestClose = () => {
    if (Keyboard.isVisible()) {
      Keyboard.dismiss();
      return;
    }
    clearQuery();
    onClose();
  };

  return (
    <Modal
      animationType={reducedMotion ? "none" : "fade"}
      backdropColor={background}
      onRequestClose={requestClose}
      presentationStyle="fullScreen"
      statusBarTranslucent
      visible={visible}
    >
      <View className="flex-1 bg-background" testID="market-switcher-surface">
        <KeyboardAwareView className="flex-1">
          <FlatList
            className="flex-1 bg-background"
            contentContainerClassName="gap-1 px-5"
            contentContainerStyle={{
              paddingTop: Math.max(insets.top, 20),
              paddingBottom: Math.max(insets.bottom, 24),
            }}
            data={filtered}
            initialNumToRender={8}
            keyboardDismissMode={
              Platform.OS === "ios" ? "interactive" : "on-drag"
            }
            keyboardShouldPersistTaps="handled"
            keyExtractor={(market) => market.canonicalId}
            ListEmptyComponent={
              loading ? (
                <View className="min-h-32 items-center justify-center">
                  <ActivityIndicator accessibilityLabel="Loading markets" />
                </View>
              ) : (
                <Card variant="secondary">
                  <Card.Body className="gap-2">
                    <Card.Title>No markets match</Card.Title>
                    <Card.Description>
                      Try another symbol or venue.
                    </Card.Description>
                  </Card.Body>
                </Card>
              )
            }
            ListFooterComponent={
              isFetchingNextPage ? (
                <View className="h-14 items-center justify-center">
                  <ActivityIndicator accessibilityLabel="Loading more markets" />
                </View>
              ) : null
            }
            ListHeaderComponent={
              <View className="gap-4 pb-2">
                <View className="flex-row flex-wrap items-start justify-between gap-3">
                  <View className="min-w-52 flex-1 gap-1">
                    <Text
                      accessibilityRole="header"
                      className="text-3xl font-semibold text-foreground"
                    >
                      Switch market
                    </Text>
                    <Text className="text-sm leading-5 text-muted">
                      Choose the market you want to trade or follow.
                    </Text>
                  </View>
                  <Button
                    accessibilityHint="Closes the market selector."
                    accessibilityLabel="Close market selector"
                    animation={reducedMotion ? "disable-all" : undefined}
                    className="h-12 min-h-12 w-12 min-w-12 px-0"
                    onPress={requestClose}
                    variant="tertiary"
                  >
                    <Ionicons
                      accessibilityElementsHidden
                      color={accent}
                      importantForAccessibility="no-hide-descendants"
                      name="close"
                      size={22}
                    />
                  </Button>
                </View>
                <SearchField
                  animation={reducedMotion ? "disable-all" : undefined}
                  onChange={setQuery}
                  value={query}
                >
                  <SearchField.Group>
                    <SearchField.SearchIcon iconProps={{ color: accent }} />
                    <SearchField.Input
                      accessibilityHint="Searches market names, symbols, and venues."
                      accessibilityLabel="Search markets"
                      autoCapitalize="none"
                      autoCorrect={false}
                      autoFocus
                      placeholder="Search markets"
                      returnKeyType="search"
                    />
                  </SearchField.Group>
                </SearchField>
                {status}
                <Text
                  accessibilityLiveRegion="polite"
                  className="text-sm text-muted"
                >
                  {total === undefined || total === filtered.length
                    ? `${filtered.length} markets shown`
                    : `${filtered.length} of ${total} markets`}
                </Text>
              </View>
            }
            renderItem={({ item }) => {
              const selected = item.canonicalId === selectedCanonicalId;
              const availability =
                item.lifecycle !== "active"
                  ? "Unavailable"
                  : item.orderAvailability === "enabled"
                    ? "Trading"
                    : "View only";
              const primaryLabel =
                item.family === "outcome"
                  ? marketDisplayLabel(item)
                  : marketPairLabel(item);
              const maxLeverage =
                item.family === "perp" ? item.maxLeverage : null;
              const provider =
                item.family === "perp" &&
                item.dexIndex !== 0 &&
                item.dexName !== ""
                  ? item.dexName
                  : null;
              const accessibilityDetails = [
                maxLeverage === null ? null : `${maxLeverage}x max leverage`,
                provider === null ? null : `${provider} provider`,
                availability,
              ]
                .filter((detail) => detail !== null)
                .join(", ");
              return (
                <Button
                  accessibilityLabel={`${selected ? "Selected, " : ""}${primaryLabel}, ${accessibilityDetails}`}
                  accessibilityState={{ selected }}
                  animation={reducedMotion ? "disable-all" : undefined}
                  className="min-h-14 w-full justify-start gap-3 rounded-xl px-3 py-2"
                  isDisabled={item.lifecycle !== "active"}
                  onPress={() => {
                    Keyboard.dismiss();
                    onSelect(item.canonicalId);
                    clearQuery();
                    onClose();
                  }}
                  size="sm"
                  variant={selected ? "secondary" : "ghost"}
                >
                  <MarketIcon market={item} />
                  <View className="min-w-0 flex-1 flex-row items-center gap-2">
                    <Text
                      className="min-w-0 shrink text-base font-semibold text-foreground"
                      numberOfLines={1}
                    >
                      {primaryLabel}
                    </Text>
                    {maxLeverage === null ? null : (
                      <Text className="rounded-md bg-accent/10 px-1.5 py-0.5 text-xs font-semibold text-accent">
                        {maxLeverage}x
                      </Text>
                    )}
                    {provider === null ? null : (
                      <Text
                        className="max-w-24 rounded-md bg-surface-secondary px-1.5 py-0.5 text-xs text-muted"
                        numberOfLines={1}
                      >
                        {provider}
                      </Text>
                    )}
                    {availability === "Trading" ? null : (
                      <Text className="rounded-md bg-warning/10 px-1.5 py-0.5 text-xs text-warning">
                        {availability}
                      </Text>
                    )}
                  </View>
                  {selected ? (
                    <Ionicons
                      accessibilityElementsHidden
                      color={accent}
                      importantForAccessibility="no-hide-descendants"
                      name="checkmark-circle"
                      size={22}
                    />
                  ) : null}
                </Button>
              );
            }}
            onEndReached={onEndReached}
            onEndReachedThreshold={0.5}
            maxToRenderPerBatch={6}
            showsVerticalScrollIndicator={false}
            updateCellsBatchingPeriod={32}
            windowSize={5}
          />
        </KeyboardAwareView>
      </View>
    </Modal>
  );
}
