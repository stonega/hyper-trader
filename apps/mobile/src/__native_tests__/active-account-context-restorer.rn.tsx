import { expect, jest, test } from "@jest/globals";
import { render, waitFor } from "@testing-library/react-native";
import { View } from "react-native";
import type { SavedAccount } from "../features/accounts/account-scope";
import { ActiveAccountContextRestorer } from "../features/accounts/active-account-context-restorer";

const MASTER = "0x1111111111111111111111111111111111111111";
const AGENT = "0x2222222222222222222222222222222222222222";
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
const restoredContext = {
  network: "testnet" as const,
  masterAccount: MASTER,
  targetAccount: MASTER,
  signer: { agentAddress: AGENT, generation: 1 },
};
const mockRestoreTradingContext = jest.fn(async () => restoredContext);
const mockSwitchContext = jest.fn(async () => true);
const mockCapture = { epoch: 0, identityKey: "testnet", signerScopeKey: null };

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
      network: "testnet",
      masterAccount: null,
      targetAccount: null,
      signer: null,
    },
    capture: () => mockCapture,
    canCommit: () => true,
    switchContext: mockSwitchContext,
  }),
}));

jest.mock("../features/accounts/manual-setup-runtime", () => ({
  getManualSetupRuntime: async () => ({
    restoreTradingContext: mockRestoreTradingContext,
  }),
}));

test("restores the persisted active account from independent authority on launch", async () => {
  render(
    <View>
      <ActiveAccountContextRestorer />
    </View>,
  );

  await waitFor(() =>
    expect(mockSwitchContext).toHaveBeenCalledWith(restoredContext),
  );
  expect(mockRestoreTradingContext).toHaveBeenCalledWith(mockAccount);
});
