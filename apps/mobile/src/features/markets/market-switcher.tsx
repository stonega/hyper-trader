import type { Market } from "@hyper-trader/hyperliquid/public";
import { Button } from "heroui-native/button";
import { Card } from "heroui-native/card";
import { Input } from "heroui-native/input";
import { Label } from "heroui-native/label";
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
  marketVenueLabel,
} from "./discovery";

const EMPTY_IDS: readonly string[] = [];

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
  const [query, setQuery] = useState("");
  const filtered = useMemo(
    () =>
      discoverMarkets(markets, {
        query,
        families: [],
        availability: "all",
        lifecycle: "all",
        favoritesOnly: false,
        recentsOnly: false,
        favoriteIds: EMPTY_IDS,
        recentIds: EMPTY_IDS,
        sort: query.trim() === "" ? "volume" : "symbol",
      }),
    [markets, query],
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
      onRequestClose={requestClose}
      presentationStyle="fullScreen"
      statusBarTranslucent
      visible={visible}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        className="flex-1 bg-background"
      >
        <FlatList
          contentContainerClassName="gap-3 px-5"
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
                  Search display name, venue, coin, token, outcome, or canonical
                  identity.
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
                    Every validated catalog identity is searchable. Selecting
                    one does not change account or network.
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
              <TextField animation={reducedMotion ? "disable-all" : undefined}>
                <Label>Search every market</Label>
                <Input
                  accessibilityHint="Searches display symbol, venue, canonical ID, coin, token identity, and outcome text."
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoFocus
                  onChangeText={setQuery}
                  placeholder="Symbol, venue, or canonical ID"
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
                ? "Delisted · browse only"
                : item.orderAvailability === "enabled"
                  ? "Order metadata present"
                  : "Browse only";
            return (
              <Button
                accessibilityLabel={`${selected ? "Selected, " : ""}${marketDisplayLabel(item)}, ${marketVenueLabel(item)}, ${item.canonicalId}, ${availability}`}
                accessibilityState={{ selected }}
                animation={reducedMotion ? "disable-all" : undefined}
                className="min-h-16 w-full"
                onPress={() => {
                  Keyboard.dismiss();
                  onSelect(item.canonicalId);
                  setQuery("");
                  onClose();
                }}
                variant={selected ? "primary" : "secondary"}
              >
                {`${selected ? "Selected · " : ""}${marketDisplayLabel(item)} · ${marketVenueLabel(item)}\n${item.canonicalId} · ${availability}`}
              </Button>
            );
          }}
          showsVerticalScrollIndicator={false}
        />
      </KeyboardAvoidingView>
    </Modal>
  );
}
