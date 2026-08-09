import { useRouter } from "expo-router";
import { Button } from "heroui-native/button";
import { Card } from "heroui-native/card";
import type { JSX } from "react";
import { useEffect, useReducer, useRef } from "react";
import { ScrollView, Text, View } from "react-native";
import Animated, { FadeIn, ReduceMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useReducedMotion } from "../components/use-reduced-motion";
import { TRADE_ROUTE } from "../features/onboarding/routes";
import {
  reduceWelcomePhase,
  type WelcomeChoice,
  welcomePhaseTransitionDurationMs,
} from "../features/onboarding/state";
import { completeOnboarding } from "../features/onboarding/storage";

export default function WelcomeScreen(): JSX.Element {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const [phase, dispatch] = useReducer(reduceWelcomePhase, "ready");
  const operation = useRef(0);
  const submitting = useRef(false);

  useEffect(
    () => () => {
      operation.current += 1;
    },
    [],
  );

  const choose = async (choice: WelcomeChoice) => {
    if (phase === "persisting" || submitting.current) {
      return;
    }
    submitting.current = true;
    const currentOperation = ++operation.current;
    dispatch({ type: "choose" });
    try {
      await completeOnboarding(choice);
      if (currentOperation !== operation.current) {
        return;
      }
      router.replace(TRADE_ROUTE);
    } catch {
      if (currentOperation === operation.current) {
        submitting.current = false;
        dispatch({ type: "failed" });
      }
    }
  };

  const transitionDuration = welcomePhaseTransitionDurationMs(reducedMotion);
  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="justify-between gap-10 px-5"
      contentContainerStyle={{
        flexGrow: 1,
        paddingTop: Math.max(insets.top, 32),
        paddingBottom: Math.max(insets.bottom, 24),
      }}
    >
      <View className="gap-5 pt-8">
        <Text
          accessibilityRole="header"
          className="text-5xl font-semibold tracking-tight text-foreground"
        >
          Hyper Trader
        </Text>
        <Text className="text-xl leading-8 text-foreground">
          Explore every validated Hyperliquid market now. Set up trading only
          when you are ready for a dedicated approval flow.
        </Text>
        <Text className="text-base leading-6 text-muted">
          Hyper Trader never handles your master seed or master private key. A
          later dedicated API-wallet key will be protected on this device after
          external master-wallet approval.
        </Text>
      </View>

      <Card variant="default" className="gap-4">
        <Card.Body className="gap-2">
          <Card.Title>Choose how to begin</Card.Title>
          <Card.Description>
            Both choices enter the same read-only Trade screen. Setup saves only
            an untrusted intent; it does not create authority or a key.
          </Card.Description>
          {phase === "failed" ? (
            <Animated.View
              accessibilityLiveRegion="assertive"
              entering={FadeIn.duration(transitionDuration).reduceMotion(
                ReduceMotion.System,
              )}
            >
              <Text accessibilityRole="alert" className="text-sm text-danger">
                Your choice could not be saved. Nothing changed. Try again.
              </Text>
            </Animated.View>
          ) : null}
        </Card.Body>
        <Card.Footer className="flex-col gap-3">
          <Button
            accessibilityHint="Saves a setup intent and opens the read-only Trade tab. No wallet approval occurs yet."
            animation={reducedMotion ? "disable-all" : undefined}
            className="min-h-12 w-full"
            isDisabled={phase === "persisting"}
            onPress={() => void choose("setup")}
            variant="primary"
          >
            {phase === "persisting" ? "Saving choice…" : "Set up trading"}
          </Button>
          <Button
            accessibilityHint="Completes Welcome and opens Trade without a setup intent."
            animation={reducedMotion ? "disable-all" : undefined}
            className="min-h-12 w-full"
            isDisabled={phase === "persisting"}
            onPress={() => void choose("read_only")}
            variant="secondary"
          >
            Explore read-only
          </Button>
        </Card.Footer>
      </Card>
    </ScrollView>
  );
}
