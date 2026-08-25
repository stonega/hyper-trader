import { expect, jest, test } from "@jest/globals";
import {
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react-native";

import {
  HIP3_DUPLICATE,
  NATIVE_DUPLICATE,
  SPOT_DUPLICATE,
} from "../features/markets/fixture";
import { MarketCard } from "../features/markets/market-card";
import { MarketRow } from "../features/markets/market-row";

jest.mock("@expo/vector-icons/Ionicons", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const { Text } =
    jest.requireActual<typeof import("react-native")>("react-native");
  return {
    __esModule: true,
    default: ({ name }: { readonly name: string }) =>
      React.createElement(Text, null, name),
  };
});

jest.mock("../components/use-reduced-motion", () => ({
  useReducedMotion: () => true,
}));

test("uses the market selector icon and pair-name treatment", () => {
  const onOpen = jest.fn();
  const onToggleFavorite = jest.fn();
  render(
    <MarketRow
      isFavorite={false}
      market={NATIVE_DUPLICATE}
      onOpen={onOpen}
      onToggleFavorite={onToggleFavorite}
      preferencesReady
    />,
  );

  expect(screen.getByText("DUP-USDC")).toBeTruthy();
  expect(screen.getByText("x20")).toBeTruthy();
  expect(screen.queryByText("Perpetual")).toBeNull();
  expect(screen.queryByText("DUP")).toBeNull();
  expect(screen.queryByText("Native")).toBeNull();
  expect(screen.queryByLabelText(/HIP-3 venue/)).toBeNull();
  const priceSummary = within(screen.getByTestId("market-price-summary"));
  expect(priceSummary.getByText("$10")).toBeTruthy();
  expect(priceSummary.getByText("24h +25.00%")).toBeTruthy();
  expect(
    screen.getByText("star-outline", { includeHiddenElements: true }),
  ).toBeTruthy();
  expect(
    screen.getByTestId("market-icon-image", { includeHiddenElements: true }),
  ).toBeTruthy();

  fireEvent.press(
    screen.getByRole("button", { name: "Add DUP-USDC to favorites" }),
  );
  fireEvent.press(screen.getByRole("button", { name: "Open in Trade" }));

  expect(onToggleFavorite).toHaveBeenCalledTimes(1);
  expect(onOpen).toHaveBeenCalledTimes(1);
});

test("keeps the provider visible for non-native perpetual markets", () => {
  render(
    <MarketRow
      isFavorite
      market={HIP3_DUPLICATE}
      onOpen={jest.fn()}
      onToggleFavorite={jest.fn()}
      preferencesReady
    />,
  );

  expect(screen.getByText("Omega Markets")).toBeTruthy();
  expect(screen.getByText("x20")).toBeTruthy();
  expect(screen.getByText("omega")).toBeTruthy();
  expect(screen.getByLabelText("HIP-3 venue Omega Markets")).toBeTruthy();
  expect(screen.queryByText("HIP-3 perpetual")).toBeNull();
  expect(
    screen.getByText("star", { includeHiddenElements: true }),
  ).toBeTruthy();
  expect(screen.getByText("Favorited")).toBeTruthy();
});

test("uses slash notation for spot pairs", () => {
  render(
    <MarketRow
      isFavorite={false}
      market={SPOT_DUPLICATE}
      onOpen={jest.fn()}
      onToggleFavorite={jest.fn()}
      preferencesReady
    />,
  );

  expect(screen.getByText("DUP/USDC")).toBeTruthy();
  expect(screen.queryByText("DUP-USDC")).toBeNull();
  expect(
    screen.getByRole("button", { name: "Add DUP/USDC to favorites" }),
  ).toBeTruthy();
});

test("supports the Trade summary layout without an action footer", () => {
  render(<MarketCard market={NATIVE_DUPLICATE} showOrderAvailability />);

  expect(screen.getByText("DUP-USDC")).toBeTruthy();
  expect(screen.getByText("x20")).toBeTruthy();
  expect(screen.getByText("$10")).toBeTruthy();
  expect(screen.getByText("24h +25.00%")).toBeTruthy();
  expect(screen.getByText("Volume 100")).toBeTruthy();
  expect(screen.getByText("Funding 0.0100%")).toBeTruthy();
  expect(screen.getByText("Open interest 40")).toBeTruthy();
  expect(screen.queryAllByRole("button")).toHaveLength(0);
});
