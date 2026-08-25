import type { Candle } from "@hyper-trader/hyperliquid/public";
import { describe, expect, jest, test } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";

import { MarketKlinePriceChart } from "../features/trade/kline-price-chart";
import { TRADE_CHART_FRAME_HEIGHT } from "../features/trade/market-chart-config";
import type { TradeChartOverlay } from "../features/trade/trade-chart-overlays";

let mockKlineChartProps: Record<string, unknown> = {};

jest.mock("../components/use-reduced-motion", () => ({
  useReducedMotion: () => false,
}));

jest.mock("react-native-kline-chart", () => ({
  KlineChart: (props: Record<string, unknown>) => {
    const React = require("react");
    const { View } = require("react-native");
    mockKlineChartProps = props;
    return React.createElement(View, { testID: "kline-chart" });
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

const oneHourCandles: readonly Candle[] = [
  {
    openTime: 1_720_000_000_000,
    closeTime: 1_720_003_599_999,
    symbol: "BTC",
    interval: "1h",
    open: "20",
    high: "22",
    low: "19",
    close: "21",
    volume: "8",
    tradeCount: 12,
  },
  {
    openTime: 1_720_003_600_000,
    closeTime: 1_720_007_199_999,
    symbol: "BTC",
    interval: "1h",
    open: "21",
    high: "25",
    low: "20",
    close: "24",
    volume: "13",
    tradeCount: 18,
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

describe("trade K-line price chart", () => {
  test("keeps inspection and history actions off the chart toolbar", () => {
    render(
      <MarketKlinePriceChart
        candles={candles}
        canonicalMarketId="perp:BTC"
        compact
        historyError={false}
        interval="15m"
        liveRange={[candles[0]?.openTime ?? 0, candles[1]?.openTime ?? 0]}
        loading={false}
        onIntervalChange={jest.fn()}
        overlays={overlays}
        realtime
        unavailable={false}
      />,
    );

    expect(screen.getByText("24 hours · 15m · Live")).toBeTruthy();
    expect(screen.queryByText(/WebSocket|REST/)).toBeNull();
    expect(screen.getByLabelText("Mid at 12.1")).toBeTruthy();
    expect(
      screen.getByLabelText(
        /candlestick chart with 2 candles\. Open 10\. High 13\. Low 9\. Close 12/,
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Inspect" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Older" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Live" })).toBeNull();
  });

  test("passes validated candles and the card surface color to the native chart", () => {
    render(
      <MarketKlinePriceChart
        candles={candles}
        canonicalMarketId="perp:BTC"
        compact
        interval="15m"
        liveRange={[candles[0]?.openTime ?? 0, candles[1]?.openTime ?? 0]}
        loading={false}
        onIntervalChange={jest.fn()}
        unavailable={false}
      />,
    );

    const frame = screen.getByTestId("kline-chart-frame", {
      includeHiddenElements: true,
    });
    fireEvent(frame, "layout", {
      nativeEvent: { layout: { height: 210, width: 320, x: 0, y: 0 } },
    });

    expect(
      screen.getByTestId("kline-chart", { includeHiddenElements: true }),
    ).toBeTruthy();
    expect(mockKlineChartProps).toMatchObject({
      data: [
        { close: 10, high: 11, low: 9, open: 10, time: 1_720_000_000_000 },
        { close: 12, high: 13, low: 10, open: 10, time: 1_720_000_900_000 },
      ],
      height: 210,
      width: 320,
    });
    expect(mockKlineChartProps.backgroundColor).toBe(
      StyleSheet.flatten(frame.props.style).backgroundColor,
    );
  });

  test("keeps the chart frame and data rails mounted while candles load", () => {
    const onIntervalChange = jest.fn();
    const { rerender } = render(
      <MarketKlinePriceChart
        candles={undefined}
        canonicalMarketId="perp:BTC"
        compact
        interval="15m"
        liveRange={null}
        loading
        onIntervalChange={onIntervalChange}
        overlays={overlays}
        realtime
        unavailable={false}
      />,
    );

    const loadingFrame = screen.getByTestId("kline-chart-frame", {
      includeHiddenElements: true,
    });
    expect(StyleSheet.flatten(loadingFrame.props.style).height).toBe(
      TRADE_CHART_FRAME_HEIGHT.compact,
    );
    expect(screen.queryByText(/Loading the latest candle series/)).toBeNull();
    expect(
      screen.getByTestId("kline-summary-rail", {
        includeHiddenElements: true,
      }),
    ).toBeTruthy();
    expect(screen.getByLabelText("Mid at 12.1")).toBeTruthy();

    rerender(
      <MarketKlinePriceChart
        candles={candles}
        canonicalMarketId="perp:BTC"
        compact
        interval="15m"
        liveRange={[candles[0]?.openTime ?? 0, candles[1]?.openTime ?? 0]}
        loading={false}
        onIntervalChange={onIntervalChange}
        overlays={overlays}
        realtime
        unavailable={false}
      />,
    );

    const loadedFrame = screen.getByTestId("kline-chart-frame", {
      includeHiddenElements: true,
    });
    expect(StyleSheet.flatten(loadedFrame.props.style).height).toBe(
      StyleSheet.flatten(loadingFrame.props.style).height,
    );
    expect(screen.getByTestId("kline-summary-rail")).toBeTruthy();
    expect(screen.queryByText(/Loading the latest candle series/)).toBeNull();
  });

  test("keeps the committed candle chart visible while a new interval loads", () => {
    const onIntervalChange = jest.fn();
    const { rerender } = render(
      <MarketKlinePriceChart
        candles={candles}
        canonicalMarketId="perp:BTC"
        compact
        interval="15m"
        liveRange={[candles[0]?.openTime ?? 0, candles[1]?.openTime ?? 0]}
        loading={false}
        onIntervalChange={onIntervalChange}
        realtime
        unavailable={false}
      />,
    );

    rerender(
      <MarketKlinePriceChart
        candles={undefined}
        canonicalMarketId="perp:BTC"
        compact
        interval="1h"
        liveRange={null}
        loading
        onIntervalChange={onIntervalChange}
        realtime
        unavailable={false}
      />,
    );

    expect(screen.getByText("24 hours · 15m · Loading 1H")).toBeTruthy();
    expect(
      screen.getByLabelText(
        /candlestick chart with 2 candles\. Open 10\. High 13\. Low 9\. Close 12/,
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/Loading the latest candle series/)).toBeNull();

    rerender(
      <MarketKlinePriceChart
        candles={oneHourCandles}
        canonicalMarketId="perp:BTC"
        compact
        interval="1h"
        liveRange={[
          oneHourCandles[0]?.openTime ?? 0,
          oneHourCandles[1]?.openTime ?? 0,
        ]}
        loading={false}
        onIntervalChange={onIntervalChange}
        realtime
        unavailable={false}
      />,
    );

    expect(screen.getByText("4 days · 1H · Live")).toBeTruthy();
    expect(
      screen.getByLabelText(
        /candlestick chart with 2 candles\. Open 20\. High 25\. Low 19\. Close 24/,
      ),
    ).toBeTruthy();
  });

  test("does not retain candles across market scopes", () => {
    const onIntervalChange = jest.fn();
    const { rerender } = render(
      <MarketKlinePriceChart
        candles={candles}
        canonicalMarketId="perp:BTC"
        compact
        interval="15m"
        liveRange={[candles[0]?.openTime ?? 0, candles[1]?.openTime ?? 0]}
        loading={false}
        onIntervalChange={onIntervalChange}
        realtime
        unavailable={false}
      />,
    );

    rerender(
      <MarketKlinePriceChart
        candles={undefined}
        canonicalMarketId="perp:ETH"
        compact
        interval="15m"
        liveRange={null}
        loading
        onIntervalChange={onIntervalChange}
        realtime
        unavailable={false}
      />,
    );

    expect(screen.queryByText(/Loading the latest candle series/)).toBeNull();
    expect(
      screen.queryByLabelText(/candlestick chart with 2 candles/),
    ).toBeNull();
  });
});
