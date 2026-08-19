import { Button } from "heroui-native/button";
import { Card } from "heroui-native/card";
import type { JSX } from "react";

import { useReducedMotion } from "../../components/use-reduced-motion";
import type { CatalogPresentationState } from "./catalog-state";

export function CatalogStatus({
  state,
  onRetry,
}: {
  readonly state: CatalogPresentationState;
  readonly onRetry: () => void;
}): JSX.Element {
  const reducedMotion = useReducedMotion();
  const colorClass =
    state.content === "unavailable"
      ? "text-danger"
      : state.content === "ready" &&
          (state.freshness === "fresh" || state.freshness === "refreshing") &&
          !state.hasPartialSources
        ? "text-success"
        : "text-warning";
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

  return (
    <Card variant="secondary" className="gap-3">
      <Card.Body className="gap-2">
        <Card.Title className={colorClass}>{title}</Card.Title>
        <Card.Description
          accessibilityLiveRegion="polite"
          accessibilityRole={state.content === "unavailable" ? "alert" : "text"}
        >
          {description}
        </Card.Description>
      </Card.Body>
      {state.canRetry ? (
        <Card.Footer>
          <Button
            accessibilityHint="Tries to refresh the market list."
            animation={reducedMotion ? "disable-all" : undefined}
            className="min-h-11"
            onPress={onRetry}
            size="sm"
            variant="secondary"
          >
            Try again
          </Button>
        </Card.Footer>
      ) : null}
    </Card>
  );
}
