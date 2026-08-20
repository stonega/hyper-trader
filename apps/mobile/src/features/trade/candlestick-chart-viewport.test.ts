import { describe, expect, test } from "bun:test";

import {
  buildCandlestickChartDomains,
  FULL_CANDLE_WINDOW,
  horizontalFocalRatio,
  minimumCandleWindowSpan,
  pricePanOffset,
  resolveCandlestickChartViewport,
  zoomCandleWindow,
} from "./candlestick-chart-viewport";

describe("candlestick chart viewport", () => {
  test("derives the complete time and price domains from candle geometry", () => {
    expect(
      buildCandlestickChartDomains([
        { timestamp: 1, open: 10, high: 13, low: 9, close: 12 },
        { timestamp: 2, open: 12, high: 15, low: 11, close: 14 },
      ]),
    ).toEqual({ x: [1, 2], y: [9, 15] });
  });

  test("gives a flat series a finite non-zero price range", () => {
    const domains = buildCandlestickChartDomains([
      { timestamp: 1, open: 10, high: 10, low: 10, close: 10 },
    ]);

    expect(domains?.y[0]).toBeLessThan(10);
    expect(domains?.y[1]).toBeGreaterThan(10);
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
        { xWindow: FULL_CANDLE_WINDOW, yOffset },
      ).y,
    ).toEqual([12.5, 22.5]);
  });

  test("zooms candle density around the pinch focal point", () => {
    expect(
      zoomCandleWindow({
        startWindow: FULL_CANDLE_WINDOW,
        scale: 2,
        startFocalRatio: 0.5,
        currentFocalRatio: 0.5,
        minimumSpan: 0.1,
      }),
    ).toEqual([0.25, 0.75]);

    expect(
      resolveCandlestickChartViewport(
        { x: [100, 200], y: [10, 20] },
        { xWindow: [0.25, 0.75], yOffset: 0 },
      ).x,
    ).toEqual([125, 175]);
  });

  test("tracks a moving pinch focal point and clamps zoom to the data", () => {
    expect(
      zoomCandleWindow({
        startWindow: FULL_CANDLE_WINDOW,
        scale: 2,
        startFocalRatio: 0.25,
        currentFocalRatio: 0.5,
        minimumSpan: 0.1,
      }),
    ).toEqual([0, 0.5]);
    expect(
      zoomCandleWindow({
        startWindow: [0.25, 0.75],
        scale: 0.1,
        startFocalRatio: 0.5,
        currentFocalRatio: 0.5,
        minimumSpan: 0.1,
      }),
    ).toEqual(FULL_CANDLE_WINDOW);
  });

  test("limits density zoom to a readable minimum candle count", () => {
    const minimumSpan = minimumCandleWindowSpan(97, 12);
    const [start, end] = zoomCandleWindow({
      startWindow: FULL_CANDLE_WINDOW,
      scale: 100,
      startFocalRatio: 0.5,
      currentFocalRatio: 0.5,
      minimumSpan,
    });

    expect(end - start).toBeCloseTo(11 / 96);
    expect(minimumCandleWindowSpan(8, 12)).toBe(1);
  });

  test("maps pinch coordinates into the bounded plot area", () => {
    const bounds = { left: 10, right: 110 };
    expect(horizontalFocalRatio(60, bounds)).toBe(0.5);
    expect(horizontalFocalRatio(-20, bounds)).toBe(0);
    expect(horizontalFocalRatio(140, bounds)).toBe(1);
  });
});
