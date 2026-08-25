import { expect, jest, test } from "@jest/globals";
import {
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react-native";
import { KeyboardAvoidingView, Modal, Platform } from "react-native";
import {
  HIP3_DUPLICATE,
  NATIVE_DUPLICATE,
  OUTCOME_MARKET,
  SPOT_DUPLICATE,
} from "../features/markets/fixture";
import { MarketSwitcher } from "../features/markets/market-switcher";

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

test("renders compact, left-aligned market rows without repeated trading copy", () => {
  const onClose = jest.fn();
  const onSelect = jest.fn();
  render(
    <MarketSwitcher
      markets={[
        NATIVE_DUPLICATE,
        HIP3_DUPLICATE,
        SPOT_DUPLICATE,
        OUTCOME_MARKET,
      ]}
      onClose={onClose}
      onSelect={onSelect}
      selectedCanonicalId={NATIVE_DUPLICATE.canonicalId}
      visible
    />,
  );

  expect(screen.queryByText("Search markets")).toBeNull();
  expect(screen.getByPlaceholderText("Search markets")).toBeTruthy();
  expect(
    screen.getByTestId("market-switcher-surface").props.className,
  ).toContain("bg-background");
  expect(screen.UNSAFE_getByType(Modal).props.backdropColor).toBeTruthy();
  expect(screen.UNSAFE_getByType(KeyboardAvoidingView).props.behavior).toBe(
    Platform.OS === "ios" ? "padding" : "height",
  );
  expect(
    screen.getByRole("button", { name: "Close market selector" }),
  ).toBeTruthy();
  expect(screen.queryByTestId("market-catalog-mode-toggle")).toBeNull();
  const selected = screen.getByRole("button", {
    name: "Selected, DUP-USDC, 20x max leverage, Trading",
  });
  expect(within(selected).getByText("DUP-USDC")).toBeTruthy();
  expect(within(selected).getByText("20x")).toBeTruthy();
  expect(screen.queryByText("Trading")).toBeNull();
  expect(screen.queryByText("Native")).toBeNull();
  const hip3 = screen.getByRole("button", {
    name: "DUP-USDC, 20x max leverage, omega provider, Trading",
  });
  expect(within(hip3).getByText("omega")).toBeTruthy();
  const spot = screen.getByRole("button", {
    name: "DUP/USDC, Trading",
  });
  expect(within(spot).getByText("DUP/USDC")).toBeTruthy();
  expect(screen.getByText("View only")).toBeTruthy();
  expect(
    screen.getAllByTestId("market-icon-image", {
      includeHiddenElements: true,
    }),
  ).toHaveLength(3);

  fireEvent.press(selected);
  expect(onSelect).toHaveBeenCalledWith(NATIVE_DUPLICATE.canonicalId);
  expect(onClose).toHaveBeenCalledTimes(1);
});
