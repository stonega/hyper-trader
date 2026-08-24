import { BarlowSemiCondensed_400Regular } from "@expo-google-fonts/barlow-semi-condensed/400Regular";
import type { Candle } from "@hyper-trader/hyperliquid/public";
import { Line as SkiaLine, useFont } from "@shopify/react-native-skia";
import { Button } from "heroui-native/button";
import { Card } from "heroui-native/card";
import { useThemeColor } from "heroui-native/hooks";
import type { JSX } from "react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Platform,
  processColor,
  StyleSheet,
  Vibration,
  View,
} from "react-native";
import { Gesture } from "react-native-gesture-handler";
import { runOnJS, useSharedValue } from "react-native-reanimated";
import { Bar, CartesianChart, type ChartBounds } from "victory-native";

import { AppText as Text } from "../../components/app-text";
import { COMPACT_SEGMENT_HIT_SLOP } from "../../components/ui/control-metrics";
import { useReducedMotion } from "../../components/use-reduced-motion";
import {
  buildCandlestickChartModel,
  nearestCandleIndex,
} from "./candlestick-chart-model";
import {
  buildCandlestickChartDomains,
  buildCandlestickPriceDomain,
  type CandlestickChartInteraction,
  horizontalFocalRatio,
  minimumCandleRangeSpan,
  type NumericRange,
  panCandleRange,
  pricePanOffset,
  resolveCandlestickChartViewport,
  zoomCandleRange,
} from "./candlestick-chart-viewport";
import {
  formatTradeChartAxisPrice,
  TRADE_CANDLE_Y_KEYS,
  TRADE_CHART_INTERVALS,
  TRADE_VOLUME_Y_KEYS,
  type TradeChartInterval,
  tradeChartSpec,
} from "./market-chart-config";
import { SkiaCandlestickSeries } from "./skia-candlestick-series";
import { SkiaTradeChartOverlays } from "./skia-trade-chart-overlays";
import type { TradeChartOverlay } from "./trade-chart-overlays";

const CHART_THEME_COLORS = [
  "success",
  "danger",
  "muted",
  "separator",
  "accent",
  "warning",
] as const;

const FALLBACK_COLORS = {
  positive: "#22c988",
  negative: "#ef5b67",
  neutral: "#87908e",
  grid: "#36413e",
  accent: "#4ea7ff",
  warning: "#f1b84b",
} as const;

const MINIMUM_VISIBLE_CANDLES = 12;
const VERTICAL_DRAG_ACTIVATION_OFFSET = 6;
const VERTICAL_DRAG_HORIZONTAL_TOLERANCE = 14;
const HORIZONTAL_DRAG_ACTIVATION_OFFSET = 6;
const HORIZONTAL_DRAG_VERTICAL_TOLERANCE = 14;
const CHART_INTERACTION_PUBLISH_INTERVAL_MS = 32;
const CANDLE_INSPECTION_LONG_PRESS_MS = 260;

interface ChartInteractionState extends CandlestickChartInteraction {
  readonly key: string;
  readonly followLive: boolean;
}

interface RetainedCandleSeries {
  readonly canonicalMarketId: string;
  readonly candles: readonly Candle[];
  readonly interval: TradeChartInterval;
  readonly liveRange: NumericRange | null;
}

interface VerticalDragStart {
  readonly key: string;
  readonly yOffset: number;
}

interface PinchStart {
  readonly key: string;
  readonly xRange: NumericRange;
  readonly focalRatio: number;
  readonly minimumSpan: number;
}

