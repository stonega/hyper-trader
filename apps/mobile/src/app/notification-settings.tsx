import { Redirect, useRouter } from "expo-router";
import { Button } from "heroui-native/button";
import { Card } from "heroui-native/card";
import { Input } from "heroui-native/input";
import { Label } from "heroui-native/label";
import { TextField } from "heroui-native/text-field";
import type { JSX } from "react";
import { useEffect, useMemo, useState } from "react";
import { BackHandler, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText as Text } from "../components/app-text";
import { KeyboardAwareView } from "../components/keyboard-aware-view";
import { ScreenHeading } from "../components/screen-heading";
import { useReducedMotion } from "../components/use-reduced-motion";
import { useTradingContext } from "../core/context/provider";
import { marketDisplayLabel } from "../features/markets/discovery";
import { MarketSwitcher } from "../features/markets/market-switcher";
import { useMarketPreferences } from "../features/markets/preferences-provider";
import { useMarketCatalogPresentation } from "../features/markets/query";
import { NOTIFICATION_SETTINGS_AVAILABLE } from "../features/notifications/availability";
import { notificationSettingsConsumesBack } from "../features/notifications/model";
import { useNotificationRuntime } from "../features/notifications/provider";
import { randomNotificationHex } from "../features/notifications/random-id";

export default function NotificationSettingsScreen(): JSX.Element {
  if (!NOTIFICATION_SETTINGS_AVAILABLE) {
    return <Redirect href="/(tabs)/settings" />;
  }
  return <NotificationSettingsContent />;
}

