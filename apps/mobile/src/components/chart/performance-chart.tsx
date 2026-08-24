import { Card } from "heroui-native/card";
import type { JSX } from "react";
import { View } from "react-native";
import type {
  PortfolioRange,
  PortfolioRangeData,
} from "../../features/portfolio/portfolio-model";
import { AppText as Text } from "../app-text";

const RANGE_LABELS = {
  "24h": "24 hour",
  "7d": "7 day",
  "30d": "30 day",
  all: "All history",
} as const;

export function PerformanceChart({
  data,
  loading = false,
  range,
}: {
  readonly data: PortfolioRangeData | null;
  readonly loading?: boolean;
  readonly range: PortfolioRange;
}): JSX.Element {
  const summary = data?.accountValueSummary ?? null;
  return (
    <Card
      accessibilityLabel={loading ? "Loading Portfolio performance" : undefined}
      className="gap-3"
      variant="secondary"
    >
      <Card.Body className="gap-3">
        <View className="flex-row flex-wrap items-start justify-between gap-3">
          <View className="gap-1">
            <Card.Title>Account performance</Card.Title>
            <Card.Description>
              {RANGE_LABELS[data?.range ?? range]}
            </Card.Description>
          </View>
          <Text className="text-sm text-muted">
            {loading
              ? "-"
              : summary === null
                ? "History unavailable"
                : summary.gapCount === 0
                  ? "Source series complete"
                  : `${summary.gapCount} source gap${summary.gapCount === 1 ? "" : "s"}`}
          </Text>
        </View>
        {loading ? (
          <View
            accessible
            accessibilityLabel="Performance history is loading."
            className="gap-4"
          >
            <Text
              accessibilityElementsHidden
              adjustsFontSizeToFit
              className="font-mono text-3xl tracking-widest text-accent"
              importantForAccessibility="no-hide-descendants"
              numberOfLines={1}
            >
              -
            </Text>
            <PerformanceValues
              values={{ end: "-", high: "-", low: "-", start: "-" }}
            />
          </View>
        ) : summary === null ? (
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
            <PerformanceValues values={summary} />
          </View>
        )}
      </Card.Body>
    </Card>
  );
}

function PerformanceValues({
  values,
}: {
  readonly values: {
    readonly start: string;
    readonly high: string;
    readonly low: string;
    readonly end: string;
  };
}): JSX.Element {
  return (
    <View className="flex-row flex-wrap gap-x-5 gap-y-2">
      {[
        ["Start", values.start],
        ["High", values.high],
        ["Low", values.low],
        ["End", values.end],
      ].map(([label, value]) => (
        <View className="min-w-28 flex-1 gap-1" key={label}>
          <Text className="text-xs uppercase tracking-wide text-muted">
            {label}
          </Text>
          <Text className="text-sm tabular-nums text-foreground">{value}</Text>
        </View>
      ))}
    </View>
  );
}
