import { expect, jest, test } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";

import { AccountDirectoryList } from "../features/accounts/account-directory-list";
import type { SavedAccount } from "../features/accounts/account-scope";

jest.mock("expo-linear-gradient", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const { View } =
    jest.requireActual<typeof import("react-native")>("react-native");
  return {
    LinearGradient: (props: Record<string, unknown>) =>
      React.createElement(View, props),
  };
});

function account(input: {
  readonly id: string;
  readonly label: string;
  readonly network: SavedAccount["network"];
  readonly addressDigit: string;
}): SavedAccount {
  const masterAccount = `0x${input.addressDigit.repeat(40)}`;
  return {
    id: input.id,
    label: input.label,
    network: input.network,
    masterAccount,
    target: { kind: "master", address: masterAccount },
    authorization: {
      agentAddress: `0x${input.addressDigit.repeat(39)}a`,
      generation: 1,
      registrationName: "Hyper Trader",
      registrationState: "active",
      requestedExpiryMs: 1_800_000_000_000,
      effectiveExpiryMs: 1_800_000_000_000,
      lastVerifiedAtMs: 1_700_000_000_000,
      credentialState: "protected",
    },
    reconciliation: { pendingCount: 0, allDurable: true },
  };
}

test("shows every saved account with the selector avatar style", () => {
  const primary = account({
    id: "primary",
    label: "Primary",
    network: "testnet",
    addressDigit: "1",
  });
  const reserve = account({
    id: "reserve",
    label: "Reserve",
    network: "mainnet",
    addressDigit: "2",
  });

  render(
    <AccountDirectoryList
      accounts={[primary, reserve]}
      activeAccountId={primary.id}
    />,
  );

  expect(
    screen.getByLabelText(
      "Primary, 0x1111…1111, Testnet, API wallet active, active account",
    ),
  ).toBeTruthy();
  expect(
    screen.getByLabelText("Reserve, 0x2222…2222, Mainnet, Read only"),
  ).toBeTruthy();
  expect(
    screen.getAllByTestId("api-wallet-avatar", {
      includeHiddenElements: true,
    }),
  ).toHaveLength(2);
  expect(screen.getByText("Active")).toBeTruthy();
});
