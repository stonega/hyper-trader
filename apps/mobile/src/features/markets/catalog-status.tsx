import { Button } from "heroui-native/button";
import type { JSX } from "react";
import { View } from "react-native";

import { AppText as Text } from "../../components/app-text";
import { COMPACT_SEGMENT_HIT_SLOP } from "../../components/ui/control-metrics";
import { useReducedMotion } from "../../components/use-reduced-motion";
import type { CatalogPresentationState } from "./catalog-state";

export function CatalogStatus({
  state,
  onRetry,
  compact = false,
}: {
  readonly state: CatalogPresentationState;
  readonly onRetry: () => void;
  readonly compact?: boolean;
}): JSX.Element {
  const reducedMotion = useReducedMotion();
  const tone =
    state.content === "unavailable"
      ? {
          containerClass: "bg-danger/10",
          dotClass: "bg-danger",
          titleClass: "text-danger",
        }
      : state.content === "ready" &&
          (state.freshness === "fresh" || state.freshness === "refreshing") &&
          !state.hasPartialSources
        ? {
            containerClass: "bg-success/10",
            dotClass: "bg-success",
            titleClass: "text-success",
          }
        : {
            containerClass: "bg-warning/10",
            dotClass: "bg-warning",
            titleClass: "text-warning",
          };
  const title =
    state.content === "unavailable" ? "Markets unavailable" : "Market update";
  const description =
    state.content === "loading"
      ? "Loading markets…"
      : state.content === "unavailable"
        ? "Markets could not be loaded."
        : state.freshness === "offline"
          ? "You’re offline. Showing saved markets."
          : "Some market data may be out of date.";

  if (compact) {
    return (
      <View
        className="shrink flex-row items-center gap-1.5"
        testID="catalog-status"
      >
        <View className={`size-2 shrink-0 rounded-full ${tone.dotClass}`} />
        <Text
          accessibilityLabel={`${title}. ${description}`}
          accessibilityLiveRegion="polite"
          accessibilityRole={state.content === "unavailable" ? "alert" : "text"}
          className={`min-w-0 shrink text-xs font-semibold ${tone.titleClass}`}
          numberOfLines={1}
        >
          {title}
        </Text>
        {state.canRetry ? (
          <Button
            accessibilityHint="Tries to refresh the market list."
            accessibilityLabel="Retry market update"
            animation={reducedMotion ? "disable-all" : undefined}
            className="h-10 min-h-10 shrink-0 px-2"
            hitSlop={COMPACT_SEGMENT_HIT_SLOP}
            onPress={onRetry}
            size="sm"
            variant="ghost"
          >
            <Button.Label className="text-xs">Retry</Button.Label>
          </Button>
        ) : null}
      </View>
    );
  }

  return (
    <View
      className={`flex-row items-center gap-2.5 rounded-xl px-3 py-2 ${tone.containerClass}`}
      testID="catalog-status"
    >
      <View className={`size-2 shrink-0 rounded-full ${tone.dotClass}`} />
      <View className="min-w-0 flex-1 gap-0.5">
        <Text className={`text-xs font-semibold ${tone.titleClass}`}>
          {title}
        </Text>
        <Text
          accessibilityLiveRegion="polite"
          accessibilityRole={state.content === "unavailable" ? "alert" : "text"}
          className="text-xs leading-4 text-muted"
        >
          {description}
        </Text>
      </View>
      {state.canRetry ? (
        <Button
          accessibilityHint="Tries to refresh the market list."
          accessibilityLabel="Retry market update"
          animation={reducedMotion ? "disable-all" : undefined}
          className="h-10 min-h-10 shrink-0 px-2.5"
          hitSlop={COMPACT_SEGMENT_HIT_SLOP}
          onPress={onRetry}
          size="sm"
          variant="ghost"
        >
          <Button.Label className="text-xs">Retry</Button.Label>
        </Button>
      ) : null}
    </View>
  );
}
