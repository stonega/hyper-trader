import type { L2Book } from "@hyper-trader/hyperliquid/public";
import { describe, expect, jest, test } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react-native";

import { MarketActivity } from "../components/order-book/market-activity";

jest.mock("../components/use-reduced-motion", () => ({
  useReducedMotion: () => false,
}));

const book: L2Book = {
  coin: "BTC",
  time: 1_725_000_000_000,
  asks: [{ price: "100.5", size: "2", orderCount: 3 }],
  bids: [{ price: "100", size: "1", orderCount: 2 }],
};

describe("market activity order-book selection", () => {
  test("keeps tabs and column headers visible while rows load", () => {
    render(
      <MarketActivity
        book={undefined}
        bookLoading
        bookUnavailable={false}
        compact
        trades={undefined}
        tradesLoading
        tradesUnavailable={false}
      />,
    );

    expect(screen.getByRole("tab", { name: "Book" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Trades" })).toBeTruthy();
    expect(screen.getByText("Side")).toBeTruthy();
    expect(screen.getByText("Price")).toBeTruthy();
    expect(screen.getByText("Size")).toBeTruthy();
    expect(screen.queryByText(/Loading order-book levels/)).toBeNull();

    fireEvent.press(screen.getByRole("tab", { name: "Trades" }));

    expect(screen.getByText("Side")).toBeTruthy();
    expect(screen.getByText("Price")).toBeTruthy();
    expect(screen.getByText("Size")).toBeTruthy();
    expect(screen.queryByText(/Loading recent trades/)).toBeNull();
  });

  test("passes an exact selected price to order entry", () => {
    const onSelectPrice = jest.fn<(price: string) => void>();
    render(
      <MarketActivity
        book={book}
        bookLoading={false}
        bookUnavailable={false}
        onSelectPrice={onSelectPrice}
        trades={[]}
        tradesLoading={false}
        tradesUnavailable={false}
      />,
    );

    fireEvent.press(
      screen.getByRole("button", {
        name: "Ask, price 100.5, size 2, 3 orders",
      }),
    );

    expect(onSelectPrice).toHaveBeenCalledWith("100.5");
  });
});
