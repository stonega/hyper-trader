import { expect, jest, test } from "@jest/globals";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import type { ReactTestInstance } from "react-test-renderer";
import type { SavedAccount } from "../features/accounts/account-scope";
import { GlobalAccountSwitcher } from "../features/accounts/global-account-switcher";

const MASTER = "0x1111111111111111111111111111111111111111";
const TARGET = "0x2222222222222222222222222222222222222222";
const AGENT = "0x3333333333333333333333333333333333333333";
const mockAccount: SavedAccount = {
  id: "test-account",
  label: "Test account",
  network: "testnet",
  masterAccount: MASTER,
  target: { kind: "subaccount", address: TARGET, masterAddress: MASTER },
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

const mockNavigate = jest.fn();
const mockSelect = jest.fn<() => Promise<boolean>>();
const mockSwitchContext = jest.fn<() => Promise<boolean>>();
const restoredContext = {
  network: "testnet" as const,
  masterAccount: MASTER,
  targetAccount: TARGET,
  signer: { agentAddress: AGENT, generation: 1 },
};
const mockRestoreTradingContext = jest.fn(async () => restoredContext);

jest.mock("expo-router", () => ({
  useRouter: () => ({ navigate: mockNavigate }),
}));

jest.mock("../components/use-reduced-motion", () => ({
  useReducedMotion: () => true,
}));

jest.mock("../features/accounts/account-directory-provider", () => ({
  useAccountDirectory: () => ({
    status: "ready",
    accounts: [mockAccount],
    activeAccountId: null,
    message: null,
    reload: async () => true,
    save: async () => true,
    select: mockSelect,
    remove: async () => true,
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
    switchContext: mockSwitchContext,
    capture: () => ({ epoch: 0, identityKey: "", signerScopeKey: null }),
    canCommit: () => true,
  }),
}));

jest.mock("../features/actions/runtime-provider", () => ({
  useActionRuntime: () => ({
    flow: { phase: "review" },
    available: false,
  }),
}));

jest.mock("../features/accounts/manual-setup-runtime", () => ({
  getManualSetupRuntime: async () => ({
    restoreTradingContext: mockRestoreTradingContext,
  }),
}));

function isDescendantOf(
  candidate: ReactTestInstance,
  ancestor: ReactTestInstance,
): boolean {
  let current = candidate.parent;
  while (current) {
    if (current === ancestor) return true;
    current = current.parent;
  }
  return false;
}

test("keeps the close action pinned outside the scrolling account body", () => {
  render(<GlobalAccountSwitcher />);
  fireEvent.press(
    screen.getByRole("button", {
      name: "Switch account. Choose an account. Read only",
    }),
  );

  expect(
    isDescendantOf(
      screen.getByTestId("account-switcher-close"),
      screen.getByTestId("account-switcher-scroll"),
    ),
  ).toBe(false);
});

test("renders a concise account row with an avatar and readable address", () => {
  render(<GlobalAccountSwitcher avatarOnly />);

  const trigger = screen.getByRole("button", {
    name: "Switch account. Choose an account. Read only",
  });
  expect(trigger.props.className).toContain("rounded-2xl");
  const triggerGradient = screen.getByTestId("api-wallet-avatar-gradient", {
    includeHiddenElements: true,
  });
  expect(
    screen.queryByTestId("api-wallet-avatar-placeholder", {
      includeHiddenElements: true,
    }),
  ).toBeNull();
  expect(screen.queryByText("Accounts")).toBeNull();
  fireEvent.press(trigger);
  expect(screen.getByText("Accounts")).toBeTruthy();
  expect(
    screen.getByRole("button", {
      name: "Use Test account, 0x2222…2222, Testnet",
    }),
  ).toBeTruthy();
  expect(screen.getByText("Test account\n0x2222…2222 · Testnet")).toBeTruthy();
  const gradients = screen.getAllByTestId("api-wallet-avatar-gradient", {
    includeHiddenElements: true,
  });
  expect(gradients).toHaveLength(2);
  expect(gradients[0]?.props.colors).toEqual(triggerGradient.props.colors);
  expect(gradients[1]?.props.colors).toEqual(triggerGradient.props.colors);
  expect(screen.queryByText(/subaccount|api wallet active/i)).toBeNull();
});

test("recovers interactive dialog controls when an account switch throws", async () => {
  mockSwitchContext.mockRejectedValueOnce(new Error("switch failed"));
  render(<GlobalAccountSwitcher />);
  fireEvent.press(
    screen.getByRole("button", {
      name: "Switch account. Choose an account. Read only",
    }),
  );

  fireEvent.press(
    screen.getByRole("button", {
      name: "Use Test account, 0x2222…2222, Testnet",
    }),
  );

  expect(await screen.findByText(/could not be completed safely/)).toBeTruthy();
  await waitFor(() =>
    expect(screen.getByTestId("account-switcher-close")).not.toBeDisabled(),
  );
  expect(mockSelect).not.toHaveBeenCalled();
});

test("restores the verified API-wallet binding when selecting an account", async () => {
  mockSelect.mockResolvedValueOnce(true);
  mockSwitchContext.mockResolvedValueOnce(true);
  render(<GlobalAccountSwitcher />);
  fireEvent.press(
    screen.getByRole("button", {
      name: "Switch account. Choose an account. Read only",
    }),
  );

  fireEvent.press(
    screen.getByRole("button", {
      name: "Use Test account, 0x2222…2222, Testnet",
    }),
  );

  await waitFor(() =>
    expect(mockSwitchContext).toHaveBeenCalledWith(restoredContext),
  );
  expect(mockRestoreTradingContext).toHaveBeenCalledWith(mockAccount);
  expect(mockSelect).toHaveBeenCalledWith(mockAccount.id);
});
