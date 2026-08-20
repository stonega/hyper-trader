import { BarlowSemiCondensed_400Regular } from "@expo-google-fonts/barlow-semi-condensed/400Regular";
import type { Candle, Market } from "@hyper-trader/hyperliquid/public";
import { useFont } from "@shopify/react-native-skia";
import { Button } from "heroui-native/button";
import { Card } from "heroui-native/card";
import { useThemeColor } from "heroui-native/hooks";
import type { JSX } from "react";
import { useMemo, useRef, useState } from "react";
import { processColor, StyleSheet, View } from "react-native";
import { Gesture } from "react-native-gesture-handler";
import { CartesianChart, type ChartBounds } from "victory-native";

import { AppText as Text } from "../../components/app-text";
import { COMPACT_SEGMENT_HIT_SLOP } from "../../components/ui/control-metrics";
import { useReducedMotion } from "../../components/use-reduced-motion";
import { formatMarketPrice } from "../markets/format";
import { buildCandlestickChartModel } from "./candlestick-chart-model";
import {
  buildCandlestickChartDomains,
  type CandlestickChartInteraction,
  FULL_CANDLE_WINDOW,
  horizontalFocalRatio,
  minimumCandleWindowSpan,
  type NumericRange,
  pricePanOffset,
  resolveCandlestickChartViewport,
  zoomCandleWindow,
} from "./candlestick-chart-viewport";
import {
  TRADE_CANDLE_Y_KEYS,
  TRADE_CHART_INTERVALS,
  type TradeChartInterval,
  tradeChartSpec,
} from "./market-chart-config";
import { SkiaCandlestickSeries } from "./skia-candlestick-series";

const CHART_THEME_COLORS = ["success", "danger", "muted", "separator"] as const;

const FALLBACK_COLORS = {
  positive: "#22c988",
  negative: "#ef5b67",
  neutral: "#87908e",
  grid: "#36413e",
} as const;

const COMPACT_AXIS_FORMATTER = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
  notation: "compact",
});
const SMALL_AXIS_FORMATTER = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 6,
});

const MINIMUM_VISIBLE_CANDLES = 12;
const VERTICAL_DRAG_ACTIVATION_OFFSET = 6;
const VERTICAL_DRAG_HORIZONTAL_TOLERANCE = 14;

interface ChartInteractionState extends CandlestickChartInteraction {
  readonly key: string;
}

interface VerticalDragStart {
  readonly key: string;
  readonly yOffset: number;
}

interface PinchStart {
  readonly key: string;
  readonly xWindow: NumericRange;
  readonly focalRatio: number;
  readonly minimumSpan: number;
}

function chartColor(value: string, fallback: string): string {
  const processed = processColor(value);
  if (typeof processed !== "number") return fallback;
  const argb = processed >>> 0;
  const alpha = ((argb >>> 24) & 255) / 255;
  return `rgba(${(argb >>> 16) & 255}, ${(argb >>> 8) & 255}, ${argb & 255}, ${alpha})`;
}

function formatTimestamp(timestamp: number, interval: TradeChartInterval) {
  const options: Intl.DateTimeFormatOptions =
    interval === "1d"
      ? { month: "short", day: "numeric" }
      : {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        };
  return new Intl.DateTimeFormat(undefined, options).format(
    new Date(timestamp),
  );
}

function formatAxisPrice(value: number): string {
  return Math.abs(value) >= 1
    ? COMPACT_AXIS_FORMATTER.format(value)
    : SMALL_AXIS_FORMATTER.format(value);
}