function NotificationSettingsContent(): JSX.Element {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const { current } = useTradingContext();
  const notifications = useNotificationRuntime();
  const marketPreferences = useMarketPreferences();
  const { catalog } = useMarketCatalogPresentation(current.network);
  const [marketId, setMarketId] = useState("");
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [threshold, setThreshold] = useState("");
  const [direction, setDirection] = useState<"price_above" | "price_below">(
    "price_above",
  );
  const busy = notificationSettingsConsumesBack(notifications.phase);
  const alertMarkets = useMemo(
    () =>
      catalog?.markets.filter((market) => market.lifecycle === "active") ?? [],
    [catalog?.markets],
  );
  const selectedMarket =
    alertMarkets.find((market) => market.canonicalId === marketId) ?? null;
  const marketName = (canonicalId: string) => {
    const market = catalog?.markets.find(
      (candidate) => candidate.canonicalId === canonicalId,
    );
    return market ? marketDisplayLabel(market) : "Market alert";
  };

  useEffect(() => {
    if (marketId !== "" || alertMarkets.length === 0) return;
    const preferred = alertMarkets.find(
      (market) =>
        market.canonicalId === marketPreferences.preferences.lastMarketId,
    );
    setMarketId((preferred ?? alertMarkets[0])?.canonicalId ?? "");
  }, [alertMarkets, marketId, marketPreferences.preferences.lastMarketId]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => busy,
    );
    return () => subscription.remove();
  }, [busy]);

  const addPriceAlert = async () => {
    const ruleId = await randomNotificationHex(16);
    await notifications.enablePriceAlert({
      ruleId,
      scope: "price",
      network: current.network,
      marketId: marketId.trim(),
      eventType: direction,
      threshold: threshold.trim(),
    });
  };

  return (
    <>
      <KeyboardAwareView className="flex-1 bg-background">
        <ScrollView
          className="flex-1 bg-background"
          contentContainerClassName="gap-5 px-5 pb-12"
          contentContainerStyle={{ paddingTop: Math.max(insets.top, 20) }}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Button
            animation={reducedMotion ? "disable-all" : undefined}
            className="min-h-12 self-start"
            isDisabled={busy}
            onPress={() => router.back()}
            variant="ghost"
          >
            Back to settings
          </Button>
          <ScreenHeading
            title="Notifications"
            description="Price alerts for markets you follow."
            network={current.network}
            accountLabel={
              current.targetAccount === null
                ? "no account · price alerts only"
                : `target …${current.targetAccount.slice(-6)}`
            }
            showContext={false}
          />

          {notifications.message ? (
            <Text
              accessibilityLiveRegion="polite"
              accessibilityRole="alert"
              className="text-sm leading-5 text-warning"
            >
              {notifications.message}
            </Text>
          ) : null}

          <Card variant="secondary">
            <Card.Body className="gap-4">
              <Card.Title>Add price alert</Card.Title>
              <Card.Description>
                Choose a market and price. No account is required.
              </Card.Description>
              <Button
                accessibilityLabel={
                  selectedMarket
                    ? `Change market. ${marketDisplayLabel(selectedMarket)}`
                    : "Choose a market"
                }
                animation={reducedMotion ? "disable-all" : undefined}
                className="min-h-12 w-full"
                onPress={() => setSwitcherOpen(true)}
                variant="secondary"
              >
                {selectedMarket
                  ? `Market · ${marketDisplayLabel(selectedMarket)}`
                  : "Choose market"}
              </Button>
              <View className="flex-row gap-2">
                <Button
                  accessibilityState={{ selected: direction === "price_above" }}
                  animation={reducedMotion ? "disable-all" : undefined}
                  className="min-h-12 flex-1"
                  onPress={() => setDirection("price_above")}
                  variant={
                    direction === "price_above" ? "secondary" : "outline"
                  }
                >
                  Price above
                </Button>
                <Button
                  accessibilityState={{ selected: direction === "price_below" }}
                  animation={reducedMotion ? "disable-all" : undefined}
                  className="min-h-12 flex-1"
                  onPress={() => setDirection("price_below")}
                  variant={
                    direction === "price_below" ? "secondary" : "outline"
                  }
                >
                  Price below
                </Button>
              </View>
              <TextField animation={reducedMotion ? "disable-all" : undefined}>
                <Label>Threshold</Label>
                <Input
                  keyboardType="decimal-pad"
                  onChangeText={setThreshold}
                  placeholder="0"
                  value={threshold}
                />
              </TextField>
              <Button
                animation={reducedMotion ? "disable-all" : undefined}
                className="min-h-12 w-full"
                isDisabled={
                  busy || marketId.trim() === "" || threshold.trim() === ""
                }
                onPress={() => void addPriceAlert()}
                variant="primary"
              >
                Add price alert
              </Button>
            </Card.Body>
          </Card>

          {notifications.snapshot?.rules.map((rule) => (
            <Card key={rule.ruleId} variant="secondary">
              <Card.Body className="gap-3">
                <Card.Title>{rule.eventType.replaceAll("_", " ")}</Card.Title>
                <Card.Description>
                  {marketName(rule.marketId)} · {rule.network} ·{" "}
                  {rule.threshold}
                </Card.Description>
                {rule.scope === "price" ? (
                  <Button
                    animation={reducedMotion ? "disable-all" : undefined}
                    className="min-h-12 w-full"
                    isDisabled={busy}
                    onPress={() =>
                      void notifications.deletePriceAlert(rule.ruleId)
                    }
                    variant="danger"
                  >
                    Delete price alert
                  </Button>
                ) : null}
              </Card.Body>
            </Card>
          ))}

          {notifications.snapshot || notifications.revocationPending ? (
            <Card variant="secondary">
              <Card.Body className="gap-3">
                <Card.Title>Revoke this device</Card.Title>
                <Card.Description>
                  {notifications.revocationPending
                    ? "Notifications are still active. Try again."
                    : "Stops notifications on this device."}
                </Card.Description>
                <Button
                  animation={reducedMotion ? "disable-all" : undefined}
                  className="min-h-12 w-full"
                  isDisabled={busy}
                  onPress={() => void notifications.revokeDevice()}
                  variant="danger"
                >
                  {notifications.revocationPending
                    ? "Retry device revocation"
                    : "Revoke notification device"}
                </Button>
              </Card.Body>
            </Card>
          ) : null}
        </ScrollView>
      </KeyboardAwareView>
      <MarketSwitcher
        markets={alertMarkets}
        onClose={() => setSwitcherOpen(false)}
        onSelect={setMarketId}
        selectedCanonicalId={marketId || null}
        visible={switcherOpen}
      />
    </>
  );
}