interface HorizontalDragStart {
  readonly key: string;
  readonly xRange: NumericRange;
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

function selectionHaptic(): void {
  // React Native's iOS Vibration API emits a long system vibration rather than
  // a selection tick. Keep this deliberately subtle on supported Android hosts.
  if (Platform.OS === "android") Vibration.vibrate(5);
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

function MarketCandlestickChartComponent({
  canonicalMarketId,
  candles,
  interval,
  onIntervalChange,
  loading,
  unavailable,
  liveRange,
  overlays = [],
  onLoadOlder,
  canLoadOlder = false,
  loadingOlder = false,
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
  readonly liveRange: NumericRange | null;
  readonly overlays?: readonly TradeChartOverlay[];
  readonly onLoadOlder?: () => Promise<void>;
  readonly canLoadOlder?: boolean;
  readonly loadingOlder?: boolean;
  readonly historyError?: boolean;
  readonly compact?: boolean;
  readonly realtime?: boolean;
}): JSX.Element {
  const reducedMotion = useReducedMotion();
  const axisFont = useFont(BarlowSemiCondensed_400Regular, 10);
  const [success, danger, muted, separator, accent, warning] =
    useThemeColor(CHART_THEME_COLORS);
  const retainedSeriesRef = useRef<RetainedCandleSeries | null>(null);
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
  const chartDomains = useMemo(
    () => (model ? buildCandlestickChartDomains(model.data) : null),
    [model],
  );
  const interactionKey = `${canonicalMarketId}:${displayedInterval}`;
  const currentLiveRange =
    displayedLiveRange ??
    chartDomains?.x ??
    ([0, 1] as const satisfies NumericRange);
  const defaultInteraction = useMemo<ChartInteractionState>(
    () => ({
      key: interactionKey,
      xRange: currentLiveRange,
      yOffset: 0,
      followLive: true,
    }),
    [currentLiveRange, interactionKey],
  );
  const [storedInteraction, setStoredInteraction] =
    useState<ChartInteractionState>(defaultInteraction);
  const interaction =
    storedInteraction.key !== interactionKey
      ? defaultInteraction
      : storedInteraction.followLive
        ? { ...storedInteraction, xRange: currentLiveRange }
        : storedInteraction;
  const chartViewport = useMemo(() => {
    if (!chartDomains || !model) return null;
    const horizontal = resolveCandlestickChartViewport(
      chartDomains,
      interaction,
    );
    const visiblePrices = buildCandlestickPriceDomain(model.data, horizontal.x);
    return resolveCandlestickChartViewport(
      visiblePrices ? { ...chartDomains, y: visiblePrices } : chartDomains,
      interaction,
    );
  }, [chartDomains, interaction, model]);
  const visibleMaximumVolume = useMemo(() => {
    if (!model || !chartViewport) return null;
    let maximum: number | null = null;
    for (const candle of model.data) {
      if (
        candle.timestamp < chartViewport.x[0] ||
        candle.timestamp > chartViewport.x[1] ||
        candle.volume === null
      ) {
        continue;
      }
      maximum = Math.max(maximum ?? 0, candle.volume);
    }
    return maximum;
  }, [chartViewport, model]);
  const chartBoundsRef = useRef<ChartBounds | null>(null);
  const interactionRef = useRef(interaction);
  const minimumWindowSpanRef = useRef(
    minimumCandleRangeSpan(model?.data ?? [], MINIMUM_VISIBLE_CANDLES),
  );
  const verticalDragStartRef = useRef<VerticalDragStart | null>(null);
  const pinchStartRef = useRef<PinchStart | null>(null);
  const horizontalDragStartRef = useRef<HorizontalDragStart | null>(null);
  const chartDomainsRef = useRef(chartDomains);
  const chartViewportRef = useRef(chartViewport);
  const inspectionRef = useRef(model?.inspection ?? []);
  const selectedTimestampRef = useRef<number | null>(null);
  const [selectedTimestamp, setSelectedTimestamp] = useState<number | null>(
    null,
  );
  interactionRef.current = interaction;
  chartDomainsRef.current = chartDomains;
  chartViewportRef.current = chartViewport;
  inspectionRef.current = model?.inspection ?? [];
  selectedTimestampRef.current = selectedTimestamp;
  minimumWindowSpanRef.current = minimumCandleRangeSpan(
    model?.data ?? [],
    MINIMUM_VISIBLE_CANDLES,
  );

  const startVerticalDrag = useCallback(() => {
    const current = interactionRef.current;
    verticalDragStartRef.current = {
      key: current.key,
      yOffset: current.yOffset,
    };
  }, []);
  const updateVerticalDrag = useCallback((translationY: number) => {
    const start = verticalDragStartRef.current;
    const bounds = chartBoundsRef.current;
    if (!start || !bounds) return;
    const current = interactionRef.current;
    const next: ChartInteractionState = {
      key: start.key,
      xRange:
        current.key === start.key
          ? current.xRange
          : (chartDomainsRef.current?.x ?? ([0, 1] as const)),
      yOffset: pricePanOffset({
        startOffset: start.yOffset,
        translationY,
        plotHeight: bounds.bottom - bounds.top,
      }),
      followLive: current.key === start.key ? current.followLive : true,
    };
    interactionRef.current = next;
    setStoredInteraction(next);
  }, []);
  const finishVerticalDrag = useCallback(
    (translationY: number) => {
      updateVerticalDrag(translationY);
      verticalDragStartRef.current = null;
    },
    [updateVerticalDrag],
  );
  const startPinch = useCallback((focalX: number) => {
    const bounds = chartBoundsRef.current;
    if (!bounds) return;
    const current = interactionRef.current;
    pinchStartRef.current = {
      key: current.key,
      xRange: current.xRange,
      focalRatio: horizontalFocalRatio(focalX, bounds),
      minimumSpan: minimumWindowSpanRef.current,
    };
  }, []);
  const updatePinch = useCallback((focalX: number, scale: number) => {
    const start = pinchStartRef.current;
    const bounds = chartBoundsRef.current;
    const domains = chartDomainsRef.current;
    if (!start || !bounds || !domains) return;
    const current = interactionRef.current;
    const next: ChartInteractionState = {
      key: start.key,
      xRange: zoomCandleRange({
        startRange: start.xRange,
        bounds: domains.x,
        scale,
        startFocalRatio: start.focalRatio,
        currentFocalRatio: horizontalFocalRatio(focalX, bounds),
        minimumSpan: start.minimumSpan,
      }),
      yOffset: current.key === start.key ? current.yOffset : 0,
      followLive: false,
    };
    interactionRef.current = next;
    setStoredInteraction(next);
  }, []);
  const finishPinch = useCallback(
    (focalX: number, scale: number) => {
      updatePinch(focalX, scale);
      pinchStartRef.current = null;
    },
    [updatePinch],
  );
  const startHorizontalDrag = useCallback(() => {
    const current = interactionRef.current;
    horizontalDragStartRef.current = {
      key: current.key,
      xRange: current.xRange,
    };
  }, []);
  const horizontalInteraction = useCallback(
    (translationX: number): ChartInteractionState | null => {
      const start = horizontalDragStartRef.current;
      const bounds = chartBoundsRef.current;
      const domains = chartDomainsRef.current;
      if (!start || !bounds || !domains) return null;
      const current = interactionRef.current;
      return {
        key: start.key,
        xRange: panCandleRange({
          startRange: start.xRange,
          bounds: domains.x,
          translationX,
          plotWidth: bounds.right - bounds.left,
        }),
        yOffset: current.key === start.key ? current.yOffset : 0,
        followLive: false,
      };
    },
    [],
  );
  const updateHorizontalDrag = useCallback(
    (translationX: number) => {
      const next = horizontalInteraction(translationX);
      if (!next) return;
      interactionRef.current = next;
      setStoredInteraction(next);
    },
    [horizontalInteraction],
  );
  const finishHorizontalDrag = useCallback(
    (translationX: number) => {
      const next = horizontalInteraction(translationX);
      if (next) {
        interactionRef.current = next;
        setStoredInteraction(next);
        const domains = chartDomainsRef.current;
        if (
          domains &&
          next.xRange[0] <= domains.x[0] + 1 &&
          canLoadOlder &&
          !loadingOlder &&
          onLoadOlder
        ) {
          void onLoadOlder();
        }
      }
      horizontalDragStartRef.current = null;
    },
    [canLoadOlder, horizontalInteraction, loadingOlder, onLoadOlder],
  );
  const selectCandleAtX = useCallback((x: number) => {
    const bounds = chartBoundsRef.current;
    const viewport = chartViewportRef.current;
    const inspection = inspectionRef.current;
    if (!bounds || !viewport || inspection.length === 0) return;
    const ratio = horizontalFocalRatio(x, bounds);
    const timestamp = viewport.x[0] + ratio * (viewport.x[1] - viewport.x[0]);
    const index = nearestCandleIndex(inspection, timestamp);
    const selected = index === null ? null : inspection[index]?.timestamp;
    if (selected === undefined || selected === null) return;
    if (selectedTimestampRef.current !== selected) {
      selectionHaptic();
      selectedTimestampRef.current = selected;
      setSelectedTimestamp(selected);
    }
  }, []);
  const lastVerticalPublishAt = useSharedValue(0);
  const lastHorizontalPublishAt = useSharedValue(0);
  const lastPinchPublishAt = useSharedValue(0);
  const lastInspectionPublishAt = useSharedValue(0);
  const inspectionActive = useSharedValue(false);

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
      .onStart(() => {
        lastVerticalPublishAt.value = 0;
        runOnJS(startVerticalDrag)();
      })
      .onUpdate(({ translationY }) => {
        const now = Date.now();
        if (
          now - lastVerticalPublishAt.value <
          CHART_INTERACTION_PUBLISH_INTERVAL_MS
        ) {
          return;
        }
        lastVerticalPublishAt.value = now;
        runOnJS(updateVerticalDrag)(translationY);
      })
      .onFinalize(({ translationY }) => {
        runOnJS(finishVerticalDrag)(translationY);
      });

    const horizontalDrag = Gesture.Pan()
      .minPointers(1)
      .maxPointers(1)
      .activeOffsetX([
        -HORIZONTAL_DRAG_ACTIVATION_OFFSET,
        HORIZONTAL_DRAG_ACTIVATION_OFFSET,
      ])
      .failOffsetY([
        -HORIZONTAL_DRAG_VERTICAL_TOLERANCE,
        HORIZONTAL_DRAG_VERTICAL_TOLERANCE,
      ])
      .onStart(() => {
        lastHorizontalPublishAt.value = 0;
        runOnJS(startHorizontalDrag)();
      })
      .onUpdate(({ translationX }) => {
        const now = Date.now();
        if (
          now - lastHorizontalPublishAt.value <
          CHART_INTERACTION_PUBLISH_INTERVAL_MS
        ) {
          return;
        }
        lastHorizontalPublishAt.value = now;
        runOnJS(updateHorizontalDrag)(translationX);
      })
      .onFinalize(({ translationX }) => {
        runOnJS(finishHorizontalDrag)(translationX);
      });

    const candleInspection = Gesture.LongPress()
      .minDuration(CANDLE_INSPECTION_LONG_PRESS_MS)
      .maxDistance(12)
      .numberOfPointers(1)
      .onStart(({ x }) => {
        inspectionActive.value = true;
        lastInspectionPublishAt.value = 0;
        runOnJS(selectCandleAtX)(x);
      })
      .onTouchesMove(({ allTouches }) => {
        if (!inspectionActive.value) return;
        const touch = allTouches[0];
        if (!touch) return;
        const now = Date.now();
        if (
          now - lastInspectionPublishAt.value <
          CHART_INTERACTION_PUBLISH_INTERVAL_MS
        ) {
          return;
        }
        lastInspectionPublishAt.value = now;
        runOnJS(selectCandleAtX)(touch.x);
      })
      .onFinalize(() => {
        inspectionActive.value = false;
      });

    const candleDensityPinch = Gesture.Pinch()
      .onStart(({ focalX }) => {
        lastPinchPublishAt.value = 0;
        runOnJS(startPinch)(focalX);
      })
      .onUpdate(({ focalX, scale }) => {
        const now = Date.now();
        if (
          now - lastPinchPublishAt.value <
          CHART_INTERACTION_PUBLISH_INTERVAL_MS
        ) {
          return;
        }
        lastPinchPublishAt.value = now;
        runOnJS(updatePinch)(focalX, scale);
      })
      .onFinalize(({ focalX, scale }) => {
        runOnJS(finishPinch)(focalX, scale);
      });

    const directionalDrag = Gesture.Exclusive(horizontalDrag, verticalDrag);
    return Gesture.Simultaneous(
      Gesture.Race(candleInspection, directionalDrag),
      candleDensityPinch,
    );
  }, [
    finishHorizontalDrag,
    finishPinch,
    finishVerticalDrag,
    inspectionActive,
    lastHorizontalPublishAt,
    lastInspectionPublishAt,
    lastPinchPublishAt,
    lastVerticalPublishAt,
    selectCandleAtX,
    startHorizontalDrag,
    startPinch,
    startVerticalDrag,
    updateHorizontalDrag,
    updatePinch,
    updateVerticalDrag,
  ]);
  const colors = useMemo(
    () => ({
      positive: chartColor(success, FALLBACK_COLORS.positive),
      negative: chartColor(danger, FALLBACK_COLORS.negative),
      neutral: chartColor(muted, FALLBACK_COLORS.neutral),
      grid: chartColor(separator, FALLBACK_COLORS.grid),
      accent: chartColor(accent, FALLBACK_COLORS.accent),
      warning: chartColor(warning, FALLBACK_COLORS.warning),
    }),
    [accent, danger, muted, separator, success, warning],
  );
  const selectedIndex =
    model && selectedTimestamp !== null
      ? nearestCandleIndex(model.inspection, selectedTimestamp)
      : null;
  const selectedCandle =
    selectedIndex === null ? null : (model?.inspection[selectedIndex] ?? null);
  const selectedPoint =
    selectedIndex === null || !model
      ? null
      : {
          timestamp: model.data[selectedIndex]?.timestamp ?? 0,
          close: model.data[selectedIndex]?.close ?? 0,
        };
  const moveSelection = useCallback(
    (offset: -1 | 1) => {
      if (!model || selectedIndex === null) return;
      const next = model.inspection[selectedIndex + offset];
      if (!next) return;
      selectionHaptic();
      selectedTimestampRef.current = next.timestamp;
      setSelectedTimestamp(next.timestamp);
    },
    [model, selectedIndex],
  );
  const returnToLive = useCallback(() => {
    const next: ChartInteractionState = {
      ...interactionRef.current,
      key: interactionKey,
      xRange: currentLiveRange,
      followLive: true,
    };
    interactionRef.current = next;
    setStoredInteraction(next);
  }, [currentLiveRange, interactionKey]);
  const resetView = useCallback(() => {
    interactionRef.current = defaultInteraction;
    setStoredInteraction(defaultInteraction);
  }, [defaultInteraction]);
  const displayedOverlays = overlays.slice(0, 8);

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

