import { expect, test } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";

import { PortfolioUpdateStatus } from "../features/portfolio/portfolio-update-status";

test("portfolio update status remains visible for current data", () => {
  render(
    <PortfolioUpdateStatus
      marketFreshness="fresh"
      portfolioFreshness="fresh"
    />,
  );

  expect(screen.getByTestId("portfolio-update-status")).toBeTruthy();
  expect(screen.getByText("Up to date")).toBeTruthy();
  expect(
    screen.getByLabelText("Up to date. Portfolio data is current."),
  ).toHaveProp("accessibilityRole", "text");
});

test("portfolio update status mirrors the compact Trade status while syncing", () => {
  render(
    <PortfolioUpdateStatus
      marketFreshness="fresh"
      portfolioFreshness="refreshing"
    />,
  );

  expect(screen.getByText("Updating")).toBeTruthy();
  expect(
    screen.getByLabelText(
      "Updating. Syncing latest portfolio data. You can keep reviewing current data.",
    ),
  ).toBeTruthy();
  expect(screen.queryByText(/Syncing latest portfolio data/)).toBeNull();
});

test("portfolio update status treats a healthy catalog refresh as syncing", () => {
  render(
    <PortfolioUpdateStatus
      marketFreshness="refreshing"
      portfolioFreshness="fresh"
    />,
  );

  expect(
    screen.getByLabelText(
      "Updating. Syncing latest portfolio data. You can keep reviewing current data.",
    ),
  ).toHaveProp("accessibilityRole", "text");
});

test("portfolio update status announces stale account evidence", () => {
  render(
    <PortfolioUpdateStatus
      marketFreshness="fresh"
      portfolioFreshness="stale"
    />,
  );

  expect(
    screen.getByLabelText(
      "Refresh needed. Some portfolio data may be out of date. Pull to refresh.",
    ),
  ).toHaveProp("accessibilityRole", "alert");
});

test("portfolio update status keeps a real stale state visible during refresh", () => {
  render(
    <PortfolioUpdateStatus
      marketFreshness="refreshing"
      portfolioFreshness="stale"
    />,
  );

  expect(
    screen.getByLabelText(
      "Refresh needed. Some portfolio data may be out of date. Pull to refresh.",
    ),
  ).toHaveProp("accessibilityRole", "alert");
});
