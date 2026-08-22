import { expect, jest, test } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react-native";

import { MarketCatalogModeToggle } from "../features/markets/catalog-mode-toggle";

jest.mock("@expo/vector-icons/Ionicons", () => () => null);
jest.mock("../components/use-reduced-motion", () => ({
  useReducedMotion: () => true,
}));

test("switches between Strict and All market modes", () => {
  const onChange = jest.fn();
  const { rerender } = render(
    <MarketCatalogModeToggle mode="strict" onChange={onChange} />,
  );

  fireEvent.press(screen.getByRole("button", { name: "Strict market mode" }));
  expect(onChange).toHaveBeenCalledWith("all");

  rerender(<MarketCatalogModeToggle mode="all" onChange={onChange} />);
  fireEvent.press(screen.getByRole("button", { name: "All market mode" }));
  expect(onChange).toHaveBeenLastCalledWith("strict");
});
