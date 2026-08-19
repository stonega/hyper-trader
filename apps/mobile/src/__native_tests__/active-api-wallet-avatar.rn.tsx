import { expect, jest, test } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";
import type { SavedAccount } from "../features/accounts/account-scope";
import { ActiveApiWalletAvatar } from "../features/accounts/active-api-wallet-avatar";

const MASTER = "0x1111111111111111111111111111111111111111";
const AGENT = "0x3333333333333333333333333333333333333333";
const mockAccount: SavedAccount = {
  id: "test-account",
  label: "Test account",
  network: "testnet",
  masterAccount: MASTER,
  target: { kind: "master", address: MASTER },
  authorization: {
    agentAddress: AGENT,
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

jest.mock("expo-linear-gradient", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const { View } =
    jest.requireActual<typeof import("react-native")>("react-native");
  return {
    LinearGradient: (props: Record<string, unknown>) =>
      React.createElement(View, props),
  };
});

jest.mock("../features/accounts/account-directory-provider", () => ({
  useAccountDirectory: () => ({
    status: "ready",
    accounts: [mockAccount],
    activeAccountId: mockAccount.id,
    message: null,
  }),
}));

jest.mock("../core/context/provider", () => ({
  useTradingContext: () => ({
    current: {
      network: mockAccount.network,
      masterAccount: mockAccount.masterAccount,
      targetAccount: mockAccount.target.address,
      signer: null,
    },
  }),
}));

test("automatically shows the API wallet bound to the active account", () => {
  render(<ActiveApiWalletAvatar />);

  expect(
    screen.getByRole("image", {
      name: "Active API wallet, Hyper Trader, 0x3333…3333, Testnet",
    }),
  ).toBeTruthy();
  expect(
    screen.getByTestId("api-wallet-avatar-gradient", {
      includeHiddenElements: true,
    }),
  ).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
});
