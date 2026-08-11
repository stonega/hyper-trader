import { useRouter } from "expo-router";
import { Button } from "heroui-native/button";
import { Card } from "heroui-native/card";
import type { JSX } from "react";
import { useEffect, useReducer } from "react";
import { BackHandler, ScrollView, View } from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  ReduceMotion,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText as Text } from "../../components/app-text";
import { useReducedMotion } from "../../components/use-reduced-motion";
import {
  INITIAL_SETUP_FLOW,
  reduceSetupFlow,
  setupConsumesBack,
} from "../../features/accounts/setup-flow";
import { REOWN_RUNTIME_GATE } from "../../platform/wallet/reown-adapter";

const PHASE_COPY = {
  connect: {
    title: "Connect your master wallet",
    description:
      "Your master wallet stays external. Hyper Trader requests one testnet approval for a dedicated API wallet and never asks for a seed phrase or master private key.",
  },
  target: {
    title: "Choose the exact account",
    description:
      "The credential is permanently bound to one master account and one selected master, sub-account, or vault target.",
  },
  slot: {
    title: "Check the named agent slot",
    description:
      "Hyper Trader checks authoritative account state before creating or replacing its stable named agent.",
  },
  review: {
    title: "Review testnet authority",
    description:
      "The authorization lasts 30 days. The key is staged in device-protected storage before the wallet handoff and can sign only for this exact target.",
  },
  handoff: {
    title: "Approve in your wallet",
    description:
      "Keep this screen open. Returning to the app never proves approval by itself.",
  },
  verifying: {
    title: "Verify registration",
    description:
      "Hyper Trader is checking authoritative agent state, account relationship, name, address, and expiry.",
  },
  activating: {
    title: "Protect this device",
    description:
      "The verified binding is activating atomically. Leaving is paused until the local checkpoint is safe.",
  },
  failure: {
    title: "Setup is safely paused",
    description:
      "No callback or wallet return created authority. You can retry this step or continue browsing read-only.",
  },
  ready: {
    title: "Trading setup is ready",
    description:
      "Device authentication unlocks one non-sliding five-minute signing session. Every action still has its own review.",
  },
} as const;

export default function SetupScreen(): JSX.Element {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const [state, dispatch] = useReducer(reduceSetupFlow, INITIAL_SETUP_FLOW);
  const copy = PHASE_COPY[state.phase];

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        if (setupConsumesBack(state.phase)) return true;
        if (state.phase === "connect" || state.phase === "failure") {
          router.back();
          return true;
        }
        dispatch({ type: "BACK" });
        return true;
      },
    );
    return () => subscription.remove();
  }, [router, state.phase]);

  useEffect(() => {
    if (state.phase === "ready") router.replace("/(tabs)/trade");
  }, [router, state.phase]);

  const duration = reducedMotion ? 0 : 160;
  const reportRuntimeGate = () => {
    dispatch({
      type: "RUNTIME_UNAVAILABLE",
      reason: REOWN_RUNTIME_GATE.reason,
    });
  };

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="gap-6 px-5"
      contentContainerStyle={{
        flexGrow: 1,
        paddingTop: Math.max(insets.top, 24),
        paddingBottom: Math.max(insets.bottom, 24),
      }}
    >
      <View className="gap-2">
        <Text className="text-sm font-medium text-accent">Testnet setup</Text>
        <Text
          accessibilityRole="header"
          className="text-4xl font-semibold tracking-tight text-foreground"
        >
          Dedicated trading access
        </Text>
        <Text className="text-base leading-6 text-muted">
          Step {state.phase === "failure" ? "paused" : "1 of 5"} · Master
          credentials never enter Hyper Trader.
        </Text>
      </View>

      <Card variant="default" className="min-h-72 gap-4">
        <Card.Body className="gap-4">
          <Animated.View
            key={state.phase}
            className="gap-3"
            entering={FadeIn.duration(duration).reduceMotion(
              ReduceMotion.System,
            )}
            exiting={FadeOut.duration(Math.min(duration, 100)).reduceMotion(
              ReduceMotion.System,
            )}
          >
            <Card.Title>{copy.title}</Card.Title>
            <Card.Description>{copy.description}</Card.Description>
            {state.phase === "connect" ? (
              <View className="gap-2 rounded-2xl bg-surface-secondary p-4">
                <Text className="font-medium text-foreground">Network</Text>
                <Text className="text-base text-muted">
                  Hyperliquid testnet
                </Text>
                <Text className="mt-2 font-medium text-foreground">
                  Authorization
                </Text>
                <Text className="text-base leading-6 text-muted">
                  Named API wallet · one exact target · 30 days
                </Text>
              </View>
            ) : null}
            {state.phase === "failure" ? (
              <Text accessibilityRole="alert" className="text-sm text-warning">
                External wallet setup is disabled in this build until the
                reviewed Reown project, redirect allowlist, and physical-device
                custody evidence are approved together.
              </Text>
            ) : null}
          </Animated.View>
        </Card.Body>
        <Card.Footer className="flex-col gap-3">
          {state.phase === "connect" ? (
            <Button
              animation={reducedMotion ? "disable-all" : undefined}
              className="min-h-12 w-full"
              onPress={reportRuntimeGate}
              variant="primary"
            >
              Check wallet availability
            </Button>
          ) : null}
          {state.phase === "failure" ? (
            <Button
              animation={reducedMotion ? "disable-all" : undefined}
              className="min-h-12 w-full"
              onPress={() => dispatch({ type: "INTERRUPT" })}
              variant="secondary"
            >
              Review setup again
            </Button>
          ) : null}
          {!setupConsumesBack(state.phase) ? (
            <Button
              animation={reducedMotion ? "disable-all" : undefined}
              className="min-h-12 w-full"
              onPress={() => router.replace("/(tabs)/trade")}
              variant="tertiary"
            >
              Continue read-only
            </Button>
          ) : null}
        </Card.Footer>
      </Card>
    </ScrollView>
  );
}
