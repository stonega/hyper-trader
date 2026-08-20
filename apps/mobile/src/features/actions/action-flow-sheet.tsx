import { BottomSheetScrollView } from "@gorhom/bottom-sheet";
import { BottomSheet } from "heroui-native/bottom-sheet";
import { Button } from "heroui-native/button";
import { Card } from "heroui-native/card";
import type { JSX } from "react";
import { useCallback, useEffect, useState } from "react";
import { AccessibilityInfo, BackHandler, View } from "react-native";
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
    description: "Check every detail before signing on this device.",
  },
  unlocking: {
    title: "Authenticating",
    description: "Confirm on this device to continue.",
  },
  refreshing: {
    title: "Checking order",
    description: "Refreshing market and account details before submission.",
  },
  reserving: {
    title: "Preparing order",
    description: "Reserving this confirmed action for one safe submission.",
  },
  signing: {
    title: "Signing order",
    description: "Signing the confirmed action on this device.",
  },
  submission_start: {
    title: "Submitting",
    description: "Starting the one-time submission to Hyperliquid.",
  },
  submitting: {
    title: "Submitting",
    description: "Sending the action to Hyperliquid.",
  },
  reconciling: {
    title: "Checking status",
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
const ACTION_SHEET_SNAP_POINTS = ["88%"];
const ACCEPTED_CLOSE_DELAY_MS = 900;

function accountLabel(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function ActionStage({
  phase,
}: {
  readonly phase: ActionFlowPhase;
}): JSX.Element {
  const activeStage =
    phase === "review"
      ? 0
      : phase === "failed_before_submission" || RESULT_PHASES.has(phase)
        ? 2
        : 1;

  return (
    <View
      accessibilityLabel={`Action progress: ${["review", "submit", "status"][activeStage]}`}
      className="flex-row gap-2"
    >
      {["Review", "Submit", "Status"].map((label, index) => (
        <View className="min-w-0 flex-1 gap-1.5" key={label}>
          <View
            className={
              index <= activeStage
                ? "h-1 rounded-full bg-accent"
                : "h-1 rounded-full bg-surface-secondary"
            }
          />
          <Text
            className={
              index === activeStage
                ? "text-xs font-semibold text-foreground"
                : "text-xs text-muted"
            }
          >
            {label}
          </Text>
        </View>
      ))}
    </View>
  );
}

export function ActionFlowSheet(): JSX.Element {
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const runtime = useActionRuntime();
  const [failure, setFailure] = useState<string | null>(null);
  const { flow, review } = runtime;
  const isOpen = review !== null;
  const consumesBack = actionFlowConsumesBack(flow.phase);
  const copy = STATUS_COPY[flow.phase];
  const duration = reducedMotion ? 0 : 160;

  const dismiss = useCallback(() => {
    if (runtime.review === null) return;
    if (actionFlowConsumesBack(runtime.readFlow().phase)) return;
    setFailure(null);
    runtime.clear();
  }, [runtime]);

  useEffect(() => {
    if (!isOpen) return;
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        if (actionFlowConsumesBack(runtime.readFlow().phase)) return true;
        dismiss();
        return true;
      },
    );
    return () => subscription.remove();
  }, [dismiss, isOpen, runtime]);

  useEffect(() => {
    if (!isOpen) return;
    void AccessibilityInfo.announceForAccessibility(copy.title);
  }, [copy.title, isOpen]);

  useEffect(() => {
    if (!isOpen || flow.phase !== "accepted") return;
    const timeout = setTimeout(dismiss, ACCEPTED_CLOSE_DELAY_MS);
    return () => clearTimeout(timeout);
  }, [dismiss, flow.phase, isOpen]);

  const confirm = async () => {
    setFailure(null);
    try {
      await runtime.confirm();
    } catch {
      const latest = runtime.readFlow();
      if (latest.message === null) {
        setFailure(confirmationFailurePresentation(latest).message);
      }
    }
  };

  return (
    <BottomSheet
      animation={reducedMotion ? "disable-all" : undefined}
      isOpen={isOpen}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) dismiss();
      }}
    >
      <BottomSheet.Portal unstable_accessibilityContainerViewIsModal>
        <BottomSheet.Overlay
          animation={reducedMotion ? false : undefined}
          isCloseOnPress={!consumesBack}
        />
        <BottomSheet.Content
          animation={reducedMotion ? false : undefined}
          contentContainerClassName="h-full"
          enableDynamicSizing={false}
          enableOverDrag={false}
          enablePanDownToClose={!consumesBack}
          snapPoints={ACTION_SHEET_SNAP_POINTS}
        >
          <BottomSheetScrollView
            contentContainerStyle={{
              paddingBottom: Math.max(insets.bottom, 20),
              paddingHorizontal: 20,
            }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View className="gap-5 pb-2">
              <ActionStage phase={flow.phase} />
              <View className="gap-1">
                <Text className="text-xs font-medium uppercase tracking-wide text-accent">
                  Testnet action
                </Text>
                <BottomSheet.Title>{copy.title}</BottomSheet.Title>
                <BottomSheet.Description>
                  {copy.description}
                </BottomSheet.Description>
              </View>

              <Card className="gap-4" variant="secondary">
                <Card.Body className="gap-4">
                  <Animated.View
                    className="gap-4"
                    entering={FadeIn.duration(duration).reduceMotion(
                      ReduceMotion.System,
                    )}
                    exiting={FadeOut.duration(
                      Math.min(duration, 100),
                    ).reduceMotion(ReduceMotion.System)}
                    key={flow.phase}
                  >
                    {review === null ? null : (
                      <View className="gap-3">
                        {[
                          ["Network", review.presentation.network],
                          [
                            "Account",
                            accountLabel(review.presentation.account),
                          ],
                          ["Market", review.presentation.market],
                          ["Action", review.presentation.action],
                          ["Side", review.presentation.side],
                          ["Price", review.presentation.price],
                          ["Size", review.presentation.size],
                          [
                            "Leverage / margin",
                            review.presentation.leverageAndMargin,
                          ],
                          ["Reduce only", review.presentation.reduceOnly],
                          ["Estimated fee", review.presentation.estimatedFee],
                          ["Slippage", review.presentation.slippage],
                        ].map(([label, value]) => (
                          <View
                            className="flex-row justify-between gap-4"
                            key={label}
                          >
                            <Text className="flex-1 text-sm text-muted">
                              {label}
                            </Text>
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
                    {flow.phase === "review" && !runtime.available ? (
                      <Text
                        accessibilityRole="alert"
                        className="text-sm leading-5 text-warning"
                      >
                        Order submission is currently unavailable. You can still
                        review the order details.
                      </Text>
                    ) : null}
                  </Animated.View>
                </Card.Body>
              </Card>

              <View className="gap-3">
                {flow.phase === "review" && runtime.available ? (
                  <Button
                    animation={reducedMotion ? "disable-all" : undefined}
                    className="min-h-12 w-full"
                    isDisabled={review === null}
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
                    onPress={dismiss}
                    variant="secondary"
                  >
                    Return to order
                  </Button>
                ) : null}
                {!consumesBack &&
                flow.phase !== "accepted" &&
                flow.phase !== "failed_before_submission" ? (
                  <Button
                    animation={reducedMotion ? "disable-all" : undefined}
                    className="min-h-12 w-full"
                    onPress={dismiss}
                    variant="tertiary"
                  >
                    {RESULT_PHASES.has(flow.phase)
                      ? "Done"
                      : "Back without signing"}
                  </Button>
                ) : null}
              </View>
            </View>
          </BottomSheetScrollView>
        </BottomSheet.Content>
      </BottomSheet.Portal>
    </BottomSheet>
  );
}
