import { Card } from "heroui-native/card";
import type { JSX } from "react";
import { View } from "react-native";
import type { PortfolioRangeData } from "../../features/portfolio/portfolio-model";
import { AppText as Text } from "../app-text";

const RANGE_LABELS = {
  "24h": "24 hour",
  "7d": "7 day",
  "30d": "30 day",
  all: "All history",
} as const;

export function PerformanceChart({
  data,
}: {
  readonly data: PortfolioRangeData | null;
}): JSX.Element {
  const summary = data?.accountValueSummary ?? null;
  return (
    <Card variant="secondary" className="gap-3">
      <Card.Body className="gap-3">
        <View className="flex-row flex-wrap items-start justify-between gap-3">
          <View className="gap-1">
            <Card.Title>Account performance</Card.Title>
            <Card.Description>
              {data ? RANGE_LABELS[data.range] : "Selected range"}
            </Card.Description>
          </View>
          <Text className="text-sm text-muted">
            {summary === null
              ? "History unavailable"
              : summary.gapCount === 0
                ? "Source series complete"
                : `${summary.gapCount} source gap${summary.gapCount === 1 ? "" : "s"}`}
          </Text>
        </View>
        {summary === null ? (
          <Text
            accessibilityLabel="No performance history was returned for the selected range."
            className="py-6 text-base leading-6 text-muted"
          >
            No performance history was returned for this range. Hyper Trader
            does not interpolate missing account values.
          </Text>
        ) : (
          <View
            accessible
            accessibilityLabel={summary.accessibilityLabel}
            className="gap-4"
          >
            <Text
              accessibilityElementsHidden
              className="font-mono text-3xl tracking-widest text-accent"
              importantForAccessibility="no-hide-descendants"
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              {summary.sparkline}
            </Text>
            <View className="flex-row flex-wrap gap-x-5 gap-y-2">
              {[
                ["Start", summary.start],
                ["High", summary.high],
                ["Low", summary.low],
                ["End", summary.end],
              ].map(([label, value]) => (
                <View className="min-w-28 flex-1 gap-1" key={label}>
                  <Text className="text-xs uppercase tracking-wide text-muted">
                    {label}
                  </Text>
                  <Text className="text-sm tabular-nums text-foreground">
                    {value}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}
      </Card.Body>
    </Card>
  );
}
