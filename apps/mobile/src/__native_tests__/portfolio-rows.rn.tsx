import { expect, jest, test } from "@jest/globals";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { useState } from "react";

import { MARKET_FIXTURE } from "../features/markets/fixture";
import { PORTFOLIO_FIXTURE } from "../features/portfolio/portfolio.fixture";
import {
  type CloseDraft,
  type NormalizedPortfolio,
  normalizePortfolioSnapshot,
  type PortfolioOpenOrderRow,
  type PortfolioPositionRow,
  type PositionTpslDraft,
} from "../features/portfolio/portfolio-model";
import {
  type PortfolioEditor,
  PortfolioRows,
} from "../features/portfolio/portfolio-rows";

jest.mock("../components/use-reduced-motion", () => ({
  useReducedMotion: () => true,
}));

const portfolio = normalizePortfolioSnapshot(PORTFOLIO_FIXTURE);
const noop = jest.fn();
type ReviewCancel = (order: PortfolioOpenOrderRow) => Promise<void>;
const cancelNoop = jest.fn<ReviewCancel>(async () => undefined);
const reviewCloseNoop = jest.fn(async () => undefined);
const reviewPositionTpslNoop = jest.fn(async () => undefined);
type ReviewClose = (
  position: PortfolioPositionRow,
  draft: CloseDraft,
) => Promise<void>;
type ReviewPositionTpsl = (
  position: PortfolioPositionRow,
  draft: PositionTpslDraft,
) => Promise<void>;

function rows(
  filter: "activity" | "fills" | "funding" | "open_orders" | "positions",
) {
  return (
    <PortfolioRows
      actionAccess={{ allowed: false, reason: "Read only" }}
      editor={null}
      error={null}
      filter={filter}
      markets={MARKET_FIXTURE}
      onCancel={cancelNoop}
      onReviewClose={reviewCloseNoop}
      onReviewPositionTpsl={reviewPositionTpslNoop}
      portfolio={portfolio}
      setEditor={noop}
    />
  );
}

function InteractivePositionRows({
  onReviewClose,
  onReviewPositionTpsl = reviewPositionTpslNoop,
  portfolioSnapshot = portfolio,
}: {
  readonly onReviewClose: ReviewClose;
  readonly onReviewPositionTpsl?: ReviewPositionTpsl;
  readonly portfolioSnapshot?: NormalizedPortfolio;
}) {
  const [editor, setEditor] = useState<PortfolioEditor | null>(null);
  return (
    <PortfolioRows
      actionAccess={{ allowed: true, message: "Ready to review." }}
      editor={editor}
      error={null}
      filter="positions"
      markets={MARKET_FIXTURE}
      onCancel={cancelNoop}
      onReviewClose={onReviewClose}
      onReviewPositionTpsl={onReviewPositionTpsl}
      portfolio={portfolioSnapshot}
      setEditor={setEditor}
    />
  );
}

test("uses pair names and readable direction labels across portfolio records", () => {
  const view = render(rows("positions"));

  expect(screen.getAllByText("DUP-USDC")).toHaveLength(2);
  expect(screen.getByText("Long")).toBeTruthy();
  expect(screen.getByText("Short")).toBeTruthy();

  view.rerender(rows("open_orders"));
  expect(screen.getAllByText("Buy")).toHaveLength(2);
  expect(screen.queryByText("B")).toBeNull();

  view.rerender(rows("fills"));
  expect(screen.getByText("DUP-USDC")).toBeTruthy();
  expect(screen.getByText("Buy")).toBeTruthy();
  expect(screen.getByText("Fill")).toBeTruthy();
  expect(screen.getByText("Closed PnL")).toBeTruthy();

  view.rerender(rows("funding"));
  expect(screen.getByText("Funding")).toBeTruthy();
  expect(screen.getByText("Payment")).toBeTruthy();

  view.rerender(rows("activity"));
  expect(screen.getByText("Buy")).toBeTruthy();
  expect(screen.getByText("Fill")).toBeTruthy();
  expect(screen.getByText("Funding")).toBeTruthy();
  expect(screen.queryByText(/\bB\b/)).toBeNull();
});

test("keeps the pressed Cancel button in Reviewing during progressive confirmation", async () => {
  let finishReview!: () => void;
  const onCancel = jest.fn<ReviewCancel>(
    () =>
      new Promise<void>((resolve) => {
        finishReview = resolve;
      }),
  );
  render(
    <PortfolioRows
      actionAccess={{ allowed: true, message: "Ready to review." }}
      editor={null}
      error={null}
      filter="open_orders"
      markets={MARKET_FIXTURE}
      onCancel={onCancel}
      onReviewClose={reviewCloseNoop}
      onReviewPositionTpsl={reviewPositionTpslNoop}
      portfolio={portfolio}
      setEditor={noop}
    />,
  );

  fireEvent.press(screen.getAllByRole("button", { name: "Cancel" })[0]);

  expect(await screen.findByText("Reviewing…")).toBeTruthy();
  for (const cancel of screen.queryAllByRole("button", { name: "Cancel" })) {
    expect(cancel.props.accessibilityState).toMatchObject({ disabled: true });
  }
  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("Review cancel")).toBeNull();

  await act(async () => finishReview());
  await waitFor(() => expect(screen.queryByText("Reviewing…")).toBeNull());
});

