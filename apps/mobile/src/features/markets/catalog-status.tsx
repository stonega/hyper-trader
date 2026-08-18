import type { CatalogSourceError } from "@hyper-trader/hyperliquid/public";
import { Button } from "heroui-native/button";
import { Card } from "heroui-native/card";
import type { JSX } from "react";
import { View } from "react-native";

import { AppText as Text } from "../../components/app-text";
import { useReducedMotion } from "../../components/use-reduced-motion";
import type { CatalogPresentationState } from "./catalog-state";

export function CatalogStatus({
  state,
  sourceErrors,
  onRetry,
}: {
  readonly state: CatalogPresentationState;
  readonly sourceErrors: readonly CatalogSourceError[];
  readonly onRetry: () => void;
}): JSX.Element {
  const reducedMotion = useReducedMotion();
  const colorClass =
    state.freshness === "fresh" && !state.hasPartialSources
      ? "text-success"
      : state.content === "unavailable"
        ? "text-danger"
        : "text-warning";

  return (
    <Card variant="secondary" className="gap-3">
      <Card.Body className="gap-2">
        <Card.Title className={colorClass}>Catalog status</Card.Title>
        <Card.Description
          accessibilityLiveRegion="polite"
          accessibilityRole={state.content === "unavailable" ? "alert" : "text"}
        >
          {state.statusLabel}
        </Card.Description>
        {sourceErrors.length > 0 ? (
          <View className="gap-1">
            {sourceErrors.map((error) => (
              <Text
                className="text-sm text-muted"
                key={`${error.source}:${error.message}`}
              >
                {error.source}: temporarily unavailable
              </Text>
            ))}
          </View>
        ) : null}
      </Card.Body>
      {state.canRetry ? (
        <Card.Footer>
          <Button
            accessibilityHint="Retries every catalog source while keeping saved validated markets visible."
            animation={reducedMotion ? "disable-all" : undefined}
            className="min-h-11"
            onPress={onRetry}
            size="sm"
            variant="secondary"
          >
            Retry catalog
          </Button>
        </Card.Footer>
      ) : null}
    </Card>
  );
}
