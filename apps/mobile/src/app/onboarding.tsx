import Ionicons from "@expo/vector-icons/Ionicons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { Button } from "heroui-native/button";
import { Card } from "heroui-native/card";
import { useThemeColor } from "heroui-native/hooks";
import type { JSX } from "react";
import { useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../components/app-text";
import { useReducedMotion } from "../components/use-reduced-motion";
import { completeFirstUseOnboarding } from "../features/onboarding/first-use";
import { SETUP_ROUTE, TRADE_ROUTE } from "../navigation/routes";

type OnboardingDestination = typeof SETUP_ROUTE | typeof TRADE_ROUTE;

export default function OnboardingScreen(): JSX.Element {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const [accent, foreground, accentForeground] = useThemeColor([
    "accent",
    "foreground",
    "accent-foreground",
  ]);
  const navigating = useRef(false);
  const [destination, setDestination] = useState<OnboardingDestination | null>(
    null,
  );

  const finishOnboarding = async (next: OnboardingDestination) => {
    if (navigating.current) return;
    navigating.current = true;
    setDestination(next);

    try {
      await completeFirstUseOnboarding(AsyncStorage);
    } catch {
      // A presentation preference must never block read-only access or setup.
    }

    router.replace(next);
  };

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="px-5"
      contentContainerStyle={{
        flexGrow: 1,
        paddingTop: Math.max(insets.top, 24),
        paddingBottom: Math.max(insets.bottom, 24),
      }}
    >
      <View className="flex-1 justify-between gap-10">
        <View className="gap-8">
          <View className="flex-row items-center gap-3">
            <View className="size-10 items-center justify-center rounded-2xl bg-accent">
              <Text className="text-base font-bold text-accent-foreground">
                HT
              </Text>
            </View>
            <Text className="text-base font-semibold text-foreground">
              Hyper Trader
            </Text>
          </View>

          <View className="gap-4">
            <Text className="text-sm font-medium text-accent">
              Trade without sharing your master key
            </Text>
            <Text
              accessibilityRole="header"
              className="text-5xl font-semibold leading-tight tracking-tight text-foreground"
            >
              A safer way to trade.
            </Text>
            <Text className="max-w-md text-lg leading-7 text-muted">
              API wallets can trade for you, but cannot withdraw your funds.
            </Text>
          </View>

          <Card variant="secondary" className="gap-4">
            <Card.Body className="gap-5">
              <View
                accessible
                accessibilityLabel="Your master wallet stays with you. A dedicated API wallet is protected on this device."
                className="flex-row items-center"
              >
                <View className="w-28 items-center gap-3">
                  <View className="size-16 items-center justify-center rounded-3xl bg-background">
                    <Ionicons
                      accessibilityElementsHidden
                      color={foreground}
                      importantForAccessibility="no-hide-descendants"
                      name="wallet-outline"
                      size={28}
                    />
                  </View>
                  <View className="items-center gap-1">
                    <Text className="text-sm font-semibold text-foreground">
                      Master wallet
                    </Text>
                    <Text className="text-xs text-muted">Stays with you</Text>
                  </View>
                </View>

                <View className="flex-1 flex-row items-center px-2">
                  <View className="h-px flex-1 bg-divider" />
                  <Ionicons
                    accessibilityElementsHidden
                    color={accent}
                    importantForAccessibility="no-hide-descendants"
                    name="arrow-forward"
                    size={18}
                  />
                  <View className="h-px flex-1 bg-divider" />
                </View>

                <View className="w-28 items-center gap-3">
                  <View className="size-16 items-center justify-center rounded-3xl bg-accent">
                    <Ionicons
                      accessibilityElementsHidden
                      color={accentForeground}
                      importantForAccessibility="no-hide-descendants"
                      name="shield-checkmark-outline"
                      size={30}
                    />
                  </View>
                  <View className="items-center gap-1">
                    <Text className="text-sm font-semibold text-foreground">
                      API wallet
                    </Text>
                    <Text className="text-xs text-muted">Protected here</Text>
                  </View>
                </View>
              </View>

              <View className="h-px bg-divider" />
              <Text className="text-sm leading-5 text-muted">
                Authorize the public API-wallet address on Hyperliquid. Hyper
                Trader never asks for your seed phrase or master private key.
              </Text>
            </Card.Body>
          </Card>
        </View>

        <View className="gap-3">
          <Button
            accessibilityHint="Starts API-wallet setup."
            animation={reducedMotion ? "disable-all" : undefined}
            className="min-h-12 w-full"
            isDisabled={destination !== null}
            onPress={() => void finishOnboarding(SETUP_ROUTE)}
            variant="primary"
          >
            {destination === SETUP_ROUTE
              ? "Opening setup…"
              : "Set up API wallet"}
          </Button>
          <Button
            accessibilityHint="Opens read-only Trade. API-wallet setup remains available in Settings."
            animation={reducedMotion ? "disable-all" : undefined}
            className="min-h-12 w-full"
            isDisabled={destination !== null}
            onPress={() => void finishOnboarding(TRADE_ROUTE)}
            variant="tertiary"
          >
            {destination === TRADE_ROUTE ? "Opening Trade…" : "Skip for now"}
          </Button>
          <Text className="text-center text-sm leading-5 text-muted">
            You can set this up anytime from Settings.
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}
