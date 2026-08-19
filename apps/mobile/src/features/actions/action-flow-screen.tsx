import { useRouter } from "expo-router";
import { Button } from "heroui-native/button";
import { Card } from "heroui-native/card";
import type { JSX } from "react";
import { useEffect, useState } from "react";
import { AccessibilityInfo, BackHandler, ScrollView, View } from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  ReduceMotion,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText as Text } from "../../components/app-text";
import { useReducedMotion } from "../../components/use-reduced-motion";
import { confirmationFailurePresentation } from "./presentation";
import { useActionRuntime } from "./runtime-provider";
import { type ActionFlowPhase, actionFlowConsumesBack } from "./state-machine";

const STATUS_COPY: Readonly<
  Record<
    ActionFlowPhase,
    { readonly title: string; readonly description: string }
  >
> = {
  review: {
    title: "Review action",
    description: "Check the details below. Nothing is signed yet.",
  },
  unlocking: {
    title: "Authenticating",
    description: "Confirm on this device to continue.",
  },
  refreshing: {
    title: "Authenticating",
    description: "Checking the latest market and account details.",
  },
  reserving: {
    title: "Authenticating",
    description: "Preparing your confirmed action.",
  },
  signing: {
    title: "Authenticating",
    description: "Signing the action on this device.",
  },
  submission_start: {
    title: "Submitting",
    description: "Sending the action to Hyperliquid.",
  },
  submitting: {
    title: "Submitting",
    description: "Sending the action to Hyperliquid.",
  },
  reconciling: {
    title: "Checking result",
    description: "Confirming the result with Hyperliquid.",
  },
  accepted: {
    title: "Action accepted",
    description: "Hyperliquid accepted the action.",
  },
  rejected: {
    title: "Action rejected",
    description: "Hyperliquid rejected the action.",
  },
  expired: {
    title: "Action expired",
    description: "The action expired before it completed.",
  },
  ambiguous: {
    title: "Manual review required",
    description:
      "The result is unclear. Check your account before trying again.",
  },
  failed_before_submission: {
    title: "Not submitted",
    description: "Review the current details before trying again.",
  },
};

const RESULT_PHASES: ReadonlySet<ActionFlowPhase> = new Set([
  "reconciling",
  "accepted",
  "rejected",
  "expired",
  "ambiguous",
]);

function accountLabel(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function ActionFlowScreen({
  mode,
}: {
  readonly mode: "review" | "result";
}): JSX.Element {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const runtime = useActionRuntime();
  const [failure, setFailure] = useState<string | null>(null);
  const { flow, review } = runtime;
  const copy = STATUS_COPY[flow.phase];
  const duration = reducedMotion ? 0 : 160;

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        if (actionFlowConsumesBack(flow.phase)) return true;
        runtime.clear();
        router.back();
        return true;
      },
    );
    return () => subscription.remove();
  }, [flow.phase, router, runtime]);

  useEffect(() => {
    void AccessibilityInfo.announceForAccessibility(copy.title);
  }, [copy.title]);

  useEffect(() => {
    if (mode === "review" && RESULT_PHASES.has(flow.phase)) {
      router.replace("/action-result");
    }
  }, [flow.phase, mode, router]);

  const confirm = async () => {
    setFailure(null);
    try {
      await runtime.confirm();
    } catch {
      const presentation = confirmationFailurePresentation(runtime.readFlow());
      setFailure(presentation.message);
      if (presentation.showResult) router.replace("/action-result");
    }
  };
  const dismiss = () => {
    runtime.clear();
    router.back();
  };

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="gap-5 px-5"
      contentContainerStyle={{
        flexGrow: 1,
        paddingTop: Math.max(insets.top, 24),
        paddingBottom: Math.max(insets.bottom, 24),
      }}
    >
      <View className="gap-2">
        <Text className="text-sm font-medium text-accent">Testnet action</Text>
        <Text
          accessibilityRole="header"
          className="text-3xl font-semibold text-foreground"
        >
          {copy.title}
        </Text>
        <Text className="text-base leading-6 text-muted">
          {copy.description}
        </Text>
      </View>

      <Card variant="default" className="min-h-80 gap-4">
        <Card.Body className="gap-4">
          <Animated.View
            key={flow.phase}
            className="gap-4"
            entering={FadeIn.duration(duration).reduceMotion(
              ReduceMotion.System,
            )}
            exiting={FadeOut.duration(Math.min(duration, 100)).reduceMotion(
              ReduceMotion.System,
            )}
          >
            {review === null ? (
              <View className="gap-2">
                <Card.Title>No reviewed action</Card.Title>
                <Card.Description>
                  Return to Trade or Portfolio and open a fresh action review.
                </Card.Description>
              </View>
            ) : (
              <View className="gap-3">
                {[
                  ["Network", review.presentation.network],
                  ["Account", accountLabel(review.presentation.account)],
                  ["Market", review.presentation.market],
                  ["Action", review.presentation.action],
                  ["Side", review.presentation.side],
                  ["Price", review.presentation.price],
                  ["Size", review.presentation.size],
                  ["Leverage / margin", review.presentation.leverageAndMargin],
                  ["Reduce only", review.presentation.reduceOnly],
                  ["Estimated fee", review.presentation.estimatedFee],
                  ["Slippage", review.presentation.slippage],
                ].map(([label, value]) => (
                  <View key={label} className="flex-row justify-between gap-4">
                    <Text className="flex-1 text-sm text-muted">{label}</Text>
                    <Text className="flex-1 text-right text-sm font-medium text-foreground">
                      {value}
                    </Text>
                  </View>
                ))}
              </View>
            )}
            {flow.message !== null ? (
              <Text
                accessibilityRole="alert"
                className="text-sm leading-5 text-warning"
              >
                {flow.message}
              </Text>
            ) : null}
            {failure !== null ? (
              <Text
                accessibilityRole="alert"
                className="text-sm leading-5 text-danger"
              >
                {failure}
              </Text>
            ) : null}
            {review !== null &&
            flow.phase === "review" &&
            !runtime.available ? (
              <Text
                accessibilityRole="alert"
                className="text-sm leading-5 text-warning"
              >
                Order submission is currently unavailable. You can still review
                the order details.
              </Text>
            ) : null}
          </Animated.View>
        </Card.Body>
        <Card.Footer className="flex-col gap-3">
          {flow.phase === "review" && runtime.available ? (
            <Button
              animation={reducedMotion ? "disable-all" : undefined}
              className="min-h-12 w-full"
              isDisabled={review === null || !runtime.available}
              onPress={() => void confirm()}
              variant="primary"
            >
              {review === null
                ? "Confirm action"
                : `Confirm ${review.presentation.action.toLowerCase()}`}
            </Button>
          ) : null}
          {flow.phase === "failed_before_submission" ? (
            <Button
              animation={reducedMotion ? "disable-all" : undefined}
              className="min-h-12 w-full"
              onPress={() => {
                setFailure(null);
                runtime.reset();
              }}
              variant="secondary"
            >
              Return to review
            </Button>
          ) : null}
          {!actionFlowConsumesBack(flow.phase) ? (
            <Button
              animation={reducedMotion ? "disable-all" : undefined}
              className="min-h-12 w-full"
              onPress={dismiss}
              variant="tertiary"
            >
              {RESULT_PHASES.has(flow.phase) ? "Done" : "Back without signing"}
            </Button>
          ) : null}
        </Card.Footer>
      </Card>
    </ScrollView>
  );
}