function Metric({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <View className="min-w-28 flex-1 gap-1">
      <Text className="text-xs uppercase tracking-wide text-muted">
        {label}
      </Text>
      <Text
        adjustsFontSizeToFit
        className="text-sm tabular-nums text-foreground"
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

export function MarketCandlestickChart({
  market,
  candles,
  interval,
  onIntervalChange,
  loading,
  unavailable,
  compact = false,
  realtime = false,
}: {
  readonly market: Market;
  readonly candles: readonly Candle[] | undefined;
  readonly interval: TradeChartInterval;
  readonly onIntervalChange: (interval: TradeChartInterval) => void;
  readonly loading: boolean;
  readonly unavailable: boolean;
  readonly compact?: boolean;
  readonly realtime?: boolean;
}): JSX.Element {
  const reducedMotion = useReducedMotion();
  const axisFont = useFont(BarlowSemiCondensed_400Regular, 10);
  const [success, danger, muted, separator] = useThemeColor(CHART_THEME_COLORS);
  const spec = tradeChartSpec(interval);
  const model = useMemo(
    () =>
      candles ? buildCandlestickChartModel(candles, spec.windowLabel) : null,
    [candles, spec.windowLabel],
  );
  const chartDomains = useMemo(
    () => (model ? buildCandlestickChartDomains(model.data) : null),
    [model],
  );
  const interactionKey = `${market.canonicalId}:${interval}`;
  const defaultInteraction = useMemo<ChartInteractionState>(
    () => ({
      key: interactionKey,
      xWindow: FULL_CANDLE_WINDOW,
      yOffset: 0,
    }),
    [interactionKey],
  );
  const [storedInteraction, setStoredInteraction] =
    useState<ChartInteractionState>(defaultInteraction);
  const interaction =
    storedInteraction.key === interactionKey
      ? storedInteraction
      : defaultInteraction;
  const chartViewport = useMemo(
    () =>
      chartDomains
        ? resolveCandlestickChartViewport(chartDomains, interaction)
        : null,
    [chartDomains, interaction],
  );
  const chartBoundsRef = useRef<ChartBounds | null>(null);
  const interactionRef = useRef(interaction);
  const minimumWindowSpanRef = useRef(
    minimumCandleWindowSpan(model?.data.length ?? 0, MINIMUM_VISIBLE_CANDLES),
  );
  const verticalDragStartRef = useRef<VerticalDragStart | null>(null);
  const pinchStartRef = useRef<PinchStart | null>(null);
  interactionRef.current = interaction;
  minimumWindowSpanRef.current = minimumCandleWindowSpan(
    model?.data.length ?? 0,
    MINIMUM_VISIBLE_CANDLES,
  );

  const chartGesture = useMemo(() => {
    const verticalDrag = Gesture.Pan()
      .minPointers(1)
      .maxPointers(1)
      .activeOffsetY([
        -VERTICAL_DRAG_ACTIVATION_OFFSET,
        VERTICAL_DRAG_ACTIVATION_OFFSET,
      ])
      .failOffsetX([
        -VERTICAL_DRAG_HORIZONTAL_TOLERANCE,
        VERTICAL_DRAG_HORIZONTAL_TOLERANCE,
      ])
      .runOnJS(true)
      .onStart(() => {
        const current = interactionRef.current;
        verticalDragStartRef.current = {
          key: current.key,
          yOffset: current.yOffset,
        };
      })
      .onUpdate(({ translationY }) => {
        const start = verticalDragStartRef.current;
        const bounds = chartBoundsRef.current;
        if (!start || !bounds) return;

        const current = interactionRef.current;
        const next: ChartInteractionState = {
          key: start.key,
          xWindow:
            current.key === start.key ? current.xWindow : FULL_CANDLE_WINDOW,
          yOffset: pricePanOffset({
            startOffset: start.yOffset,
            translationY,
            plotHeight: bounds.bottom - bounds.top,
          }),
        };
        interactionRef.current = next;
        setStoredInteraction(next);
      })
      .onFinalize(() => {
        verticalDragStartRef.current = null;
      });

    const candleDensityPinch = Gesture.Pinch()
      .runOnJS(true)
      .onStart(({ focalX }) => {
        const bounds = chartBoundsRef.current;
        if (!bounds) return;

        const current = interactionRef.current;
        pinchStartRef.current = {
          key: current.key,
          xWindow: current.xWindow,
          focalRatio: horizontalFocalRatio(focalX, bounds),
          minimumSpan: minimumWindowSpanRef.current,
        };
      })
      .onUpdate(({ focalX, scale }) => {
        const start = pinchStartRef.current;
        const bounds = chartBoundsRef.current;
        if (!start || !bounds) return;

        const current = interactionRef.current;
        const next: ChartInteractionState = {
          key: start.key,
          xWindow: zoomCandleWindow({
            startWindow: start.xWindow,
            scale,
            startFocalRatio: start.focalRatio,
            currentFocalRatio: horizontalFocalRatio(focalX, bounds),
            minimumSpan: start.minimumSpan,
          }),
          yOffset: current.key === start.key ? current.yOffset : 0,
        };
        interactionRef.current = next;
        setStoredInteraction(next);
      })
      .onFinalize(() => {
        pinchStartRef.current = null;
      });

    return Gesture.Simultaneous(verticalDrag, candleDensityPinch);
  }, []);
  const colors = useMemo(
    () => ({
      positive: chartColor(success, FALLBACK_COLORS.positive),
      negative: chartColor(danger, FALLBACK_COLORS.negative),
      neutral: chartColor(muted, FALLBACK_COLORS.neutral),
      grid: chartColor(separator, FALLBACK_COLORS.grid),
    }),
    [danger, muted, separator, success],
  );

  return (
    <Card variant="default" className={compact ? "gap-2" : "gap-3"}>
      <Card.Header className="flex-row flex-wrap items-start justify-between gap-3">
        <View className="min-w-40 flex-1 gap-1">
          <Card.Title>Price chart</Card.Title>
          <Card.Description>
            {spec.windowLabel} · {spec.label} candles ·{" "}
            {realtime ? "WebSocket + REST sync" : "REST snapshot"}
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

        {model && chartViewport ? (
          <>
            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={compact ? styles.compactChart : styles.chart}
            >
              <CartesianChart
                customGestures={chartGesture}
                domain={{ y: chartViewport.y }}
                frame={{
                  lineColor: colors.grid,
                  lineWidth: {
                    top: 0,
                    right: 0,
                    bottom: StyleSheet.hairlineWidth,
                    left: 0,
                  },
                }}
                data={model.data}
                domainPadding={{ left: 4, right: 4, top: 12, bottom: 12 }}
                onChartBoundsChange={(bounds) => {
                  chartBoundsRef.current = bounds;
                }}
                padding={{ left: 2, right: 48, top: 4, bottom: 4 }}
                viewport={{ x: chartViewport.x }}
                xKey="timestamp"
                yKeys={[...TRADE_CANDLE_Y_KEYS]}
                yAxis={[
                  {
                    axisSide: "right",
                    font: axisFont,
                    formatYLabel: formatAxisPrice,
                    labelColor: colors.neutral,
                    labelOffset: 5,
                    labelPosition: "outset",
                    lineColor: colors.grid,
                    lineWidth: StyleSheet.hairlineWidth,
                    tickCount: 4,
                    yKeys: [...TRADE_CANDLE_Y_KEYS],
                  },
                ]}
              >
                {({ points, chartBounds }) => (
                  <SkiaCandlestickSeries
                    colors={{
                      positive: colors.positive,
                      negative: colors.negative,
                      neutral: colors.neutral,
                    }}
                    candleRatio={0.68}
                    chartBounds={chartBounds}
                    closePoints={points.close}
                    highPoints={points.high}
                    lowPoints={points.low}
                    minBodyHeight={1.5}
                    openPoints={points.open}
                    wickStrokeWidth={1}
                  />
                )}
              </CartesianChart>
            </View>
            <View className="flex-row justify-between gap-3">
              <Text className="text-xs tabular-nums text-muted">
                {formatTimestamp(chartViewport.x[0], interval)}
              </Text>
              <Text className="text-right text-xs tabular-nums text-muted">
                {formatTimestamp(chartViewport.x[1], interval)}
              </Text>
            </View>
            {compact ? (
              <View
                accessible
                accessibilityLabel={model.summary.accessibilityLabel}
                className="flex-row flex-wrap gap-x-3 gap-y-1"
              >
                <Text className="text-xs tabular-nums text-muted">
                  O{" "}
                  <Text className="text-foreground">{model.summary.open}</Text>
                </Text>
                <Text className="text-xs tabular-nums text-muted">
                  H{" "}
                  <Text className="text-foreground">{model.summary.high}</Text>
                </Text>
                <Text className="text-xs tabular-nums text-muted">
                  L <Text className="text-foreground">{model.summary.low}</Text>
                </Text>
                <Text className="text-xs tabular-nums text-muted">
                  C{" "}
                  <Text className="text-foreground">{model.summary.close}</Text>
                </Text>
              </View>
            ) : (
              <View
                accessible
                accessibilityLabel={model.summary.accessibilityLabel}
                className="flex-row flex-wrap gap-3"
              >
                <Metric label="Open" value={model.summary.open} />
                <Metric label="High" value={model.summary.high} />
                <Metric label="Low" value={model.summary.low} />
                <Metric label="Close" value={model.summary.close} />
              </View>
            )}
          </>
        ) : (
          <View className="gap-2 py-5">
            <Text className="text-sm text-foreground">
              Current price · {formatMarketPrice(market)}
            </Text>
            <Text
              accessibilityRole={unavailable ? "alert" : undefined}
              className="text-sm leading-5 text-muted"
            >
              {loading
                ? "Loading the latest candle series. Market summary remains visible."
                : unavailable
                  ? "Candle data is unavailable. No price path is inferred from missing data."
                  : "No valid candles are available for this window."}
            </Text>
          </View>
        )}
      </Card.Body>
    </Card>
  );
}

const styles = StyleSheet.create({
  compactChart: {
    height: 210,
    width: "100%",
  },
  chart: {
    height: 260,
    width: "100%",
  },
});
