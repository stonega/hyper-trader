import { afterEach, expect, jest, test } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react-native";

import { PerformanceChart } from "../components/chart/performance-chart";
import type { PortfolioRangeData } from "../features/portfolio/portfolio-model";

const DATA: PortfolioRangeData = {
  range: "24h",
  sourcePeriod: "day",
  accountValueHistory: [
    [1_700_000_000_000, "100"],
    [1_700_003_600_000, "105"],
    [1_700_007_200_000, "102"],
  ],
  pnlHistory: [],
  accountValueSummary: {
    sparkline: "▁█▄",
    start: "100",
    end: "102",
    high: "105",
    low: "100",
    absoluteChange: "2",
    percentChange: "2",
    gapCount: 0,
    accessibilityLabel:
      "24 hour account performance. Start 100. End 102. High 105. Low 100. No source gaps detected.",
  },
  accountValue: "102",
  absolutePnl: "2",
  percentagePnl: "2",
  gapCount: 0,
};

afterEach(() => {
  jest.useRealTimers();
});

test("renders account performance in a tall, width-filling bar plot", () => {
  render(<PerformanceChart data={DATA} range="24h" />);

  expect(screen.getByTestId("account-performance-chart")).toHaveStyle({
    height: 128,
  });
  expect(screen.getByText("Latest")).toBeTruthy();
  expect(screen.getByTestId("performance-point-value")).toHaveTextContent(
    "102",
  );
  const latestTime = screen.getByTestId("performance-point-time").props
    .children;
  expect(screen.getAllByRole("button")).toHaveLength(3);

  jest.useFakeTimers();
  fireEvent.press(screen.getByRole("button", { name: /Account value 100/ }));

  expect(screen.queryByText("Selected")).toBeNull();
  expect(screen.getByTestId("performance-point-value")).toHaveTextContent(
    "100",
  );
  expect(screen.getByTestId("performance-point-time").props.children).not.toBe(
    latestTime,
  );
  expect(
    screen.getByRole("button", { name: /Account value 100/ }).props
      .accessibilityState,
  ).toEqual({ selected: true });

  act(() => jest.advanceTimersByTime(6_000));
  fireEvent.press(screen.getByRole("button", { name: /Account value 105/ }));
  act(() => jest.advanceTimersByTime(9_999));
  expect(screen.getByTestId("performance-point-value")).toHaveTextContent(
    "105",
  );

  act(() => jest.advanceTimersByTime(1));
  expect(screen.getByText("Latest")).toBeTruthy();
  expect(screen.getByTestId("performance-point-value")).toHaveTextContent(
    "102",
  );
  expect(screen.queryByText("▁█▄")).toBeNull();
});
