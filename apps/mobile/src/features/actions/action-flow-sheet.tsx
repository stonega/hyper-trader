import { BottomSheetScrollView } from "@gorhom/bottom-sheet";
import { BottomSheet } from "heroui-native/bottom-sheet";
import { Button } from "heroui-native/button";
import { Card } from "heroui-native/card";
import { Spinner } from "heroui-native/spinner";
import type { JSX } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, BackHandler, View } from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  ReduceMotion,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/app-text";
import { useReducedMotion } from "../../components/use-reduced-motion";
import type {
  ActionReviewPresentation,
  ActionReviewSnapshot,
} from "./orchestrator";
import { confirmationFailurePresentation } from "./presentation";
import { useActionRuntime } from "./runtime-provider";
import {
  type ActionFlowPhase,
  type ActionFlowState,
  actionFlowConsumesBack,
} from "./state-machine";

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
    title: "Checking result",
    description: "Waiting for Hyperliquid to confirm the result.",
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
const PENDING_PHASES: ReadonlySet<ActionFlowPhase> = new Set([
  "unlocking",
  "refreshing",
  "reserving",
  "signing",
  "submission_start",
  "submitting",
  "reconciling",
]);
const ACCEPTED_CLOSE_DELAY_MS = 900;
const NOT_APPLICABLE = "Not applicable";

