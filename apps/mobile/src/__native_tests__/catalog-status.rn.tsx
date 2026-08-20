import { expect, jest, test } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react-native";

import { CatalogStatus } from "../features/markets/catalog-status";

jest.mock("../components/use-reduced-motion", () => ({
  useReducedMotion: () => false,
}));

test("catalog status keeps partial-source failures compact and actionable", () => {
  const onRetry = jest.fn();

  render(
    <CatalogStatus
      onRetry={onRetry}
      state={{
        canRetry: true,
        content: "ready",
        freshness: "fresh",
        hasPartialSources: true,
        hasQuarantinedMarkets: false,
        preservesTrustworthyData: false,
        statusLabel:
          "37 market sources could not refresh. Validated markets from other sources remain available.",
      }}
    />,
  );

  expect(screen.getByTestId("catalog-status")).toBeTruthy();
  expect(screen.getByText("Market update")).toBeTruthy();
  expect(screen.getByText("Some market data may be out of date.")).toBeTruthy();
  expect(screen.queryByText(/metaAndAssetCtxs/)).toBeNull();

  fireEvent.press(screen.getByLabelText("Retry market update"));
  expect(onRetry).toHaveBeenCalledTimes(1);
});

test("compact catalog status keeps its detail accessible beside the market count", () => {
  const onRetry = jest.fn();

  render(
    <CatalogStatus
      compact
      onRetry={onRetry}
      state={{
        canRetry: true,
        content: "ready",
        freshness: "stale",
        hasPartialSources: false,
        hasQuarantinedMarkets: false,
        preservesTrustworthyData: true,
        statusLabel: "Showing saved market data while refresh is unavailable.",
      }}
    />,
  );

  expect(screen.getByText("Market update")).toBeTruthy();
  expect(screen.queryByText("Some market data may be out of date.")).toBeNull();
  expect(
    screen.getByLabelText(
      "Market update. Some market data may be out of date.",
    ),
  ).toBeTruthy();

  fireEvent.press(screen.getByLabelText("Retry market update"));
  expect(onRetry).toHaveBeenCalledTimes(1);
});
