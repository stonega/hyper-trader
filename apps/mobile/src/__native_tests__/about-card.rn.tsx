import { expect, jest, test } from "@jest/globals";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react-native";
import { Linking } from "react-native";

import { AboutCard } from "../features/settings/about-card";

const mockSetStringAsync = jest.fn<(value: string) => Promise<void>>();

jest.mock("@expo/vector-icons/FontAwesome6", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const { Text } =
    jest.requireActual<typeof import("react-native")>("react-native");
  return {
    __esModule: true,
    default: ({ name }: { readonly name: string }) =>
      React.createElement(Text, null, name),
  };
});

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

test("declares the project independent from Hyperliquid", () => {
  render(<AboutCard />);

  expect(
    screen.getByText(
      "Hyper Trader is an unofficial, independent community project. It is not affiliated with or endorsed by Hyperliquid.",
    ),
  ).toBeTruthy();
});

test("presents the heading action and address as separate copy buttons", () => {
  render(<AboutCard />);

  const address = screen.getByText(
    "0x065699fda5db01cdbffd1625aeed8e6f5ba7efdf",
  );
  const supportWorkRow = screen.getByTestId("support-work-row");
  const addressButton = screen.getByRole("button", {
    name: "Copy donation wallet address 0x065699fda5db01cdbffd1625aeed8e6f5ba7efdf",
  });

  expect(address.props.className).toContain("font-mono");
  expect(supportWorkRow.props.className).toContain("flex-row");
  expect(within(supportWorkRow).getByText("Support our work")).toBeTruthy();
  expect(
    within(supportWorkRow).getByRole("button", { name: "Copy" }),
  ).toBeTruthy();
  expect(addressButton.props.variant).toBe("outline");
});

test("opens the community and repository links", async () => {
  const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
  render(<AboutCard />);

  expect(screen.getByRole("button", { name: "Telegram" }).props.variant).toBe(
    "outline",
  );
  expect(screen.getByRole("button", { name: "GitHub" }).props.variant).toBe(
    "outline",
  );
  expect(
    screen.getByText("telegram", { includeHiddenElements: true }),
  ).toBeTruthy();
  expect(
    screen.getByText("github", { includeHiddenElements: true }),
  ).toBeTruthy();
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

test("confirms a copied donation address in the button for two seconds", async () => {
  jest.useFakeTimers();
  try {
    mockSetStringAsync.mockResolvedValue();
    render(<AboutCard />);

    expect(
      screen.getByText("0x065699fda5db01cdbffd1625aeed8e6f5ba7efdf"),
    ).toBeTruthy();
    expect(screen.getByText("Support our work")).toBeTruthy();
    expect(
      screen.getByText("heart-fill", { includeHiddenElements: true }),
    ).toBeTruthy();
    fireEvent.press(
      screen.getByRole("button", {
        name: "Copy donation wallet address 0x065699fda5db01cdbffd1625aeed8e6f5ba7efdf",
      }),
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Thank you!" })).toBeTruthy();
    });
    expect(mockSetStringAsync).toHaveBeenCalledWith(
      "0x065699fda5db01cdbffd1625aeed8e6f5ba7efdf",
    );
    expect(screen.queryByRole("alert")).toBeNull();

    act(() => jest.advanceTimersByTime(1_999));
    expect(screen.getByRole("button", { name: "Thank you!" })).toBeTruthy();

    act(() => jest.advanceTimersByTime(1));
    expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
  } finally {
    jest.useRealTimers();
  }
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
