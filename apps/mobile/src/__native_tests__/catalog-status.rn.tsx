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

  expect(screen.getByText("Market update")).toBeTruthy();
  expect(screen.getByText("Some market data may be out of date.")).toBeTruthy();
  expect(screen.queryByText(/metaAndAssetCtxs/)).toBeNull();

  fireEvent.press(screen.getByText("Try again"));
  expect(onRetry).toHaveBeenCalledTimes(1);
});
