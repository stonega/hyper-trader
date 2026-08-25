import { expect, jest, test } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react-native";

import { SetupResumeCard } from "../components/setup-resume-card";
import { SETUP_ROUTE } from "../navigation/routes";

const mockPush = jest.fn();

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock("../components/use-reduced-motion", () => ({
  useReducedMotion: () => true,
}));

test("uses the selected network in setup copy and navigation", () => {
  const { rerender } = render(<SetupResumeCard network="mainnet" />);

  expect(
    screen.getByText(
      "Add a Mainnet API wallet when you’re ready to place orders.",
    ),
  ).toBeTruthy();
  const mainnetAction = screen.getByRole("button", {
    name: "Set up trading",
  });
  expect(mainnetAction.props.accessibilityHint).toBe(
    "Opens Mainnet account setup.",
  );
  fireEvent.press(mainnetAction);
  expect(mockPush).toHaveBeenCalledWith(SETUP_ROUTE);

  rerender(<SetupResumeCard network="testnet" />);
  expect(
    screen.getByText(
      "Add a Testnet API wallet when you’re ready to place orders.",
    ),
  ).toBeTruthy();
});
