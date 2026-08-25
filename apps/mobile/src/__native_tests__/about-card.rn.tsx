import { expect, jest, test } from "@jest/globals";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { Linking } from "react-native";

import { AboutCard } from "../features/settings/about-card";

const mockSetStringAsync = jest.fn<(value: string) => Promise<void>>();

jest.mock("@expo/vector-icons/Octicons", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const { Text } =
    jest.requireActual<typeof import("react-native")>("react-native");
  return {
    __esModule: true,
    default: ({ name }: { readonly name: string }) =>
      React.createElement(Text, null, name),
  };
});

jest.mock("expo-clipboard", () => ({
  setStringAsync: (value: string) => mockSetStringAsync(value),
}));

jest.mock("../components/use-reduced-motion", () => ({
  useReducedMotion: () => true,
}));

test("opens the community and repository links", async () => {
  const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
  render(<AboutCard />);

  fireEvent.press(screen.getByRole("button", { name: "Telegram" }));
  fireEvent.press(screen.getByRole("button", { name: "GitHub" }));

  await waitFor(() => {
    expect(openURL).toHaveBeenNthCalledWith(
      1,
      "https://t.me/+3okq17iiGak4NWFl",
    );
    expect(openURL).toHaveBeenNthCalledWith(
      2,
      "https://github.com/stonega/hyper-trader",
    );
  });
});

test("copies the complete donation wallet address", async () => {
  mockSetStringAsync.mockResolvedValue();
  render(<AboutCard />);

  expect(
    screen.getByText("0x065699fda5db01cdbffd1625aeed8e6f5ba7efdf"),
  ).toBeTruthy();
  expect(
    screen.getByText("star", { includeHiddenElements: true }),
  ).toBeTruthy();
  fireEvent.press(screen.getByRole("button", { name: "Copy address" }));

  await waitFor(() => {
    expect(mockSetStringAsync).toHaveBeenCalledWith(
      "0x065699fda5db01cdbffd1625aeed8e6f5ba7efdf",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Donation address copied.",
    );
  });
});

test("reports a failed external handoff inside the card", async () => {
  jest.spyOn(Linking, "openURL").mockRejectedValue(new Error("unavailable"));
  render(<AboutCard />);

  fireEvent.press(screen.getByRole("button", { name: "Telegram" }));

  expect(
    await screen.findByText(
      "Telegram could not be opened. Check your connection and try again.",
    ),
  ).toBeTruthy();
});
