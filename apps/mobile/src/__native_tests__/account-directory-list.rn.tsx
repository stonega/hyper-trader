import { expect, jest, test } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";

import { AccountDirectoryList } from "../features/accounts/account-directory-list";
import type { SavedAccount } from "../features/accounts/account-scope";
import { walletGradientForSeed } from "../features/accounts/api-wallet-avatar";

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
  const reserveFixture = account({
    id: "reserve",
    label: "Reserve",
    network: "mainnet",
    addressDigit: "2",
  });
  const reserve: SavedAccount = {
    ...reserveFixture,
    authorization: {
      agentAddress: null,
      generation: null,
      registrationName: null,
      registrationState: "inactive",
      requestedExpiryMs: null,
      effectiveExpiryMs: null,
      lastVerifiedAtMs: null,
      credentialState: "absent",
    },
  };

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
    screen.getByLabelText("Reserve, 0x2222…2222, Mainnet, Setup required"),
  ).toBeTruthy();
  expect(
    screen.getAllByTestId("api-wallet-avatar", {
      includeHiddenElements: true,
    }),
  ).toHaveLength(2);
  const gradients = screen.getAllByTestId("api-wallet-avatar-gradient", {
    includeHiddenElements: true,
  });
  expect(gradients).toHaveLength(2);
  expect(gradients[0]?.props.colors).toEqual(
    walletGradientForSeed(primary.id).colors,
  );
  expect(gradients[1]?.props.colors).toEqual(
    walletGradientForSeed(reserve.id).colors,
  );
  expect(gradients[0]?.props.colors).not.toEqual(gradients[1]?.props.colors);
  expect(
    screen.queryByTestId("api-wallet-avatar-placeholder", {
      includeHiddenElements: true,
    }),
  ).toBeNull();
  expect(screen.getByText("Active")).toBeTruthy();
});
