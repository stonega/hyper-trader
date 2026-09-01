import {
  type HyperliquidNetwork,
  MAINNET_TRADING_RELEASE_STAGE,
} from "@hyper-trader/hyperliquid";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { AppState, type AppStateStatus } from "react-native";

import SetupScreen from "../app/setup";
import type { SetupAttempt } from "../features/accounts/setup-coordinator";
import type { ActivatedSetupRecord } from "../features/accounts/setup-repository";

const MASTER = "0x1111111111111111111111111111111111111111";
const AGENT = "0x2222222222222222222222222222222222222222";
const REGISTRATION_NAME = "Hyper Trader";
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
    (
      network: HyperliquidNetwork,
      master: string,
      registrationName: string,
    ) => Promise<SetupAttempt>
  >();
const mockVerify = jest.fn<() => Promise<unknown>>();
const mockActivationFor = jest.fn<() => ActivatedSetupRecord | null>();
const mockFinish = jest.fn<() => Promise<void>>();
const mockSave = jest.fn<() => Promise<boolean>>();
const mockSelect = jest.fn<() => Promise<boolean>>();
const mockSwitchContext = jest.fn<() => Promise<boolean>>();
const mockLaunchScanner = jest.fn<(options?: unknown) => Promise<void>>();
const mockDismissScanner = jest.fn<() => Promise<void>>();
const mockSetStringAsync = jest.fn<(value: string) => Promise<boolean>>();
let mockScanListener:
  | ((event: { readonly data: string; readonly type: string }) => void)
  | null = null;
let mockAppStateListener: ((state: AppStateStatus) => void) | null = null;
let mockNetwork: HyperliquidNetwork = "testnet";
const saveAccount = () => mockSave();
const selectAccount = () => mockSelect();
const switchTradingContext = () => mockSwitchContext();

const mockRuntime = {
  load: () => mockLoad(),
  saveMasterAccount: async (
    _network: HyperliquidNetwork,
    master: string,
    registrationName: string,
  ) => ({
    masterAccount: master,
    registrationName,
  }),
  prepare: (
    network: HyperliquidNetwork,
    master: string,
    registrationName: string,
  ) => mockPrepare(network, master, registrationName),
  verify: () => mockVerify(),
  activationFor: () => mockActivationFor(),
  finish: () => mockFinish(),
  cancel: async () => undefined,
};

jest
  .spyOn(AppState, "addEventListener")
  .mockImplementation((_type, listener) => {
    mockAppStateListener = listener;
    return {
      remove: () => {
        mockAppStateListener = null;
      },
    };
  });

jest.mock("expo-camera", () => ({
  CameraView: {
    dismissScanner: () => mockDismissScanner(),
    isModernBarcodeScannerAvailable: true,
    launchScanner: (options?: unknown) => mockLaunchScanner(options),
    onModernBarcodeScanned: (
      listener: (event: {
        readonly data: string;
        readonly type: string;
      }) => void,
    ) => {
      mockScanListener = listener;
      return {
        remove: () => {
          mockScanListener = null;
        },
      };
    },
  },
}));

jest.mock("expo-clipboard", () => ({
  setStringAsync: (value: string) => mockSetStringAsync(value),
}));