test("keeps the pressed Market button in Reviewing while preflight is pending", async () => {
  let finishReview!: () => void;
  const onReviewClose = jest.fn<ReviewClose>(
    () =>
      new Promise<void>((resolve) => {
        finishReview = resolve;
      }),
  );
  render(
    <PortfolioRows
      actionAccess={{ allowed: true, message: "Ready to review." }}
      editor={null}
      error={null}
      filter="positions"
      markets={MARKET_FIXTURE}
      onCancel={cancelNoop}
      onReviewClose={onReviewClose}
      onReviewPositionTpsl={reviewPositionTpslNoop}
      portfolio={portfolio}
      setEditor={noop}
    />,
  );

  fireEvent.press(screen.getByRole("button", { name: "Market" }));

  expect(await screen.findByText("Reviewing…")).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Limit" }).props.accessibilityState,
  ).toMatchObject({ disabled: true });
  expect(onReviewClose).toHaveBeenCalledTimes(1);
  expect(onReviewClose.mock.calls[0]?.[1]).toMatchObject({
    behavior: "market",
    size: "2.5",
  });

  await act(async () => finishReview());
  await waitFor(() => expect(screen.queryByText("Reviewing…")).toBeNull());
});

test("opens a reduce-only Limit form and removes the Margin action", async () => {
  const onReviewClose = jest.fn<ReviewClose>(async () => undefined);
  render(<InteractivePositionRows onReviewClose={onReviewClose} />);

  expect(screen.getByRole("button", { name: "Market" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Limit" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Margin" })).toBeNull();

  fireEvent.press(screen.getByRole("button", { name: "Limit" }));

  expect(screen.getByLabelText("Limit close for DUP")).toBeTruthy();
  fireEvent.changeText(screen.getByLabelText("Limit price for DUP"), "10.25");
  fireEvent.changeText(screen.getByLabelText("Close size for DUP"), "1.25");
  fireEvent.press(screen.getByRole("button", { name: "Close" }));

  await waitFor(() => expect(onReviewClose).toHaveBeenCalledTimes(1));
  expect(onReviewClose.mock.calls[0]?.[1]).toMatchObject({
    behavior: "limit",
    limitPrice: "10.25",
    size: "1.25",
    timeInForce: "Gtc",
  });
});

test("shows position protection and edits it from a compact icon action", async () => {
  const onReviewPositionTpsl = jest.fn<ReviewPositionTpsl>(
    async () => undefined,
  );
  render(
    <InteractivePositionRows
      onReviewClose={reviewCloseNoop}
      onReviewPositionTpsl={onReviewPositionTpsl}
    />,
  );

  expect(screen.getByText("12")).toBeTruthy();
  expect(screen.getByText("9")).toBeTruthy();
  const edit = screen.getByRole("button", {
    name: "Edit take profit for DUP",
  });
  expect(edit.props.className).toContain("w-10");
  expect(edit.props.className).toContain("min-w-10");

  fireEvent.press(edit);
  const input = screen.getByLabelText("Take profit trigger price for DUP");
  expect(input.props.value).toBe("12");
  expect(screen.getByText("Entry price")).toBeTruthy();
  expect(screen.getByText("10 USDC")).toBeTruthy();
  const percentage = screen.getByLabelText(
    "Take profit gain percentage for DUP",
  );
  expect(percentage.props.value).toBe("20");
  fireEvent.changeText(percentage, "25");
  expect(input.props.value).toBe("12.5");
  fireEvent.changeText(input, "13");
  expect(percentage.props.value).toBe("30");
  fireEvent.changeText(percentage, "25");
  fireEvent.press(screen.getByRole("button", { name: "Save change" }));

  await waitFor(() => expect(onReviewPositionTpsl).toHaveBeenCalledTimes(1));
  expect(onReviewPositionTpsl.mock.calls[0]?.[1]).toEqual({
    positionId: ":DUP",
    kind: "take_profit",
    triggerPrice: "12.5",
    existingOid: 170,
  });
});

test("offers a loss percentage when editing stop loss", () => {
  render(<InteractivePositionRows onReviewClose={reviewCloseNoop} />);

  fireEvent.press(
    screen.getByRole("button", { name: "Edit stop loss for DUP" }),
  );

  const percentage = screen.getByLabelText("Stop loss percentage for DUP");
  const triggerPrice = screen.getByLabelText("Stop loss trigger price for DUP");
  expect(percentage.props.value).toBe("10");
  fireEvent.changeText(percentage, "15");
  expect(triggerPrice.props.value).toBe("8.5");
});

test("restores a precision-safe current midpoint in the Limit close form", () => {
  const portfolioWithMid = normalizePortfolioSnapshot({
    ...PORTFOLIO_FIXTURE,
    markets: PORTFOLIO_FIXTURE.markets.map((market) =>
      market.canonicalId === "perp:0:4"
        ? { ...market, midPx: "79112.4" as const }
        : market,
    ),
  });
  render(
    <InteractivePositionRows
      onReviewClose={jest.fn(async () => undefined)}
      portfolioSnapshot={portfolioWithMid}
    />,
  );

  fireEvent.press(screen.getByRole("button", { name: "Limit" }));
  const input = screen.getByLabelText("Limit price for DUP");
  fireEvent.changeText(input, "1");
  fireEvent.press(
    screen.getByRole("button", { name: "Use current mid price for DUP" }),
  );

  expect(screen.getByLabelText("Limit price for DUP").props.value).toBe(
    "79112",
  );
});
