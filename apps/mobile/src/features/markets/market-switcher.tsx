import Ionicons from "@expo/vector-icons/Ionicons";
import type { Market } from "@hyper-trader/hyperliquid/public";
import { Button } from "heroui-native/button";
import { Card } from "heroui-native/card";
import { useThemeColor } from "heroui-native/hooks";
import { Input } from "heroui-native/input";
import { TextField } from "heroui-native/text-field";
import type { JSX } from "react";
import { useMemo, useState } from "react";
import {
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText as Text } from "../../components/app-text";
import { useReducedMotion } from "../../components/use-reduced-motion";
import {
  discoverMarkets,
  marketDisplayLabel,
  marketPairLabel,
} from "./discovery";
import { MarketIcon } from "./market-icon";

const EMPTY_IDS: readonly string[] = [];
const EMPTY_MARKETS: readonly Market[] = [];

export function MarketSwitcher({
  markets,
  selectedCanonicalId,
  visible,
  onClose,
  onSelect,
}: {
  readonly markets: readonly Market[];
  readonly selectedCanonicalId: string | null;
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly onSelect: (canonicalId: string) => void;
}): JSX.Element {
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const accent = useThemeColor("accent");
  const background = useThemeColor("background");
  const [query, setQuery] = useState("");
  const filtered = useMemo(
    () =>
      visible
        ? discoverMarkets(markets, {
            query,
            families: [],
            availability: "all",
            lifecycle: "all",
            favoritesOnly: false,
            recentsOnly: false,
            favoriteIds: EMPTY_IDS,
            recentIds: EMPTY_IDS,
            sort: query.trim() === "" ? "volume" : "symbol",
          })
        : EMPTY_MARKETS,
    [markets, query, visible],
  );

  const requestClose = () => {
    if (Keyboard.isVisible()) {
      Keyboard.dismiss();
      return;
    }
    setQuery("");
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
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          className="flex-1"
        >
          <FlatList
            className="flex-1 bg-background"
            contentContainerClassName="gap-1 px-5"
            contentContainerStyle={{
              paddingTop: Math.max(insets.top, 20),
              paddingBottom: Math.max(insets.bottom, 24),
            }}
            data={filtered}
            initialNumToRender={16}
            keyboardDismissMode={
              Platform.OS === "ios" ? "interactive" : "on-drag"
            }
            keyboardShouldPersistTaps="handled"
            keyExtractor={(market) => market.canonicalId}
            ListEmptyComponent={
              <Card variant="secondary">
                <Card.Body className="gap-2">
                  <Card.Title>No markets match</Card.Title>
                  <Card.Description>
                    Try another symbol or venue.
                  </Card.Description>
                </Card.Body>
              </Card>
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
                    animation={reducedMotion ? "disable-all" : undefined}
                    className="min-h-12 min-w-24"
                    onPress={requestClose}
                    variant="tertiary"
                  >
                    Close
                  </Button>
                </View>
                <TextField
                  animation={reducedMotion ? "disable-all" : undefined}
                >
                  <Input
                    accessibilityHint="Searches market names, symbols, and venues."
                    accessibilityLabel="Search markets"
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoFocus
                    onChangeText={setQuery}
                    placeholder="Search symbol or venue"
                    returnKeyType="search"
                    value={query}
                  />
                </TextField>
                <Text
                  accessibilityLiveRegion="polite"
                  className="text-sm text-muted"
                >
                  {filtered.length} markets shown
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
                    setQuery("");
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
            showsVerticalScrollIndicator={false}
          />
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
