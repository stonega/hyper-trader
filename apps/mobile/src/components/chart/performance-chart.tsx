import { Card } from "heroui-native/card";
import type { JSX } from "react";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
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

const PERFORMANCE_CHART_HEIGHT = 128;
const SELECTION_IDLE_TIMEOUT_MS = 10_000;
const BAR_HEIGHT_BY_GLYPH: Readonly<Record<string, number>> = {
  "▁": 1 / 8,
  "▂": 2 / 8,
  "▃": 3 / 8,
  "▄": 4 / 8,
  "▅": 5 / 8,
  "▆": 6 / 8,
  "▇": 7 / 8,
  "█": 1,
};

type PerformancePoint = PortfolioRangeData["accountValueHistory"][number];

function formatAccountValue(value: string): string {
  return value === "-" || value === "Unavailable" ? value : `$${value}`;
}

function formatPerformancePointTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(timestamp));
}

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
  const activeRange = data?.range ?? range;
  const points = data?.accountValueHistory ?? [];
  const [selection, setSelection] = useState<{
    readonly range: PortfolioRange;
    readonly timestamp: number;
  } | null>(null);
  useEffect(() => {
    if (selection === null) return;
    const timeout = setTimeout(() => {
      setSelection((current) =>
        current?.range === selection.range &&
        current.timestamp === selection.timestamp
          ? null
          : current,
      );
    }, SELECTION_IDLE_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [selection]);
  const selectedPoint =
    selection?.range === activeRange
      ? (points.find(([timestamp]) => timestamp === selection.timestamp) ??
        null)
      : null;
  const displayedPoint = selectedPoint ?? points.at(-1) ?? null;
  return (
    <Card
      accessibilityLabel={loading ? "Loading Portfolio performance" : undefined}
      className="gap-3"
      variant="secondary"
    >
      <Card.Body className="gap-3">
        <View className="flex-row items-start justify-between gap-3">
          <View className="min-w-0 flex-1 gap-1">
            <Card.Title>Account performance</Card.Title>
            <Card.Description>{RANGE_LABELS[activeRange]}</Card.Description>
          </View>
          <PerformancePointReadout
            loading={loading}
            point={displayedPoint}
            selected={selectedPoint !== null}
            summaryAccessibilityLabel={summary?.accessibilityLabel ?? null}
          />
        </View>
        {loading ? (
          <View
            accessible
            accessibilityLabel="Performance history is loading."
            className="gap-4"
          >
            <View
              accessibilityElementsHidden
              className="items-center justify-center border-b border-border/70"
              importantForAccessibility="no-hide-descendants"
              style={{ height: PERFORMANCE_CHART_HEIGHT }}
              testID="account-performance-chart"
            >
              <Text className="font-mono text-3xl text-accent">-</Text>
            </View>
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
          <View className="gap-4">
            <PerformanceBars
              onSelect={(timestamp) =>
                setSelection({ range: activeRange, timestamp })
              }
              points={points}
              selectedTimestamp={displayedPoint?.[0] ?? null}
              sparkline={summary.sparkline}
            />
            <PerformanceValues values={summary} />
          </View>
        )}
      </Card.Body>
    </Card>
  );
}

function PerformancePointReadout({
  loading,
  point,
  selected,
  summaryAccessibilityLabel,
}: {
  readonly loading: boolean;
  readonly point: PerformancePoint | null;
  readonly selected: boolean;
  readonly summaryAccessibilityLabel: string | null;
}): JSX.Element {
  const timestamp =
    point === null ? null : formatPerformancePointTime(point[0]);
  const stateLabel = selected ? "Selected" : "Latest";
  const value = formatAccountValue(
    loading ? "-" : (point?.[1] ?? "Unavailable"),
  );
  const accessibilityLabel = loading
    ? "Latest account value is loading."
    : point === null
      ? "Account value history unavailable."
      : `${stateLabel} account value ${value} at ${timestamp}. ${summaryAccessibilityLabel ?? ""}`;
  return (
    <View
      accessible
      accessibilityLabel={accessibilityLabel}
      accessibilityLiveRegion="polite"
      className="items-end gap-0.5"
      style={styles.pointReadout}
      testID="performance-point-readout"
    >
      <Text
        adjustsFontSizeToFit
        className="font-mono text-base tabular-nums text-foreground"
        numberOfLines={1}
        testID="performance-point-value"
      >
        {value}
      </Text>
      {timestamp === null || loading ? null : (
        <Text
          className="text-right text-xs tabular-nums text-muted"
          numberOfLines={1}
          testID="performance-point-time"
        >
          {timestamp}
        </Text>
      )}
    </View>
  );
}

function PerformanceBars({
  onSelect,
  points,
  selectedTimestamp,
  sparkline,
}: {
  readonly onSelect: (timestamp: number) => void;
  readonly points: PortfolioRangeData["accountValueHistory"];
  readonly selectedTimestamp: number | null;
  readonly sparkline: string;
}): JSX.Element {
  const glyphs = Array.from(sparkline);
  return (
    <View
      className="w-full flex-row items-end gap-px overflow-hidden border-b border-border/70"
      style={{ height: PERFORMANCE_CHART_HEIGHT }}
      testID="account-performance-chart"
    >
      {points.map(([timestamp, value], index) => (
        <Pressable
          accessibilityHint="Shows this point in the chart header"
          accessibilityLabel={`${formatPerformancePointTime(timestamp)}. Account value ${formatAccountValue(value)}.`}
          accessibilityRole="button"
          accessibilityState={{ selected: timestamp === selectedTimestamp }}
          key={timestamp}
          onPress={() => onSelect(timestamp)}
          style={({ pressed }) => [
            styles.barTarget,
            pressed ? styles.pressedBarTarget : null,
          ]}
        >
          <View
            className={
              timestamp === selectedTimestamp
                ? "w-full rounded-t-sm bg-accent"
                : "w-full rounded-t-sm bg-accent/60"
            }
            style={{
              height:
                PERFORMANCE_CHART_HEIGHT *
                (BAR_HEIGHT_BY_GLYPH[glyphs[index] ?? ""] ?? 0.5),
            }}
          />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  barTarget: {
    flex: 1,
    height: PERFORMANCE_CHART_HEIGHT,
    justifyContent: "flex-end",
    minWidth: 1,
  },
  pointReadout: {
    maxWidth: "55%",
  },
  pressedBarTarget: {
    opacity: 0.72,
  },
});

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
          <Text className="text-sm tabular-nums text-foreground">
            {formatAccountValue(value)}
          </Text>
        </View>
      ))}
    </View>
  );
}