function accountLabel(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

type ReviewActionType = ActionReviewSnapshot["validated"]["intent"]["type"];

function isOrderReview(actionType: ReviewActionType): boolean {
  return (
    actionType === "market_order" ||
    actionType === "limit_order" ||
    actionType === "reduce_only_close" ||
    actionType === "position_tpsl"
  );
}

function reviewTitle(actionType: ReviewActionType): string {
  if (isOrderReview(actionType)) return "Confirm order";
  if (actionType === "cancel") return "Confirm cancellation";
  if (actionType === "update_leverage") return "Confirm leverage";
  return "Review action";
}

function confirmationLabel(
  actionType: ReviewActionType,
  presentation: ActionReviewPresentation,
): string {
  if (actionType === "market_order" || actionType === "limit_order") {
    const side = presentation.side.toLowerCase();
    return side === NOT_APPLICABLE.toLowerCase()
      ? "Place order"
      : `Place ${side} order`;
  }
  if (actionType === "reduce_only_close") return "Close position";
  if (actionType === "position_tpsl") return "Set protection";
  if (actionType === "cancel") return "Cancel order";
  if (actionType === "update_leverage") return "Update leverage";
  return "Confirm action";
}

function reviewDetails(
  actionType: ReviewActionType,
  presentation: ActionReviewPresentation,
  compact: boolean,
): readonly (readonly [label: string, value: string])[] {
  if (!isOrderReview(actionType)) {
    return actionType === "update_leverage"
      ? [["Leverage / margin", presentation.leverageAndMargin]]
      : [];
  }
  const priceLabel =
    actionType === "limit_order"
      ? "Limit price"
      : actionType === "position_tpsl"
        ? "Trigger price"
        : "Price limit";
  const details: readonly (readonly [string, string])[] = [
    [priceLabel, presentation.price],
    [
      "Reduce only",
      compact && presentation.reduceOnly === "No"
        ? NOT_APPLICABLE
        : presentation.reduceOnly,
    ],
    [
      "Estimated fee",
      compact && presentation.estimatedFee.startsWith("Unavailable")
        ? NOT_APPLICABLE
        : presentation.estimatedFee,
    ],
    ["Max slippage", presentation.slippage],
  ];
  return details.filter((detail) => detail[1] !== NOT_APPLICABLE);
}

function orderMeta(
  actionType: ReviewActionType,
  presentation: ActionReviewPresentation,
): string {
  if (!isOrderReview(actionType)) return presentation.action;
  if (
    presentation.leverageAndMargin === NOT_APPLICABLE ||
    presentation.leverageAndMargin === "Spot"
  ) {
    return presentation.action;
  }
  return `${presentation.action} · ${presentation.leverageAndMargin}`;
}

function ReviewTicket({
  compact,
  review,
}: {
  readonly compact: boolean;
  readonly review: ActionReviewSnapshot;
}): JSX.Element {
  const { presentation } = review;
  const actionType = review.validated.intent.type;
  const showSide = presentation.side !== NOT_APPLICABLE;
  const showSize = presentation.size !== NOT_APPLICABLE;
  return (
    <View className="gap-3">
      <View className="gap-1">
        {showSide ? (
          <Text className="text-xs font-semibold uppercase tracking-wide text-accent">
            {presentation.side}
          </Text>
        ) : null}
        <View className="flex-row items-baseline justify-between gap-4">
          <Text className="min-w-0 flex-1 text-lg font-semibold text-foreground">
            {presentation.market}
          </Text>
          {showSize ? (
            <Text className="text-right text-lg font-semibold text-foreground">
              {presentation.size}
            </Text>
          ) : null}
        </View>
        <Text className="text-sm text-muted">
          {orderMeta(actionType, presentation)}
        </Text>
      </View>

      <View className="h-px bg-divider" />

      <View className="gap-2.5">
        {reviewDetails(actionType, presentation, compact).map(
          ([label, value]) => (
            <View className="flex-row justify-between gap-4" key={label}>
              <Text className="flex-1 text-sm text-muted">{label}</Text>
              <Text className="flex-1 text-right text-sm font-medium text-foreground">
                {value}
              </Text>
            </View>
          ),
        )}
        {compact ? null : (
          <View className="flex-row justify-between gap-4">
            <Text className="flex-1 text-sm text-muted">Account</Text>
            <Text className="flex-1 text-right text-sm font-medium text-foreground">
              {accountLabel(presentation.account)}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

function pendingStatusLabel({
  phase,
  actionType,
}: {
  readonly phase: ActionFlowPhase;
  readonly actionType: ReviewActionType | null;
}): string {
  const noun =
    actionType !== null && isOrderReview(actionType) ? "order" : "action";
  if (phase === "unlocking") return "Authenticating…";
  if (phase === "refreshing" || phase === "reconciling") {
    return `Checking ${noun}…`;
  }
  if (phase === "reserving") return `Preparing ${noun}…`;
  if (phase === "signing") return `Signing ${noun}…`;
  return `Submitting ${noun}…`;
}

function FlowStatus({
  actionType,
  phase,
  reducedMotion,
}: {
  readonly actionType: ReviewActionType | null;
  readonly phase: ActionFlowPhase;
  readonly reducedMotion: boolean;
}): JSX.Element | null {
  if (phase === "review") return null;

  const isPending = PENDING_PHASES.has(phase);
  const pendingLabel = isPending
    ? pendingStatusLabel({ actionType, phase })
    : null;

  return (
    <View className="flex-row items-center gap-3">
      {isPending ? (
        <Spinner
          accessibilityLabel={
            phase === "reconciling"
              ? `Checking ${actionType !== null && isOrderReview(actionType) ? "order" : "action"} status`
              : (pendingLabel ?? undefined)
          }
          animation={reducedMotion ? "disable-all" : undefined}
          size="sm"
        />
      ) : null}
      <View className="min-w-0 flex-1 gap-0.5">
        <Text
          accessibilityRole={isPending ? undefined : "alert"}
          className="text-sm font-semibold text-foreground"
        >
          {pendingLabel ?? STATUS_COPY[phase].title}
        </Text>
        {isPending ? null : (
          <Text className="text-sm leading-5 text-muted">
            {STATUS_COPY[phase].description}
          </Text>
        )}
      </View>
    </View>
  );
}

export function ActionFlowSheet(): JSX.Element {
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const runtime = useActionRuntime();
  const [failure, setFailure] = useState<string | null>(null);
  const [closingSnapshot, setClosingSnapshot] = useState<{
    readonly flow: ActionFlowState;
    readonly review: ActionReviewSnapshot;
    readonly failure: string | null;
  } | null>(null);
  const reviewClearedAfterDismiss = useRef(false);
  const runtimeReview = runtime.review;
  const flow = closingSnapshot?.flow ?? runtime.flow;
  const review = closingSnapshot?.review ?? runtimeReview;
  const visibleFailure = closingSnapshot?.failure ?? failure;
  const isOpen = runtimeReview !== null && closingSnapshot === null;
  const consumesBack = actionFlowConsumesBack(flow.phase);
  const phaseCopy = STATUS_COPY[flow.phase];
  const copy =
    flow.phase === "review" && review !== null
      ? { ...phaseCopy, title: reviewTitle(review.validated.intent.type) }
      : phaseCopy;
  const duration = reducedMotion ? 0 : 160;

  const dismiss = useCallback(() => {
    const activeReview = runtime.review;
    const activeFlow = runtime.readFlow();
    if (activeReview === null || closingSnapshot !== null) return;
    if (actionFlowConsumesBack(activeFlow.phase)) return;
    reviewClearedAfterDismiss.current = false;
    setClosingSnapshot({
      flow: activeFlow,
      review: activeReview,
      failure,
    });
    setFailure(null);
    runtime.clear();
  }, [closingSnapshot, failure, runtime]);

  useEffect(() => {
    if (closingSnapshot === null) return;
    if (runtimeReview === null) {
      reviewClearedAfterDismiss.current = true;
      return;
    }
    if (!reviewClearedAfterDismiss.current) return;
    reviewClearedAfterDismiss.current = false;
    setClosingSnapshot(null);
  }, [closingSnapshot, runtimeReview]);

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
          accessibilityLabel={
            flow.phase === "review"
              ? "Order action review"
              : "Order submission status"
          }
          animation={reducedMotion ? false : undefined}
          enableDynamicSizing
          enableOverDrag={false}
          enablePanDownToClose={!consumesBack}
        >
          <BottomSheetScrollView
            contentContainerStyle={{
              paddingBottom: Math.max(insets.bottom, 20) + 16,
              paddingHorizontal: 20,
            }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View className="gap-4 pb-2">
              {flow.phase === "review" ? (
                <View className="gap-1">
                  <Text className="text-xs font-medium uppercase tracking-wide text-accent">
                    {review?.presentation.network ?? "Hyperliquid action"}
                  </Text>
                  <BottomSheet.Title>{copy.title}</BottomSheet.Title>
                  <BottomSheet.Description>
                    {copy.description}
                  </BottomSheet.Description>
                </View>
              ) : null}

              <Card className="gap-3" variant="secondary">
                <Card.Body className="gap-3">
                  <Animated.View
                    className="gap-3"
                    entering={FadeIn.duration(duration).reduceMotion(
                      ReduceMotion.System,
                    )}
                    exiting={FadeOut.duration(
                      Math.min(duration, 100),
                    ).reduceMotion(ReduceMotion.System)}
                    key={flow.phase}
                  >
                    <FlowStatus
                      actionType={review?.validated.intent.type ?? null}
                      phase={flow.phase}
                      reducedMotion={reducedMotion}
                    />
                    {review === null ? null : (
                      <ReviewTicket
                        compact={flow.phase !== "review"}
                        review={review}
                      />
                    )}
                    {flow.message !== null && flow.phase !== "reconciling" ? (
                      <Text
                        accessibilityRole="alert"
                        className="text-sm leading-5 text-warning"
                      >
                        {flow.message}
                      </Text>
                    ) : null}
                    {visibleFailure !== null ? (
                      <Text
                        accessibilityRole="alert"
                        className="text-sm leading-5 text-danger"
                      >
                        {visibleFailure}
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
                    accessibilityHint={`Signs and submits this action to ${review?.presentation.network ?? "the selected Hyperliquid network"}.`}
                    animation={reducedMotion ? "disable-all" : undefined}
                    className="min-h-12 w-full"
                    isDisabled={review === null}
                    onPress={() => void confirm()}
                    variant="primary"
                  >
                    {review === null
                      ? "Confirm action"
                      : confirmationLabel(
                          review.validated.intent.type,
                          review.presentation,
                        )}
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
                    accessibilityLabel={
                      flow.phase === "review" ? "Cancel review" : undefined
                    }
                    animation={reducedMotion ? "disable-all" : undefined}
                    className="min-h-12 w-full"
                    onPress={dismiss}
                    variant="tertiary"
                  >
                    {flow.phase === "rejected"
                      ? "Edit order"
                      : RESULT_PHASES.has(flow.phase)
                        ? "Done"
                        : "Cancel"}
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
