import { expect, jest, test } from "@jest/globals";
import {
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react-native";
import { View } from "react-native";

import {
  TradeActivityPlaceholder,
  TradeChartPlaceholder,
  TradeMarketSummaryPlaceholder,
  TradeOrderEntryPlaceholder,
} from "../features/trade/trade-loading-cards";

jest.mock("../components/use-reduced-motion", () => ({
  useReducedMotion: () => false,
}));

test("Trade renders the final card layout while market data loads", () => {
  const onIntervalChange = jest.fn();
  render(
    <View>
      <TradeMarketSummaryPlaceholder />
      <TradeChartPlaceholder
        interval="15m"
        onIntervalChange={onIntervalChange}
      />
      <TradeOrderEntryPlaceholder splitWorkspace={false} />
      <TradeActivityPlaceholder splitWorkspace={false} />
    </View>,
  );

  expect(screen.getByText("24h volume")).toBeTruthy();
  expect(screen.getByText("Funding")).toBeTruthy();
  expect(screen.getByText("Open interest")).toBeTruthy();
  expect(screen.getByText("- · 24h")).toBeTruthy();
  expect(screen.getAllByText("-").length).toBeGreaterThanOrEqual(7);

  expect(screen.getByText("Price chart")).toBeTruthy();
  expect(screen.getByText("24 hours · 15m · Live")).toBeTruthy();
  expect(screen.getByRole("button", { name: "1m" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "15m" })).toBeTruthy();
  fireEvent.press(screen.getByRole("button", { name: "1H" }));
  expect(onIntervalChange).toHaveBeenCalledWith("1h");

  expect(screen.getByRole("tab", { name: "Market" })).toBeDisabled();
  expect(screen.getByRole("tab", { name: "Limit" })).toBeDisabled();
  expect(screen.getByText("Size presets")).toBeTruthy();
  const availableFunds = screen.getByTestId("available-funds-row");
  expect(within(availableFunds).getByText("Available margin")).toBeTruthy();
  expect(within(availableFunds).getByText("-")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Buy / Long" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Sell / Short" })).toBeDisabled();

  expect(screen.getByText("Market activity")).toBeTruthy();
  expect(screen.getByRole("tab", { name: "Book" })).toBeTruthy();
  expect(screen.getByRole("tab", { name: "Trades" })).toBeTruthy();
  expect(screen.getByText("Side")).toBeTruthy();
  expect(screen.getByText("Price")).toBeTruthy();
  expect(screen.getAllByText("Size")).toHaveLength(2);
  expect(screen.queryByText(/Loading selected|Loading order-book/)).toBeNull();
});
