import {
  type Color,
  Path,
  Skia,
  type SkPath,
} from "@shopify/react-native-skia";
import type { JSX } from "react";
import { Fragment, useMemo } from "react";
import {
  type ChartBounds,
  getBarWidth,
  getCandlestickGeometry,
  type PointsArray,
} from "victory-native";

import { buildCandlestickPathGroups } from "./candlestick-path-groups";

// Victory Native 41.26 mutates SkPath for candlesticks, which Skia 2.6 warns
// about once per candle in debug builds. Keep Victory's geometry and render its
// result with the supported immutable PathBuilder API.
export function SkiaCandlestickSeries({
  openPoints,
  highPoints,
  lowPoints,
  closePoints,
  chartBounds,
  colors,
  candleRatio = 0.6,
  minBodyHeight = 1,
  wickStrokeWidth = 1,
}: {
  readonly openPoints: PointsArray;
  readonly highPoints: PointsArray;
  readonly lowPoints: PointsArray;
  readonly closePoints: PointsArray;
  readonly chartBounds: ChartBounds;
  readonly colors: {
    readonly positive: Color;
    readonly negative: Color;
    readonly neutral: Color;
  };
  readonly candleRatio?: number;
  readonly minBodyHeight?: number;
  readonly wickStrokeWidth?: number;
}): JSX.Element {
  const paths = useMemo(() => {
    const candleWidth = getBarWidth({
      points: openPoints,
      chartBounds,
      innerPadding: 1 - Math.max(0, Math.min(1, candleRatio)),
    });
    const geometry = getCandlestickGeometry({
      openPoints,
      highPoints,
      lowPoints,
      closePoints,
      candleWidth,
      minBodyHeight,
    });

    return buildCandlestickPathGroups<SkPath, ReturnType<typeof Skia.XYWHRect>>(
      geometry,
      {
        createBuilder: () => Skia.PathBuilder.Make(),
        createRect: ({ x, y, width, height }) =>
          Skia.XYWHRect(x, y, width, height),
      },
    );
  }, [
    candleRatio,
    chartBounds,
    closePoints,
    highPoints,
    lowPoints,
    minBodyHeight,
    openPoints,
  ]);

  return (
    <>
      {paths.map(({ status, bodyPath, wickPath }) => (
        <Fragment key={status}>
          <Path
            color={colors[status]}
            path={wickPath}
            strokeWidth={wickStrokeWidth}
            style="stroke"
          />
          <Path color={colors[status]} path={bodyPath} style="fill" />
        </Fragment>
      ))}
    </>
  );
}
