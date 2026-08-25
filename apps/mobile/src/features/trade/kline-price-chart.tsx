import type { Candle } from "@hyper-trader/hyperliquid/public";
import { Button } from "heroui-native/button";
import { Card } from "heroui-native/card";
import { useThemeColor } from "heroui-native/hooks";
import type { JSX } from "react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  type LayoutChangeEvent,
  processColor,
  StyleSheet,
  View,
} from "react-native";
import {
  type Candle as KlineCandle,
  KlineChart,
} from "react-native-kline-chart";

import { AppText as Text } from "../../components/app-text";
import { COMPACT_SEGMENT_HIT_SLOP } from "../../components/ui/control-metrics";
import { useReducedMotion } from "../../components/use-reduced-motion";
import { buildCandlestickChartModel } from "./candlestick-chart-model";
import {
  TRADE_CHART_FRAME_HEIGHT,
  TRADE_CHART_INTERVALS,
  type TradeChartInterval,
  tradeChartSpec,
} from "./market-chart-config";
import type { TradeChartOverlay } from "./trade-chart-overlays";

const CHART_THEME_COLORS = [
  "surface",
  "foreground",
  "muted",
  "separator",
  "success",
  "danger",
  "accent",
  "warning",
] as const;

const FALLBACK_COLORS = {
  background: "#101714",
  foreground: "#f2f6f4",
  muted: "rgba(242, 246, 244, 0.52)",
  grid: "rgba(242, 246, 244, 0.12)",
  positive: "#22c988",
  negative: "#ef5b67",
  accent: "#4ea7ff",
  warning: "#f1b84b",
} as const;

const MAXIMUM_VISIBLE_OVERLAYS = 8;

interface RetainedCandleSeries {
  readonly canonicalMarketId: string;
  readonly candles: readonly Candle[];
  readonly interval: TradeChartInterval;
  readonly liveRange: readonly [number, number] | null;
}

function chartColor(value: string, fallback: string): string {
  const processed = processColor(value);
  if (typeof processed !== "number") return fallback;
  const argb = processed >>> 0;
  const alpha = ((argb >>> 24) & 255) / 255;
  return `rgba(${(argb >>> 16) & 255}, ${(argb >>> 8) & 255}, ${argb & 255}, ${alpha})`;
}

