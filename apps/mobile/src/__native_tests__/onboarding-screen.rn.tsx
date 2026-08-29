import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";

import LaunchScreen from "../app";
import OnboardingScreen from "../app/onboarding";
import { FIRST_USE_ONBOARDING_KEY } from "../features/onboarding/first-use";
import {
  ONBOARDING_ROUTE,
  SETUP_ROUTE,
  TRADE_ROUTE,
} from "../navigation/routes";

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    setItem: jest.fn(),
  },
}));

jest.mock("expo-router", () => {
  const React = require("react");
  const { Text } = require("react-native");
  const replace = jest.fn();
  return {
    Redirect: ({ href }: { readonly href: string }) =>
      React.createElement(Text, null, `Redirect ${href}`),
    useRouter: () => ({ replace }),
    mockReplace: replace,
  };
});

jest.mock("../components/use-reduced-motion", () => ({
  useReducedMotion: () => true,
}));

const getItem = AsyncStorage.getItem as jest.MockedFunction<
  typeof AsyncStorage.getItem
>;
const setItem = AsyncStorage.setItem as jest.MockedFunction<
  typeof AsyncStorage.setItem
>;
const { mockReplace } = jest.requireMock("expo-router") as {
  readonly mockReplace: jest.Mock;
};

describe("first-use launch routing", () => {
  beforeEach(() => {
    getItem.mockReset();
    setItem.mockReset();
    mockReplace.mockReset();
  });

  test("opens onboarding when the first-use marker is absent", async () => {
    getItem.mockResolvedValue(null);

    render(<LaunchScreen />);

    expect(
      await screen.findByText(`Redirect ${ONBOARDING_ROUTE}`),
    ).toBeTruthy();
  });

  test("opens Trade after onboarding has been completed", async () => {
    getItem.mockResolvedValue("complete");

    render(<LaunchScreen />);

    expect(await screen.findByText(`Redirect ${TRADE_ROUTE}`)).toBeTruthy();
  });

  test("falls back to onboarding when presentation storage cannot be read", async () => {
    getItem.mockRejectedValue(new Error("storage unavailable"));

    render(<LaunchScreen />);

    expect(
      await screen.findByText(`Redirect ${ONBOARDING_ROUTE}`),
    ).toBeTruthy();
  });
});

describe("onboarding choices", () => {
  beforeEach(() => {
    getItem.mockReset();
    setItem.mockReset();
    setItem.mockResolvedValue(undefined);
    mockReplace.mockReset();
  });

  test("introduces the API-wallet boundary and starts setup", async () => {
    render(<OnboardingScreen />);

    expect(
      screen.getByRole("header", { name: "Give every trade its own key." }),
    ).toBeTruthy();
    expect(
      screen.getByLabelText(
        "Your master wallet stays with you. A dedicated API wallet is protected on this device.",
      ),
    ).toBeTruthy();

    fireEvent.press(screen.getByRole("button", { name: "Set up API wallet" }));

    await waitFor(() => {
      expect(setItem).toHaveBeenCalledWith(
        FIRST_USE_ONBOARDING_KEY,
        "complete",
      );
      expect(mockReplace).toHaveBeenCalledWith(SETUP_ROUTE);
    });
  });

  test("allows read-only use and does not replay onboarding", async () => {
    render(<OnboardingScreen />);

    fireEvent.press(screen.getByRole("button", { name: "Skip for now" }));

    await waitFor(() => {
      expect(setItem).toHaveBeenCalledWith(
        FIRST_USE_ONBOARDING_KEY,
        "complete",
      );
      expect(mockReplace).toHaveBeenCalledWith(TRADE_ROUTE);
    });
  });

  test("never blocks either destination when the marker cannot be written", async () => {
    setItem.mockRejectedValue(new Error("storage unavailable"));
    render(<OnboardingScreen />);

    fireEvent.press(screen.getByRole("button", { name: "Skip for now" }));

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(TRADE_ROUTE);
    });
  });
});
