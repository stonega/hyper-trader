import { describe, expect, test } from "bun:test";

import {
  buildCandlestickChartDomains,
  buildCandlestickPriceDomain,
  horizontalFocalRatio,
  minimumCandleRangeSpan,
  panCandleRange,
  pricePanOffset,
  resolveCandlestickChartViewport,
  zoomCandleRange,
} from "./candlestick-chart-viewport";

const datum = (
  timestamp: number,
  open: number,
  high: number,
  low: number,
  close: number,
) => ({
  timestamp,
  open,
  high,
  low,
  close,
  volume: 1,
  positiveVolume: close > open ? 1 : null,
  negativeVolume: close < open ? 1 : null,
  neutralVolume: close === open ? 1 : null,
});

describe("candlestick chart viewport", () => {
  test("derives the complete time and price domains from candle geometry", () => {
    expect(
      buildCandlestickChartDomains([
        datum(1, 10, 13, 9, 12),
        datum(2, 12, 15, 11, 14),
      ]),
    ).toEqual({ x: [1, 2], y: [9, 15] });
  });

  test("gives a flat series a finite non-zero price range", () => {
    const domains = buildCandlestickChartDomains([datum(1, 10, 10, 10, 10)]);

    expect(domains?.y[0]).toBeLessThan(10);
    expect(domains?.y[1]).toBeGreaterThan(10);
  });

  test("derives the price domain only from the visible timestamp range", () => {
    expect(
      buildCandlestickPriceDomain(
        [datum(1, 10, 12, 9, 11), datum(2, 100, 120, 90, 110)],
        [1, 1],
      ),
    ).toEqual([9, 12]);
  });

  test("moves the price domain in the same direction as a vertical drag", () => {
    const yOffset = pricePanOffset({
      startOffset: 0,
      translationY: 50,
      plotHeight: 200,
    });

    expect(yOffset).toBe(0.25);
    expect(
      resolveCandlestickChartViewport(
        { x: [100, 200], y: [10, 20] },
        { xRange: [100, 200], yOffset },
      ).y,
    ).toEqual([12.5, 22.5]);
  });

  test("zooms candle density around the pinch focal point", () => {
    expect(
      zoomCandleRange({
        startRange: [100, 200],
        bounds: [100, 200],
        scale: 2,
        startFocalRatio: 0.5,
        currentFocalRatio: 0.5,
        minimumSpan: 0.1,
      }),
    ).toEqual([125, 175]);

    expect(
      resolveCandlestickChartViewport(
        { x: [100, 200], y: [10, 20] },
        { xRange: [125, 175], yOffset: 0 },
      ).x,
    ).toEqual([125, 175]);
  });

  test("tracks a moving pinch focal point and clamps zoom to the data", () => {
    expect(
      zoomCandleRange({
        startRange: [100, 200],
        bounds: [100, 200],
        scale: 2,
        startFocalRatio: 0.25,
        currentFocalRatio: 0.5,
        minimumSpan: 0.1,
      }),
    ).toEqual([100, 150]);
    expect(
      zoomCandleRange({
        startRange: [125, 175],
        bounds: [100, 200],
        scale: 0.1,
        startFocalRatio: 0.5,
        currentFocalRatio: 0.5,
        minimumSpan: 0.1,
      }),
    ).toEqual([100, 200]);
  });

  test("limits density zoom to a readable minimum candle count", () => {
    const data = Array.from({ length: 97 }, (_, index) =>
      datum(index * 100, 10, 11, 9, 10),
    );
    const minimumSpan = minimumCandleRangeSpan(data, 12);
    const [start, end] = zoomCandleRange({
      startRange: [0, 9_600],
      bounds: [0, 9_600],
      scale: 100,
      startFocalRatio: 0.5,
      currentFocalRatio: 0.5,
      minimumSpan,
    });

    expect(end - start).toBe(1_100);
    expect(minimumCandleRangeSpan(data.slice(0, 8), 12)).toBe(700);
  });

  test("pans a timestamp range and clamps it to loaded history", () => {
    expect(
      panCandleRange({
        startRange: [150, 200],
        bounds: [100, 300],
        translationX: 50,
        plotWidth: 100,
      }),
    ).toEqual([125, 175]);
    expect(
      panCandleRange({
        startRange: [100, 150],
        bounds: [100, 300],
        translationX: 200,
        plotWidth: 100,
      }),
    ).toEqual([100, 150]);
  });

  test("maps pinch coordinates into the bounded plot area", () => {
    const bounds = { left: 10, right: 110 };
    expect(horizontalFocalRatio(60, bounds)).toBe(0.5);
    expect(horizontalFocalRatio(-20, bounds)).toBe(0);
    expect(horizontalFocalRatio(140, bounds)).toBe(1);
  });
});