function MarketKlinePriceChartComponent({
  canonicalMarketId,
  candles,
  interval,
  onIntervalChange,
  loading,
  unavailable,
  liveRange,
  overlays = [],
  historyError = false,
  compact = false,
  realtime = false,
}: {
  readonly canonicalMarketId: string;
  readonly candles: readonly Candle[] | undefined;
  readonly interval: TradeChartInterval;
  readonly onIntervalChange: (interval: TradeChartInterval) => void;
  readonly loading: boolean;
  readonly unavailable: boolean;
  readonly liveRange: readonly [number, number] | null;
  readonly overlays?: readonly TradeChartOverlay[];
  readonly historyError?: boolean;
  readonly compact?: boolean;
  readonly realtime?: boolean;
}): JSX.Element {
  const reducedMotion = useReducedMotion();
  const [
    surface,
    foreground,
    muted,
    separator,
    positive,
    negative,
    accent,
    warning,
  ] = useThemeColor(CHART_THEME_COLORS);
  const retainedSeriesRef = useRef<RetainedCandleSeries | null>(null);
  const [chartWidth, setChartWidth] = useState(0);

  const retainedSeries =
    candles === undefined &&
    retainedSeriesRef.current?.canonicalMarketId === canonicalMarketId
      ? retainedSeriesRef.current
      : null;
  const displayedCandles = candles ?? retainedSeries?.candles;
  const displayedInterval = retainedSeries?.interval ?? interval;
  const displayedLiveRange = liveRange ?? retainedSeries?.liveRange ?? null;
  const isShowingRetainedInterval =
    candles === undefined &&
    retainedSeries !== null &&
    displayedInterval !== interval;
  const spec = tradeChartSpec(displayedInterval);
  const requestedSpec = tradeChartSpec(interval);

  useEffect(() => {
    if (candles === undefined) return;
    retainedSeriesRef.current = {
      canonicalMarketId,
      candles,
      interval,
      liveRange,
    };
  }, [candles, canonicalMarketId, interval, liveRange]);

  const modelWindowLabel =
    displayedLiveRange &&
    displayedCandles?.[0] &&
    displayedCandles[0].openTime < displayedLiveRange[0]
      ? "Loaded history"
      : spec.windowLabel;
  const model = useMemo(
    () =>
      displayedCandles
        ? buildCandlestickChartModel(displayedCandles, modelWindowLabel)
        : null,
    [displayedCandles, modelWindowLabel],
  );
  const chartData = useMemo<KlineCandle[]>(
    () =>
      model?.data.map(({ timestamp, open, high, low, close }) => ({
        time: timestamp,
        open,
        high,
        low,
        close,
      })) ?? [],
    [model],
  );
  const displayedOverlays = overlays.slice(0, MAXIMUM_VISIBLE_OVERLAYS);
  const chartHeight = compact
    ? TRADE_CHART_FRAME_HEIGHT.compact
    : TRADE_CHART_FRAME_HEIGHT.standard;
  const colors = useMemo(
    () => ({
      background: chartColor(surface, FALLBACK_COLORS.background),
      foreground: chartColor(foreground, FALLBACK_COLORS.foreground),
      muted: chartColor(muted, FALLBACK_COLORS.muted),
      grid: chartColor(separator, FALLBACK_COLORS.grid),
      positive: chartColor(positive, FALLBACK_COLORS.positive),
      negative: chartColor(negative, FALLBACK_COLORS.negative),
      accent: chartColor(accent, FALLBACK_COLORS.accent),
      warning: chartColor(warning, FALLBACK_COLORS.warning),
    }),
    [
      accent,
      foreground,
      muted,
      negative,
      positive,
      separator,
      surface,
      warning,
    ],
  );

  function measureChart(event: LayoutChangeEvent): void {
    const nextWidth = Math.round(event.nativeEvent.layout.width);
    setChartWidth((current) => (current === nextWidth ? current : nextWidth));
  }

  return (
    <Card variant="default" className={compact ? "gap-2" : "gap-3"}>
      <Card.Header className="flex-row flex-wrap items-start justify-between gap-3">
        <View className="min-w-40 flex-1 gap-1">
          <Card.Title>Price chart</Card.Title>
          <Card.Description>
            {spec.windowLabel} · {spec.label} ·{" "}
            {isShowingRetainedInterval
              ? unavailable
                ? `${requestedSpec.label} unavailable`
                : `Loading ${requestedSpec.label}`
              : realtime
                ? "Live"
                : "Snapshot"}
          </Card.Description>
        </View>
        <View
          accessibilityLabel="Green candles closed higher. Red candles closed lower."
          className="flex-row items-center gap-3"
        >
          <View className="flex-row items-center gap-1.5">
            <View className="size-2 rounded-full bg-success" />
            <Text className="text-xs text-muted">Up</Text>
          </View>
          <View className="flex-row items-center gap-1.5">
            <View className="size-2 rounded-full bg-danger" />
            <Text className="text-xs text-muted">Down</Text>
          </View>
        </View>
      </Card.Header>
      <Card.Body className={compact ? "gap-2.5" : "gap-4"}>
        <View accessibilityRole="tablist" className="flex-row gap-2">
          {TRADE_CHART_INTERVALS.map((option) => {
            const selected = option.interval === interval;
            return (
              <Button
                accessibilityHint={`Shows ${option.windowLabel} using ${option.label} candles.`}
                accessibilityState={{ selected }}
                animation={reducedMotion ? "disable-all" : undefined}
                className={
                  compact ? "h-10 min-h-10 flex-1 px-2" : "min-h-12 flex-1 px-2"
                }
                hitSlop={compact ? COMPACT_SEGMENT_HIT_SLOP : undefined}
                key={option.interval}
                onPress={() => onIntervalChange(option.interval)}
                size="sm"
                variant={selected ? "primary" : "tertiary"}
              >
                {option.label}
              </Button>
            );
          })}
        </View>

        {historyError ? (
          <Text accessibilityRole="alert" className="text-sm text-warning">
            Older candles could not be loaded. The current chart remains
            available.
          </Text>
        ) : null}

        <View
          accessibilityElementsHidden={model !== null}
          importantForAccessibility={
            model === null ? "auto" : "no-hide-descendants"
          }
          onLayout={measureChart}
          style={[
            styles.chart,
            { backgroundColor: colors.background, height: chartHeight },
          ]}
          testID="kline-chart-frame"
        >
          {model && chartWidth > 0 ? (
            <KlineChart
              backgroundColor={colors.background}
              bearishColor={colors.negative}
              bullishColor={colors.positive}
              candleSpacing={2}
              candleWidth={6}
              crosshairColor={colors.muted}
              crosshairHaptics={!reducedMotion}
              data={chartData}
              gridColor={colors.grid}
              height={chartHeight}
              key={`${canonicalMarketId}:${displayedInterval}`}
              maColors={[colors.accent, colors.warning, colors.positive]}
              maPeriods={[5, 10, 20]}
              rightPaddingCandles={6}
              showCrosshair
              showMA={chartData.length >= 5}
              textColor={colors.muted}
              width={chartWidth}
            />
          ) : model === null && !loading ? (
            <View className="flex-1 items-center justify-center px-5">
              <Text
                accessibilityRole={unavailable ? "alert" : undefined}
                className="text-center text-sm leading-5 text-muted"
              >
                {unavailable
                  ? "Candle data is unavailable. No price path is inferred from missing data."
                  : "No valid candles are available for this window."}
              </Text>
            </View>
          ) : null}
        </View>
        <View
          accessible={model !== null}
          accessibilityElementsHidden={model === null}
          accessibilityLabel={model?.summary.accessibilityLabel}
          className="flex-row flex-wrap gap-x-3 gap-y-1"
          importantForAccessibility={
            model === null ? "no-hide-descendants" : "auto"
          }
          testID="kline-summary-rail"
        >
          <Text className="text-xs tabular-nums text-muted">
            O{" "}
            <Text className="text-foreground">
              {model?.summary.open ?? "-"}
            </Text>
          </Text>
          <Text className="text-xs tabular-nums text-muted">
            H{" "}
            <Text className="text-foreground">
              {model?.summary.high ?? "-"}
            </Text>
          </Text>
          <Text className="text-xs tabular-nums text-muted">
            L{" "}
            <Text className="text-foreground">{model?.summary.low ?? "-"}</Text>
          </Text>
          <Text className="text-xs tabular-nums text-muted">
            C{" "}
            <Text className="text-foreground">
              {model?.summary.close ?? "-"}
            </Text>
          </Text>
        </View>
        {displayedOverlays.length > 0 ? (
          <View
            accessible
            accessibilityLabel={displayedOverlays
              .map(({ accessibilityLabel }) => accessibilityLabel)
              .join(". ")}
            className="flex-row flex-wrap gap-x-3 gap-y-1"
          >
            {displayedOverlays.map((item) => (
              <Text className="text-xs tabular-nums text-muted" key={item.id}>
                {item.label}{" "}
                <Text className="text-foreground">{item.price}</Text>
              </Text>
            ))}
            {overlays.length > displayedOverlays.length ? (
              <Text className="text-xs text-muted">
                +{overlays.length - displayedOverlays.length} more
              </Text>
            ) : null}
          </View>
        ) : null}
      </Card.Body>
    </Card>
  );
}

export const MarketKlinePriceChart = memo(MarketKlinePriceChartComponent);

const styles = StyleSheet.create({
  chart: {
    borderRadius: 8,
    overflow: "hidden",
    width: "100%",
  },
});
