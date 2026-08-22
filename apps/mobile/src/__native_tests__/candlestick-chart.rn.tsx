import type { Candle } from "@hyper-trader/hyperliquid/public";
import { describe, expect, jest, test } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { MarketCandlestickChart } from "../features/trade/candlestick-chart";
import type { TradeChartOverlay } from "../features/trade/trade-chart-overlays";

jest.mock("../components/use-reduced-motion", () => ({
  useReducedMotion: () => false,
}));

jest.mock("@shopify/react-native-skia", () => ({
  Line: () => null,
  useFont: () => ({
    measureText: () => ({ height: 10, width: 10, x: 0, y: 0 }),
  }),
}));

jest.mock("../features/trade/skia-candlestick-series", () => ({
  SkiaCandlestickSeries: () => null,
}));

jest.mock("../features/trade/skia-trade-chart-overlays", () => ({
  SkiaTradeChartOverlays: () => null,
}));

jest.mock("react-native-gesture-handler", () => {
  const gesture = (): unknown => {
    const builder: Record<string, unknown> = {};
    const proxy = new Proxy(builder, {
      get: () => () => proxy,
    });
    return proxy;
  };
  return {
    Gesture: {
      Exclusive: gesture,
      LongPress: gesture,
      Pan: gesture,
      Pinch: gesture,
      Race: gesture,
      Simultaneous: gesture,
    },
  };
});

jest.mock("victory-native", () => ({
  Bar: () => null,
  CartesianChart: ({
    children,
    yKeys,
  }: {
    readonly children: (input: {
      readonly chartBounds: {
        readonly bottom: number;
        readonly left: number;
        readonly right: number;
        readonly top: number;
      };
      readonly points: Readonly<Record<string, readonly unknown[]>>;
      readonly xScale: (value: number) => number;
      readonly yScale: (value: number) => number;
    }) => ReactNode;
    readonly yKeys: readonly string[];
  }) => {
    const React = require("react");
    const { View } = require("react-native");
    const points = Object.fromEntries(yKeys.map((key) => [key, []]));
    return React.createElement(
      View,
      null,
      children({
        chartBounds: { bottom: 100, left: 0, right: 100, top: 0 },
        points,
        xScale: (value) => value,
        yScale: (value) => value,
      }),
    );
  },
}));

const candles: readonly Candle[] = [
  {
    openTime: 1_720_000_000_000,
    closeTime: 1_720_000_899_999,
    symbol: "BTC",
    interval: "15m",
    open: "10",
    high: "11",
    low: "9",
    close: "10",
    volume: "2",
    tradeCount: 4,
  },
  {
    openTime: 1_720_000_900_000,
    closeTime: 1_720_001_799_999,
    symbol: "BTC",
    interval: "15m",
    open: "10",
    high: "13",
    low: "10",
    close: "12",
    volume: "5",
    tradeCount: 8,
  },
];

const overlays: readonly TradeChartOverlay[] = [
  {
    id: "mid",
    kind: "mid",
    label: "Mid",
    price: "12.1",
    numericPrice: 12.1,
    tone: "accent",
    accessibilityLabel: "Mid at 12.1",
  },
];

describe("trade candlestick chart", () => {
  test("provides exact accessible inspection, history, and overlay controls", () => {
    const loadOlder = jest.fn(async () => undefined);
    render(
      <MarketCandlestickChart
        candles={candles}
        canLoadOlder
        canonicalMarketId="perp:BTC"
        compact
        historyError={false}
        interval="15m"
        liveRange={[candles[0]?.openTime ?? 0, candles[1]?.openTime ?? 0]}
        loading={false}
        loadingOlder={false}
        onIntervalChange={jest.fn()}
        onLoadOlder={loadOlder}
        overlays={overlays}
        realtime
        unavailable={false}
      />,
    );

    expect(screen.getByText("24 hours · 15m · Live")).toBeTruthy();
    expect(screen.queryByText(/WebSocket|REST/)).toBeNull();
    expect(screen.getByLabelText("Mid at 12.1")).toBeTruthy();

    fireEvent.press(screen.getByRole("button", { name: "Inspect" }));
    expect(
      screen.getByLabelText(
        /Open 10\. High 13\. Low 10\. Close 12\. Volume 5\. 8 trades/,
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Previous candle" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Next candle" })).toBeDisabled();

    fireEvent.press(screen.getByRole("button", { name: "Previous candle" }));
    expect(
      screen.getByLabelText(/Close 10\. Volume 2\. 4 trades/),
    ).toBeTruthy();

    fireEvent.press(screen.getByRole("button", { name: "Older" }));
    expect(loadOlder).toHaveBeenCalledTimes(1);
  });
});
