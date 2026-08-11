import { useRouter } from "expo-router";
import { Button } from "heroui-native/button";
import { Card } from "heroui-native/card";
import type { JSX } from "react";
import { useEffect, useReducer, useRef } from "react";
import { ScrollView, View } from "react-native";
import Animated, { FadeIn, ReduceMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText as Text } from "../components/app-text";
import { IridescentRibbonBackground } from "../components/onboarding/iridescent-ribbon-background";
import { useReducedMotion } from "../components/use-reduced-motion";
import { welcomeChoiceRoute } from "../features/onboarding/routes";
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
      router.replace(welcomeChoiceRoute(choice));
    } catch {
      if (currentOperation === operation.current) {
        submitting.current = false;
        dispatch({ type: "failed" });
      }
    }
  };

  const transitionDuration = welcomePhaseTransitionDurationMs(reducedMotion);
  return (
    <View className="flex-1 bg-background">
      <IridescentRibbonBackground reducedMotion={reducedMotion} />
      <ScrollView
        className="flex-1"
        contentContainerClassName="justify-between gap-10 px-5"
        contentContainerStyle={{
          flexGrow: 1,
          paddingTop: Math.max(insets.top, 32),
          paddingBottom: Math.max(insets.bottom, 24),
        }}
        showsVerticalScrollIndicator={false}
      >
        <View className="gap-5 pt-8">
          <Text
            accessibilityRole="header"
            className="text-5xl font-semibold tracking-tight text-foreground"
          >
            Hyper Trader
          </Text>
          <Text className="text-xl leading-8 text-foreground">
            Explore every Hyperliquid market now, then set up secure testnet
            trading when you’re ready.
          </Text>
        </View>

        <Card variant="default" className="gap-4">
          {phase === "failed" ? (
            <Card.Body>
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
            </Card.Body>
          ) : null}
          <Card.Footer className="flex-col gap-3">
            <Button
              accessibilityHint="Saves a resumable setup intent and opens the dedicated testnet trading setup flow."
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
    </View>
  );
}
