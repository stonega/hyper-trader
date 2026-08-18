import { describe, expect, jest, test } from "@jest/globals";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";

import SetupScreen from "../app/setup";
import type { SetupAttempt } from "../features/accounts/setup-coordinator";
import type { ActivatedSetupRecord } from "../features/accounts/setup-repository";

const MASTER = "0x1111111111111111111111111111111111111111";
const AGENT = "0x2222222222222222222222222222222222222222";
const REGISTRATION_NAME = "Stone API";
const ATTEMPT: SetupAttempt = {
  id: `0x${"a".repeat(64)}`,
  network: "testnet",
  connectorSessionId: "manual-session-1",
  masterAccount: MASTER,
  targetAccount: MASTER,
  agentAddress: AGENT,
  registrationName: REGISTRATION_NAME,
  registrationGeneration: 1,
  approvalNonce: 1_800_000_000_000,
  requestedExpiry: 1_802_592_000_000,
  createdAt: 1_800_000_000_000,
  expiresAt: 1_800_086_400_000,
};
const ACTIVATION: ActivatedSetupRecord = {
  attemptId: ATTEMPT.id,
  binding: {
    network: "testnet",
    masterAccount: MASTER,
    targetAccount: MASTER,
    agentAddress: AGENT,
    generation: 1,
  },
  registrationName: ATTEMPT.registrationName,
  requestedExpiry: ATTEMPT.requestedExpiry,
  effectiveExpiry: ATTEMPT.requestedExpiry,
  activatedAt: ATTEMPT.createdAt + 5_000,
};

const mockReplace = jest.fn();
const mockLoad = jest.fn<() => Promise<unknown>>();
const mockPrepare =
  jest.fn<
    (master: string, registrationName: string) => Promise<SetupAttempt>
  >();
const mockVerify = jest.fn<() => Promise<unknown>>();
const mockActivationFor = jest.fn<() => ActivatedSetupRecord | null>();
const mockFinish = jest.fn<() => Promise<void>>();
const mockSave = jest.fn<() => Promise<boolean>>();
const mockSelect = jest.fn<() => Promise<boolean>>();
const mockSwitchContext = jest.fn<() => Promise<boolean>>();
const saveAccount = () => mockSave();
const selectAccount = () => mockSelect();
const switchTradingContext = () => mockSwitchContext();

const mockRuntime = {
  load: () => mockLoad(),
  saveMasterAccount: async (master: string, registrationName: string) => ({
    masterAccount: master,
    registrationName,
  }),
  prepare: (master: string, registrationName: string) =>
    mockPrepare(master, registrationName),
  verify: () => mockVerify(),
  confirmShorterExpiry: () => mockVerify(),
  activationFor: () => mockActivationFor(),
  finish: () => mockFinish(),
  cancel: async () => undefined,
};

jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

jest.mock("../components/use-reduced-motion", () => ({
  useReducedMotion: () => true,
}));

jest.mock("../features/accounts/manual-setup-runtime", () => ({
  getManualSetupRuntime: async () => mockRuntime,
}));

jest.mock("../features/accounts/account-directory-provider", () => ({
  useAccountDirectory: () => ({
    status: "ready",
    accounts: [],
    activeAccountId: null,
    message: null,
    reload: async () => true,
    save: saveAccount,
    select: selectAccount,
    remove: async () => true,
  }),
}));

jest.mock("../core/context/provider", () => ({
  useTradingContext: () => ({
    current: {
      network: "mainnet",
      masterAccount: null,
      targetAccount: null,
      signer: null,
    },
    switchContext: switchTradingContext,
    capture: () => ({ epoch: 0, identityKey: "", signerScopeKey: null }),
    canCommit: () => true,
  }),
}));

describe("native resumable API-wallet setup", () => {
  test("saves the user's API-wallet name before key generation", async () => {
    mockLoad.mockResolvedValue({ status: "empty" });

    render(<SetupScreen />);

    expect(
      await screen.findByText("Enter your Hyperliquid wallet"),
    ).toBeTruthy();
    fireEvent.changeText(screen.getByPlaceholderText("0x…"), MASTER);
    fireEvent.changeText(
      screen.getByPlaceholderText("Trading wallet"),
      REGISTRATION_NAME,
    );
    fireEvent.press(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByText("Protect this device")).toBeTruthy();
    expect(
      screen.getByText(`It will use your label: ${REGISTRATION_NAME}`),
    ).toBeTruthy();
  });

  test("generates, verifies, saves, and enters Trade", async () => {
    mockLoad.mockResolvedValue({
      status: "protection",
      masterAccount: MASTER,
      registrationName: REGISTRATION_NAME,
    });
    mockPrepare.mockResolvedValue(ATTEMPT);
    mockVerify.mockResolvedValue({
      status: "activated",
      binding: ACTIVATION.binding,
      effectiveExpiry: ACTIVATION.effectiveExpiry,
    });
    mockActivationFor.mockReturnValue(ACTIVATION);
    mockFinish.mockResolvedValue(undefined);
    mockSave.mockResolvedValue(true);
    mockSelect.mockResolvedValue(true);
    mockSwitchContext.mockResolvedValue(true);

    render(<SetupScreen />);

    expect(await screen.findByText("Protect this device")).toBeTruthy();
    fireEvent.press(
      screen.getByRole("button", { name: "Protect & generate wallet" }),
    );

    expect(await screen.findByText(AGENT)).toBeTruthy();
    expect(mockPrepare).toHaveBeenCalledWith(MASTER, REGISTRATION_NAME);
    expect(
      screen.getByRole("button", { name: "Open Hyperliquid API" }),
    ).toBeTruthy();
    fireEvent.press(
      screen.getByRole("button", { name: "I’ve added it — verify" }),
    );

    await waitFor(() => expect(mockFinish).toHaveBeenCalledTimes(1));
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(mockSelect).toHaveBeenCalledTimes(1);
    expect(mockSwitchContext).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith("/(tabs)/trade");
  });

  test("restores an authorization checkpoint without generating another key", async () => {
    mockLoad.mockResolvedValue({ status: "authorization", attempt: ATTEMPT });

    render(<SetupScreen />);

    expect(await screen.findByText(AGENT)).toBeTruthy();
    expect(mockPrepare).not.toHaveBeenCalled();
    fireEvent.press(screen.getByRole("button", { name: "Finish later" }));
    expect(mockFinish).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith("/(tabs)/trade");
  });
});
