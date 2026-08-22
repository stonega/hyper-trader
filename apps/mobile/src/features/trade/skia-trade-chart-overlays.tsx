import {
  Circle,
  DashPathEffect,
  Line,
  type SkFont,
  Text as SkiaText,
} from "@shopify/react-native-skia";
import type { JSX } from "react";
import { Fragment, useMemo } from "react";
import type { ChartBounds, Scale } from "victory-native";

import type {
  TradeChartOverlay,
  TradeChartOverlayTone,
} from "./trade-chart-overlays";

interface SelectedCandlePoint {
  readonly timestamp: number;
  readonly close: number;
}

interface LabelPosition {
  readonly overlay: TradeChartOverlay;
  readonly y: number;
}

const LABEL_GAP = 12;
const MAX_VISIBLE_ORDER_LINES = 24;

function labelPositions(
  overlays: readonly TradeChartOverlay[],
  yScale: Scale,
  bounds: ChartBounds,
): LabelPosition[] {
  const labels = overlays
    .filter(
      ({ kind }) =>
        kind === "last" ||
        kind === "mid" ||
        kind === "mark" ||
        kind === "liquidation" ||
        kind === "draft",
    )
    .map((overlay) => ({
      overlay,
      y: Math.max(
        bounds.top + LABEL_GAP,
        Math.min(bounds.bottom - 2, yScale(overlay.numericPrice)),
      ),
    }))
    .filter(({ y }) => Number.isFinite(y))
    .sort((left, right) => left.y - right.y);
  for (let index = 1; index < labels.length; index += 1) {
    const previous = labels[index - 1];
    const current = labels[index];
    if (previous && current && current.y < previous.y + LABEL_GAP) {
      labels[index] = { ...current, y: previous.y + LABEL_GAP };
    }
  }
  const last = labels.at(-1);
  if (last && last.y > bounds.bottom - 2) {
    const shift = last.y - (bounds.bottom - 2);
    return labels.map((label) => ({ ...label, y: label.y - shift }));
  }
  return labels;
}

export function SkiaTradeChartOverlays({
  overlays,
  selected,
  xScale,
  yScale,
  chartBounds,
  font,
  colors,
}: {
  readonly overlays: readonly TradeChartOverlay[];
  readonly selected: SelectedCandlePoint | null;
  readonly xScale: Scale;
  readonly yScale: Scale;
  readonly chartBounds: ChartBounds;
  readonly font: SkFont | null;
  readonly colors: Readonly<
    Record<TradeChartOverlayTone | "crosshair", string>
  >;
}): JSX.Element {
  const visibleOverlays = useMemo(() => {
    const priority = overlays.filter(
      ({ kind }) => kind !== "open_order" && kind !== "trigger_order",
    );
    const orders = overlays
      .filter(({ kind }) => kind === "open_order" || kind === "trigger_order")
      .slice(-MAX_VISIBLE_ORDER_LINES);
    return [...priority, ...orders].filter(({ numericPrice }) => {
      const y = yScale(numericPrice);
      return y >= chartBounds.top && y <= chartBounds.bottom;
    });
  }, [chartBounds.bottom, chartBounds.top, overlays, yScale]);
  const labels = useMemo(
    () => labelPositions(visibleOverlays, yScale, chartBounds),
    [chartBounds, visibleOverlays, yScale],
  );
  const selectedX = selected ? xScale(selected.timestamp) : null;
  const selectedY = selected ? yScale(selected.close) : null;

  return (
    <>
      {visibleOverlays.map((item) => {
        const y = yScale(item.numericPrice);
        const dashed = item.kind === "mark" || item.kind === "draft";
        return (
          <Line
            color={colors[item.tone]}
            key={item.id}
            opacity={item.kind === "mid" ? 0.9 : 0.62}
            p1={{ x: chartBounds.left, y }}
            p2={{ x: chartBounds.right, y }}
            strokeWidth={item.kind === "mid" ? 1.25 : 1}
          >
            {dashed ? <DashPathEffect intervals={[4, 4]} /> : null}
          </Line>
        );
      })}
      {font
        ? labels.map(({ overlay, y }) => {
            const text = `${overlay.label} ${overlay.price}`;
            const width = font.measureText(text).width;
            return (
              <SkiaText
                color={colors[overlay.tone]}
                font={font}
                key={`label:${overlay.id}`}
                text={text}
                x={Math.max(chartBounds.left, chartBounds.right - width - 3)}
                y={y}
              />
            );
          })
        : null}
      {selectedX !== null &&
      selectedY !== null &&
      Number.isFinite(selectedX) &&
      Number.isFinite(selectedY) ? (
        <Fragment>
          <Line
            color={colors.crosshair}
            opacity={0.72}
            p1={{ x: selectedX, y: chartBounds.top }}
            p2={{ x: selectedX, y: chartBounds.bottom }}
            strokeWidth={1}
          >
            <DashPathEffect intervals={[3, 3]} />
          </Line>
          <Circle
            color={colors.crosshair}
            cx={selectedX}
            cy={selectedY}
            r={3}
          />
        </Fragment>
      ) : null}
    </>
  );
}
