import { expect, jest, test } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react-native";

import { HIP3_DUPLICATE, NATIVE_DUPLICATE } from "../features/markets/fixture";
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
  expect(screen.queryByText("HIP-3 perpetual")).toBeNull();
  expect(
    screen.getByText("star", { includeHiddenElements: true }),
  ).toBeTruthy();
  expect(screen.getByText("Favorited")).toBeTruthy();
});
