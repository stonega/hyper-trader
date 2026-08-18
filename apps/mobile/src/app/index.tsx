import { Redirect, useRouter } from "expo-router";
import { Button } from "heroui-native/button";
import { Card } from "heroui-native/card";
import { Skeleton } from "heroui-native/skeleton";
import type { JSX } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useReducedMotion } from "../components/use-reduced-motion";
import { TRADE_ROUTE, WELCOME_ROUTE } from "../features/onboarding/routes";
import {
  decideLaunchDestination,
  type LaunchDestination,
} from "../features/onboarding/state";
import { loadOnboardingState } from "../features/onboarding/storage";

type LaunchState =
  | { readonly phase: "loading" }
  | { readonly phase: "resolved"; readonly destination: LaunchDestination };

export default function LaunchScreen(): JSX.Element {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const [state, setState] = useState<LaunchState>({ phase: "loading" });
  const operation = useRef(0);

  const resolveLaunch = useCallback(async () => {
    const currentOperation = ++operation.current;
    setState({ phase: "loading" });
    const result = await loadOnboardingState();
    if (currentOperation !== operation.current) {
      return;
    }
    setState({
      phase: "resolved",
      destination: decideLaunchDestination(result),
    });
  }, []);

  useEffect(() => {
    void resolveLaunch();
    return () => {
      operation.current += 1;
    };
  }, [resolveLaunch]);

  if (state.phase === "resolved" && state.destination === "welcome") {
    return <Redirect href={WELCOME_ROUTE} />;
  }
  if (state.phase === "resolved" && state.destination === "trade") {
    return <Redirect href={TRADE_ROUTE} />;
  }

  const failed = state.phase === "resolved" && state.destination === "failure";
  return (
    <View
      accessibilityLiveRegion="polite"
      className="flex-1 justify-center bg-background px-5"
      style={{
        paddingTop: Math.max(insets.top, 24),
        paddingBottom: Math.max(insets.bottom, 24),
      }}
    >
      <Card variant="default" className="gap-5">
        <Card.Body className="gap-3">
          <Card.Title>
            {failed ? "Launch preference unavailable" : "Hyper Trader"}
          </Card.Title>
          <Card.Description accessibilityRole={failed ? "alert" : undefined}>
            {failed
              ? "The saved onboarding state could not be trusted. No account, network, or wallet authority was changed."
              : "Loading your read-only trading workspace."}
          </Card.Description>
          {!failed ? (
            <View
              accessibilityLabel="Loading onboarding preference"
              className="gap-3"
            >
              <Skeleton
                animation={reducedMotion ? "disable-all" : undefined}
                className="h-4 w-full rounded-md"
                variant={reducedMotion ? "none" : "shimmer"}
              />
              <Skeleton
                animation={reducedMotion ? "disable-all" : undefined}
                className="h-4 w-2/3 rounded-md"
                variant={reducedMotion ? "none" : "shimmer"}
              />
            </View>
          ) : null}
        </Card.Body>
        {failed ? (
          <Card.Footer className="flex-col gap-3">
            <Button
              accessibilityHint="Attempts to read the saved onboarding state again."
              animation={reducedMotion ? "disable-all" : undefined}
              className="min-h-11 w-full"
              onPress={() => void resolveLaunch()}
            >
              Retry
            </Button>
            <Button
              accessibilityHint="Opens Welcome without treating onboarding as completed."
              animation={reducedMotion ? "disable-all" : undefined}
              className="min-h-11 w-full"
              onPress={() => router.replace(WELCOME_ROUTE)}
              variant="secondary"
            >
              Open Welcome safely
            </Button>
          </Card.Footer>
        ) : null}
      </Card>
    </View>
  );
}
