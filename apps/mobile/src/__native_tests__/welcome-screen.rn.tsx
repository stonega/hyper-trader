import { describe, expect, jest, test } from "@jest/globals";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";

import WelcomeScreen from "../app/welcome";

const mockReplace = jest.fn();
const mockCompleteOnboarding = jest.fn<(choice: string) => Promise<void>>();

jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

jest.mock("../components/use-reduced-motion", () => ({
  useReducedMotion: () => true,
}));

jest.mock("../features/onboarding/storage", () => ({
  completeOnboarding: (choice: string) => mockCompleteOnboarding(choice),
}));

describe("native read-only onboarding", () => {
  test("keeps setup primary and persists read-only choice before navigation", async () => {
    mockCompleteOnboarding.mockResolvedValue(undefined);
    render(<WelcomeScreen />);

    expect(screen.getByRole("header", { name: "Hyper Trader" })).toBeTruthy();
    expect(
      screen.getByText(
        "Explore every Hyperliquid market now, then set up secure testnet trading when you’re ready.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("Choose how to begin")).toBeNull();
    expect(screen.queryByText(/master seed/)).toBeNull();
    const ribbonBackground = screen.getByTestId("welcome-ribbon-background", {
      includeHiddenElements: true,
    });
    expect(ribbonBackground).toHaveProp(
      "importantForAccessibility",
      "no-hide-descendants",
    );
    expect(ribbonBackground).toHaveStyle({ backgroundColor: "#153026" });
    expect(screen.getByRole("button", { name: "Set up trading" })).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: "Explore read-only" }));

    await waitFor(() =>
      expect(mockCompleteOnboarding).toHaveBeenCalledTimes(1),
    );
    expect(mockCompleteOnboarding).toHaveBeenCalledWith("read_only");
    expect(mockReplace).toHaveBeenCalledWith("/(tabs)/trade");
  });

  test("announces storage failure and does not navigate", async () => {
    mockCompleteOnboarding.mockRejectedValue(new Error("fixture failure"));
    render(<WelcomeScreen />);
    fireEvent.press(screen.getByRole("button", { name: "Explore read-only" }));

    expect(
      await screen.findByRole("alert", {
        name: "Your choice could not be saved. Nothing changed. Try again.",
      }),
    ).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
