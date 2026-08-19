import { expect, jest, test } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";

import {
  ApiWalletAvatar,
  shortenWalletAddress,
  walletGradientForAddress,
} from "../features/accounts/api-wallet-avatar";

jest.mock("expo-linear-gradient", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const { View } =
    jest.requireActual<typeof import("react-native")>("react-native");
  return {
    LinearGradient: (props: Record<string, unknown>) =>
      React.createElement(View, props),
  };
});

const ADDRESS = `0x12${"a".repeat(34)}1212`;

test("shortens a wallet address with a readable prefix and ellipsis", () => {
  expect(shortenWalletAddress(ADDRESS)).toBe("0x12aa…1212");
});

test("derives a stable gradient from the API wallet address", () => {
  expect(walletGradientForAddress(ADDRESS)).toEqual(
    walletGradientForAddress(ADDRESS.toUpperCase()),
  );
  expect(walletGradientForAddress(ADDRESS)).not.toEqual(
    walletGradientForAddress(`0x34${"b".repeat(34)}3434`),
  );
});

test("renders only the address-derived avatar", () => {
  const { rerender } = render(<ApiWalletAvatar address={ADDRESS} />);

  expect(
    screen.getByTestId("api-wallet-avatar", { includeHiddenElements: true }),
  ).toBeTruthy();
  expect(
    screen.getByTestId("api-wallet-avatar-gradient", {
      includeHiddenElements: true,
    }),
  ).toBeTruthy();
  expect(screen.queryByText(/0x12|testnet|hyper trader/i)).toBeNull();

  rerender(<ApiWalletAvatar address={null} />);

  expect(
    screen.getByTestId("api-wallet-avatar-placeholder", {
      includeHiddenElements: true,
    }),
  ).toBeTruthy();
  expect(
    screen.queryByTestId("api-wallet-avatar-gradient", {
      includeHiddenElements: true,
    }),
  ).toBeNull();
});
