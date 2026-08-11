import { useRouter } from "expo-router";
import { Button } from "heroui-native/button";
import { Card } from "heroui-native/card";
import { Input } from "heroui-native/input";
import { Label } from "heroui-native/label";
import { TextField } from "heroui-native/text-field";
import type { JSX } from "react";
import { useEffect, useState } from "react";
import { BackHandler, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ScreenHeading } from "../components/screen-heading";
import { useReducedMotion } from "../components/use-reduced-motion";
import { useTradingContext } from "../core/context/provider";
import { notificationSettingsConsumesBack } from "../features/notifications/model";
import { useNotificationRuntime } from "../features/notifications/provider";
import { randomNotificationHex } from "../features/notifications/random-id";

const ACCOUNT_ALERTS = [
  "Fill",
  "Cancellation",
  "Rejection",
  "Margin risk",
  "Liquidation risk",
  "Funding above",
  "Funding below",
] as const;

export default function NotificationSettingsScreen(): JSX.Element {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const { current } = useTradingContext();
  const notifications = useNotificationRuntime();
  const [marketId, setMarketId] = useState("perp:BTC");
  const [threshold, setThreshold] = useState("");
  const [direction, setDirection] = useState<"price_above" | "price_below">(
    "price_above",
  );
  const busy = notificationSettingsConsumesBack(notifications.phase);

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
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="gap-5 px-5 pb-12"
      contentContainerStyle={{ paddingTop: Math.max(insets.top, 20) }}
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
        description="Create text-only alerts. Permission is requested only after you choose to add the first alert."
        network={current.network}
        accountLabel={
          current.targetAccount === null
            ? "no account · price alerts only"
            : `target …${current.targetAccount.slice(-6)}`
        }
      />

      <Text
        accessibilityLiveRegion="polite"
        accessibilityRole="alert"
        className="text-sm leading-5 text-warning"
      >
        {notifications.message}
      </Text>

      <Card variant="secondary">
        <Card.Body className="gap-4">
          <Card.Title>Delivery status</Card.Title>
          <Card.Description>
            Permission: {notifications.permission.replaceAll("_", " ")} · Token:{" "}
            {notifications.snapshot?.tokenState ?? "not registered"} · Delivery:{" "}
            {notifications.snapshot?.deliveryHealth ?? "not verified"}
          </Card.Description>
          <Button
            animation={reducedMotion ? "disable-all" : undefined}
            className="min-h-12 w-full"
            isDisabled={busy}
            onPress={() => void notifications.refresh()}
            variant="outline"
          >
            Refresh delivery status
          </Button>
        </Card.Body>
      </Card>

      <Card variant="secondary">
        <Card.Body className="gap-4">
          <Card.Title>Add price alert</Card.Title>
          <Card.Description>
            Enter an exact canonical market ID from Markets. Price alerts need
            no account or signing authority.
          </Card.Description>
          <TextField animation={reducedMotion ? "disable-all" : undefined}>
            <Label>Canonical market ID</Label>
            <Input
              accessibilityHint="Use the exact canonical identifier shown on the Markets screen."
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setMarketId}
              placeholder="perp:BTC"
              value={marketId}
            />
          </TextField>
          <View className="flex-row gap-2">
            <Button
              accessibilityState={{ selected: direction === "price_above" }}
              animation={reducedMotion ? "disable-all" : undefined}
              className="min-h-12 flex-1"
              onPress={() => setDirection("price_above")}
              variant={direction === "price_above" ? "secondary" : "outline"}
            >
              Price above
            </Button>
            <Button
              accessibilityState={{ selected: direction === "price_below" }}
              animation={reducedMotion ? "disable-all" : undefined}
              className="min-h-12 flex-1"
              onPress={() => setDirection("price_below")}
              variant={direction === "price_below" ? "secondary" : "outline"}
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
              {rule.marketId} · {rule.network} · threshold {rule.threshold}
            </Card.Description>
            {rule.scope === "price" ? (
              <Button
                animation={reducedMotion ? "disable-all" : undefined}
                className="min-h-12 w-full"
                isDisabled={busy}
                onPress={() => void notifications.deletePriceAlert(rule.ruleId)}
                variant="danger"
              >
                Delete price alert
              </Button>
            ) : (
              <Text className="text-sm leading-5 text-muted">
                Deleting this account alert requires fresh exact master-wallet
                proof.
              </Text>
            )}
          </Card.Body>
        </Card>
      ))}

      <Card variant="secondary">
        <Card.Body className="gap-3">
          <Card.Title>Account alerts</Card.Title>
          <Card.Description>
            Every account-rule change requires fresh proof from the exact master
            wallet. The current connector release gate is closed, so these
            controls are visible but cannot claim an account link or rule
            changed.
          </Card.Description>
          {ACCOUNT_ALERTS.map((label) => (
            <Button
              accessibilityHint="Unavailable until fresh master-wallet proof can be verified."
              className="min-h-12 w-full"
              isDisabled
              key={label}
              variant="outline"
            >
              {label} · proof required
            </Button>
          ))}
        </Card.Body>
      </Card>

      {notifications.snapshot || notifications.revocationPending ? (
        <Card variant="secondary">
          <Card.Body className="gap-3">
            <Card.Title>Revoke this device</Card.Title>
            <Card.Description>
              {notifications.revocationPending
                ? "Revocation is unresolved. Retry uses the same durable operation and keeps local authority until the service verifies inactive."
                : "Revocation may enter a draining state while provider submissions finish. The app keeps authority until the service verifies inactive."}
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
  );
}
