import { expect, test } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";
import { View } from "react-native";

import { PerformanceChart } from "../components/chart/performance-chart";
import type { PortfolioRangeData } from "../features/portfolio/portfolio-model";
import {
  PortfolioRowsPlaceholder,
  PortfolioSummaryCard,
} from "../features/portfolio/portfolio-overview";

const PORTFOLIO_DATA = {
  range: "24h",
  sourcePeriod: "day",
  accountValueHistory: [],
  pnlHistory: [],
  accountValueSummary: null,
  accountValue: "102",
  absolutePnl: "2",
  percentagePnl: "2",
  gapCount: 0,
} as const satisfies PortfolioRangeData;

test("Portfolio keeps summary and performance labels visible while data loads", () => {
  render(
    <View>
      <PortfolioSummaryCard
        data={null}
        loading
        marketFreshness="fresh"
        portfolioFreshness="fresh"
      />
      <PerformanceChart data={null} loading range="24h" />
      <PortfolioRowsPlaceholder />
    </View>,
  );

  expect(screen.getByText("Total account value")).toBeTruthy();
  expect(screen.getByText("PnL -")).toBeTruthy();
  expect(screen.getByText("Updating")).toBeTruthy();

  expect(screen.getByText("Account performance")).toBeTruthy();
  expect(screen.getByText("24 hour")).toBeTruthy();
  expect(screen.getByText("Start")).toBeTruthy();
  expect(screen.getByText("High")).toBeTruthy();
  expect(screen.getByText("Low")).toBeTruthy();
  expect(screen.getByText("End")).toBeTruthy();
  expect(screen.getAllByText("-").length).toBeGreaterThanOrEqual(7);
  expect(
    screen.getByTestId("account-performance-chart", {
      includeHiddenElements: true,
    }),
  ).toHaveStyle({ height: 128 });
  expect(screen.queryByText("History unavailable")).toBeNull();
  expect(screen.queryByText(/No performance history/)).toBeNull();

  expect(
    screen.getByLabelText("Loading Portfolio account details"),
  ).toBeTruthy();
});

test("Portfolio prefixes account value with a dollar sign", () => {
  const view = render(
    <PortfolioSummaryCard
      data={PORTFOLIO_DATA}
      loading={false}
      marketFreshness="fresh"
      portfolioFreshness="fresh"
    />,
  );

  expect(screen.getByText("$102")).toBeTruthy();
  expect(screen.getByText("PnL 2").props.className).toContain("text-success");
  expect(screen.getByText("2%").props.className).toContain("text-success");

  view.rerender(
    <PortfolioSummaryCard
      data={{
        ...PORTFOLIO_DATA,
        absolutePnl: "-2",
        percentagePnl: "-2",
      }}
      loading={false}
      marketFreshness="fresh"
      portfolioFreshness="fresh"
    />,
  );

  expect(screen.getByText("PnL -2").props.className).toContain("text-danger");
  expect(screen.getByText("-2%").props.className).toContain("text-danger");
});