        {model && (selectedCandle || interaction.yOffset !== 0) ? (
          <View className="flex-row flex-wrap gap-2">
            {selectedCandle ? (
              <Button
                accessibilityHint="Closes candle inspection."
                animation={reducedMotion ? "disable-all" : undefined}
                className="h-10 min-h-10 px-3"
                onPress={() => {
                  selectedTimestampRef.current = null;
                  setSelectedTimestamp(null);
                }}
                size="sm"
                variant="tertiary"
              >
                Done
              </Button>
            ) : null}
            {interaction.yOffset !== 0 ? (
              <Button
                accessibilityHint="Restores the live time and automatic price ranges."
                animation={reducedMotion ? "disable-all" : undefined}
                className="h-10 min-h-10 px-3"
                onPress={resetView}
                size="sm"
                variant="tertiary"
              >
                Reset
              </Button>
            ) : null}
          </View>
        ) : null}
        {historyError ? (
          <Text accessibilityRole="alert" className="text-sm text-warning">
            Older candles could not be loaded. The current chart remains
            available.
          </Text>
        ) : null}

        {model && chartViewport ? (
          <>
            <View style={compact ? styles.compactChart : styles.chart}>
              <View
                style={compact ? styles.compactPriceChart : styles.priceChart}
              >
                <View
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  style={styles.chartCanvas}
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
                    padding={{
                      left: 2,
                      right: 0,
                      top: 4,
                      bottom: 4,
                    }}
                    viewport={{ x: chartViewport.x }}
                    xKey="timestamp"
                    yKeys={[...TRADE_CANDLE_Y_KEYS]}
                    yAxis={[
                      {
                        axisSide: "right",
                        font: axisFont,
                        formatYLabel: formatTradeChartAxisPrice,
                        labelColor: colors.neutral,
                        labelOffset: 5,
                        labelPosition: "inset",
                        lineColor: colors.grid,
                        lineWidth: StyleSheet.hairlineWidth,
                        tickCount: 4,
                        yKeys: [...TRADE_CANDLE_Y_KEYS],
                      },
                    ]}
                  >
                    {({ points, chartBounds, xScale, yScale }) => (
                      <>
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
                        <SkiaTradeChartOverlays
                          chartBounds={chartBounds}
                          colors={{
                            accent: colors.accent,
                            crosshair: colors.accent,
                            danger: colors.negative,
                            muted: colors.neutral,
                            success: colors.positive,
                            warning: colors.warning,
                          }}
                          font={axisFont}
                          overlays={overlays}
                          selected={selectedPoint}
                          xScale={xScale}
                          yScale={yScale}
                        />
                      </>
                    )}
                  </CartesianChart>
                </View>
              </View>
              {visibleMaximumVolume !== null ? (
                <View
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  style={
                    compact ? styles.compactVolumeChart : styles.volumeChart
                  }
                >
                  <CartesianChart
                    data={model.data}
                    domain={{
                      y: [
                        0,
                        visibleMaximumVolume > 0
                          ? visibleMaximumVolume * 1.08
                          : 1,
                      ],
                    }}
                    domainPadding={{ left: 4, right: 4, top: 1, bottom: 0 }}
                    padding={{
                      left: 2,
                      right: 0,
                      top: 1,
                      bottom: 1,
                    }}
                    viewport={{ x: chartViewport.x }}
                    xKey="timestamp"
                    yKeys={[...TRADE_VOLUME_Y_KEYS]}
                  >
                    {({ points, chartBounds, xScale }) => (
                      <>
                        <Bar
                          chartBounds={chartBounds}
                          color={colors.positive}
                          innerPadding={0.32}
                          opacity={0.58}
                          points={points.positiveVolume}
                        />
                        <Bar
                          chartBounds={chartBounds}
                          color={colors.negative}
                          innerPadding={0.32}
                          opacity={0.58}
                          points={points.negativeVolume}
                        />
                        <Bar
                          chartBounds={chartBounds}
                          color={colors.neutral}
                          innerPadding={0.32}
                          opacity={0.48}
                          points={points.neutralVolume}
                        />
                        {selectedPoint ? (
                          <SkiaLine
                            color={colors.accent}
                            opacity={0.72}
                            p1={{
                              x: xScale(selectedPoint.timestamp),
                              y: chartBounds.top,
                            }}
                            p2={{
                              x: xScale(selectedPoint.timestamp),
                              y: chartBounds.bottom,
                            }}
                            strokeWidth={1}
                          />
                        ) : null}
                      </>
                    )}
                  </CartesianChart>
                </View>
              ) : (
                <View
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  style={
                    compact ? styles.compactVolumeChart : styles.volumeChart
                  }
                >
                  <Text className="text-xs text-muted">Volume unavailable</Text>
                </View>
              )}
            </View>
            <View className="flex-row justify-between gap-3">
              <Text className="text-xs tabular-nums text-muted">
                {formatTimestamp(chartViewport.x[0], displayedInterval)}
              </Text>
              <Text className="text-right text-xs tabular-nums text-muted">
                {formatTimestamp(chartViewport.x[1], displayedInterval)}
              </Text>
            </View>
            {selectedCandle && selectedIndex !== null ? (
              <>
                <View
                  accessible
                  accessibilityLabel={`${formatTimestamp(selectedCandle.timestamp, displayedInterval)} candle. Open ${selectedCandle.open}. High ${selectedCandle.high}. Low ${selectedCandle.low}. Close ${selectedCandle.close}. Volume ${selectedCandle.volume}. ${selectedCandle.tradeCount} trades.`}
                  className="flex-row flex-wrap gap-x-3 gap-y-1"
                >
                  <Text className="w-full text-xs font-medium text-foreground">
                    {formatTimestamp(
                      selectedCandle.timestamp,
                      displayedInterval,
                    )}
                  </Text>
                  {(
                    [
                      ["O", selectedCandle.open],
                      ["H", selectedCandle.high],
                      ["L", selectedCandle.low],
                      ["C", selectedCandle.close],
                      ["V", selectedCandle.volume],
                      ["Trades", String(selectedCandle.tradeCount)],
                    ] as const
                  ).map(([label, value]) => (
                    <Text
                      className="text-xs tabular-nums text-muted"
                      key={label}
                    >
                      {label} <Text className="text-foreground">{value}</Text>
                    </Text>
                  ))}
                </View>
                <View className="flex-row gap-2">
                  <Button
                    accessibilityLabel="Previous candle"
                    animation={reducedMotion ? "disable-all" : undefined}
                    className="h-10 min-h-10 flex-1"
                    isDisabled={selectedIndex <= 0}
                    onPress={() => moveSelection(-1)}
                    size="sm"
                    variant="tertiary"
                  >
                    Previous
                  </Button>
                  <Button
                    accessibilityLabel="Next candle"
                    animation={reducedMotion ? "disable-all" : undefined}
                    className="h-10 min-h-10 flex-1"
                    isDisabled={selectedIndex >= model.inspection.length - 1}
                    onPress={() => moveSelection(1)}
                    size="sm"
                    variant="tertiary"
                  >
                    Next
                  </Button>
                </View>
              </>
            ) : compact ? (
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
            {displayedOverlays.length > 0 ? (
              <View
                accessible
                accessibilityLabel={displayedOverlays
                  .map(({ accessibilityLabel }) => accessibilityLabel)
                  .join(". ")}
                className="flex-row flex-wrap gap-x-3 gap-y-1"
              >
                {displayedOverlays.map((item) => (
                  <Text
                    className="text-xs tabular-nums text-muted"
                    key={item.id}
                  >
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
            {!interaction.followLive ? (
              <View className="flex-row justify-end">
                <Button
                  accessibilityHint="Returns the time window to the newest candles."
                  animation={reducedMotion ? "disable-all" : undefined}
                  className="h-10 min-h-10 px-2"
                  hitSlop={compact ? COMPACT_SEGMENT_HIT_SLOP : undefined}
                  onPress={returnToLive}
                  size="sm"
                  variant="ghost"
                >
                  <Button.Label>Live</Button.Label>
                </Button>
              </View>
            ) : null}
          </>
        ) : (
          <View className="gap-2 py-5">
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

export const MarketCandlestickChart = memo(MarketCandlestickChartComponent);

const styles = StyleSheet.create({
  chartCanvas: {
    flex: 1,
    width: "100%",
  },
  compactChart: {
    gap: 4,
    height: 210,
    width: "100%",
  },
  chart: {
    gap: 4,
    height: 260,
    width: "100%",
  },
  compactPriceChart: {
    height: 164,
    width: "100%",
  },
  priceChart: {
    height: 204,
    width: "100%",
  },
  compactVolumeChart: {
    height: 42,
    justifyContent: "center",
    width: "100%",
  },
  volumeChart: {
    height: 52,
    justifyContent: "center",
    width: "100%",
  },
});