jest.mock("react-native-qrcode-styled", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const { View } =
    jest.requireActual<typeof import("react-native")>("react-native");

  return {
    __esModule: true,
    default: (props: Record<string, unknown>) =>
      React.createElement(View, props),
  };
});

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
      network: mockNetwork,
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
  beforeEach(() => {
    mockNetwork = "testnet";
    mockPrepare.mockClear();
  });

  test("defaults new setup to Mainnet and exposes both network choices", async () => {
    mockNetwork = "testnet";
    mockLoad.mockResolvedValue({ status: "empty" });

    render(<SetupScreen />);

    expect(
      await screen.findByText("Enter your Hyperliquid wallet"),
    ).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Mainnet" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Testnet" })).not.toBeChecked();
    expect(
      screen
        .getAllByRole("radio")
        .map((option) => option.props.accessibilityLabel),
    ).toEqual(["Mainnet", "Testnet"]);
    expect(screen.getByText("Practice with test funds")).toBeTruthy();
    expect(screen.getByText("Uses real funds")).toBeTruthy();
    if (MAINNET_TRADING_RELEASE_STAGE === "preactivation") {
      expect(
        screen.getByText(
          "Mainnet API-wallet setup remains unavailable until its release evidence is approved.",
        ),
      ).toHaveProp("className", expect.stringContaining("text-muted"));
    } else {
      const mainnetNotice = screen.getByText(
        "Mainnet actions use real funds. This API wallet is isolated from testnet and remains bound to this exact account.",
      );
      expect(mainnetNotice).toHaveProp(
        "className",
        expect.stringContaining("text-accent"),
      );
      expect(mainnetNotice.props.className).not.toContain("text-danger");
    }
  });

  test("applies the compile-owned mainnet stage to setup", async () => {
    mockNetwork = "mainnet";
    mockLoad.mockResolvedValue({ status: "empty" });
    mockPrepare.mockResolvedValue({ ...ATTEMPT, network: "mainnet" });

    render(<SetupScreen />);

    expect(
      await screen.findByText("Enter your Hyperliquid wallet"),
    ).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Mainnet" })).toBeChecked();

    if (MAINNET_TRADING_RELEASE_STAGE === "preactivation") {
      expect(
        await screen.findByText(
          "Mainnet API-wallet setup remains unavailable until its release evidence is approved.",
        ),
      ).toBeTruthy();
      const generate = screen.getByRole("button", {
        name: "Generate API wallet",
      });
      expect(generate).toBeDisabled();
      fireEvent.press(generate);
      expect(mockPrepare).not.toHaveBeenCalled();
    } else {
      fireEvent.changeText(screen.getByPlaceholderText("0x…"), MASTER);
      fireEvent.press(
        screen.getByRole("button", { name: "Generate API wallet" }),
      );
      await waitFor(() =>
        expect(mockPrepare).toHaveBeenCalledWith(
          "mainnet",
          MASTER,
          REGISTRATION_NAME,
        ),
      );
    }
  });

  test("scans a master wallet address from the input action", async () => {
    mockLoad.mockResolvedValue({ status: "empty" });
    mockLaunchScanner.mockResolvedValue(undefined);
    mockDismissScanner.mockResolvedValue(undefined);

    render(<SetupScreen />);

    expect(
      await screen.findByText("Enter your Hyperliquid wallet"),
    ).toBeTruthy();
    fireEvent.press(
      screen.getByRole("button", { name: "Scan master wallet QR code" }),
    );
    await waitFor(() =>
      expect(mockLaunchScanner).toHaveBeenCalledWith({
        barcodeTypes: ["qr"],
        isGuidanceEnabled: true,
        isHighlightingEnabled: true,
        isPinchToZoomEnabled: true,
      }),
    );

    await act(async () => {
      mockScanListener?.({ data: `ethereum:${MASTER}@421614`, type: "qr" });
    });

    expect(screen.getByPlaceholderText("0x…")).toHaveProp("value", MASTER);
    expect(mockDismissScanner).toHaveBeenCalledTimes(1);
  });

  test("uses the default API-wallet name without another input", async () => {
    mockLoad.mockResolvedValue({ status: "empty" });
    mockPrepare.mockResolvedValue(ATTEMPT);

    render(<SetupScreen />);

    expect(
      await screen.findByText("Enter your Hyperliquid wallet"),
    ).toBeTruthy();
    fireEvent.press(screen.getByRole("radio", { name: "Testnet" }));
    fireEvent.changeText(screen.getByPlaceholderText("0x…"), MASTER);
    expect(screen.queryByText("API wallet name")).toBeNull();
    fireEvent.press(
      screen.getByRole("button", { name: "Generate API wallet" }),
    );

    expect(await screen.findByText(AGENT)).toBeTruthy();
    expect(mockPrepare).toHaveBeenCalledWith(
      "testnet",
      MASTER,
      REGISTRATION_NAME,
    );
  });

  test("generates, verifies, saves, and enters Trade", async () => {
    mockLoad.mockResolvedValue({
      status: "protection",
      network: "testnet",
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
    mockSetStringAsync.mockResolvedValue(true);

    render(<SetupScreen />);

    expect(await screen.findByText("Generate your API wallet")).toBeTruthy();
    fireEvent.press(
      screen.getByRole("button", { name: "Generate API wallet" }),
    );

    expect(await screen.findByText(AGENT)).toBeTruthy();
    expect(mockPrepare).toHaveBeenCalledWith(
      "testnet",
      MASTER,
      REGISTRATION_NAME,
    );
    expect(screen.getByTestId("api-wallet-address-qr-code")).toHaveProp(
      "data",
      AGENT,
    );
    expect(screen.queryByText("API wallet address")).toBeNull();
    expect(
      screen.getByText(
        "Scan or copy this exact public address into Hyperliquid.",
      ),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Copy wallet name" }),
    ).toBeNull();
    fireEvent.press(
      screen.getByRole("button", { name: "Copy API wallet address" }),
    );
    await waitFor(() => expect(mockSetStringAsync).toHaveBeenCalledWith(AGENT));
    expect(screen.getByText("API wallet address copied.")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Open Hyperliquid API" }),
    ).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: "Check again" }));

    await waitFor(() => expect(mockFinish).toHaveBeenCalledTimes(1));
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(mockSelect).toHaveBeenCalledTimes(1);
    expect(mockSwitchContext).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith("/(tabs)/trade");
  });

  test("keeps the wallet-check subtitle stable while checking", async () => {
    const authorizationSubtitle =
      "Add this address on Hyperliquid, then return here. We’ll check it automatically.";
    let resolveVerification: ((result: unknown) => void) | undefined;
    let resolveSave: ((saved: boolean) => void) | undefined;
    mockLoad.mockResolvedValue({ status: "authorization", attempt: ATTEMPT });
    mockVerify.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveVerification = resolve;
        }),
    );
    mockActivationFor.mockReturnValue(ACTIVATION);
    mockSave.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
    );
    mockSelect.mockResolvedValue(true);
    mockSwitchContext.mockResolvedValue(true);
    mockFinish.mockResolvedValue(undefined);

    render(<SetupScreen />);

    expect(await screen.findByText(authorizationSubtitle)).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: "Check again" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Checking" })).toBeDisabled(),
    );
    expect(screen.getByText(authorizationSubtitle)).toBeTruthy();

    await act(async () => {
      resolveVerification?.({
        status: "activated",
        binding: ACTIVATION.binding,
        effectiveExpiry: ACTIVATION.effectiveExpiry,
      });
    });

    await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));
    expect(screen.getByText(authorizationSubtitle)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Checking" })).toBeDisabled();

    await act(async () => {
      resolveSave?.(true);
    });
    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith("/(tabs)/trade"),
    );
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

  test("checks a pending API wallet automatically after returning to the app", async () => {
    mockLoad.mockResolvedValue({ status: "authorization", attempt: ATTEMPT });
    mockVerify.mockClear();
    mockVerify.mockResolvedValue({
      status: "inert",
      reason: "registration_unverified",
    });

    render(<SetupScreen />);

    expect(await screen.findByText(AGENT)).toBeTruthy();
    expect(mockVerify).not.toHaveBeenCalled();

    act(() => {
      mockAppStateListener?.("background");
      mockAppStateListener?.("active");
    });

    await waitFor(() => expect(mockVerify).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/API wallet not found yet/)).toBeTruthy();
  });
});
