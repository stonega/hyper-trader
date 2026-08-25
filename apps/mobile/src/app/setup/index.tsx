import Ionicons from "@expo/vector-icons/Ionicons";
import {
  type HyperliquidNetwork,
  hasSignerAccessCapability,
} from "@hyper-trader/hyperliquid";
import { CameraView } from "expo-camera";
import * as Clipboard from "expo-clipboard";
import { useRouter } from "expo-router";
import { Button } from "heroui-native/button";
import { Card } from "heroui-native/card";
import { Description } from "heroui-native/description";
import { FieldError } from "heroui-native/field-error";
import { useThemeColor } from "heroui-native/hooks";
import { InputGroup } from "heroui-native/input-group";
import { Label } from "heroui-native/label";
import { TextField } from "heroui-native/text-field";
import type { JSX } from "react";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { AppState, BackHandler, Linking, ScrollView, View } from "react-native";
import QRCodeStyled from "react-native-qrcode-styled";
import Animated, {
  FadeIn,
  FadeOut,
  ReduceMotion,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/app-text";
import { KeyboardAwareView } from "../../components/keyboard-aware-view";
import { useReducedMotion } from "../../components/use-reduced-motion";
import { useTradingContext } from "../../core/context/provider";
import { useAccountDirectory } from "../../features/accounts/account-directory-provider";
import { accountFromManualSetup } from "../../features/accounts/manual-setup-account";
import {
  getManualSetupRuntime,
  type ManualSetupRuntime,
} from "../../features/accounts/manual-setup-runtime";
import type {
  SetupAttempt,
  SetupVerificationResult,
} from "../../features/accounts/setup-coordinator";
import {
  INITIAL_SETUP_FLOW,
  reduceSetupFlow,
  setupConsumesBack,
} from "../../features/accounts/setup-flow";
import type { ActivatedSetupRecord } from "../../features/accounts/setup-repository";
import { HYPERLIQUID_API_WALLET_URLS } from "../../platform/wallet/manual-authority";
import { DEFAULT_API_WALLET_REGISTRATION_NAME } from "../../platform/wallet/setup-identifiers";

const ETHEREUM_ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/i;
const ETHEREUM_QR_PATTERN =
  /^ethereum:(?:pay-)?(0x[0-9a-f]{40})(?:@[^/?]+)?(?:\/[^?]*)?(?:\?.*)?$/i;

function masterAddressFromQrCode(data: string): string | null {
  const value = data.trim();
  if (ETHEREUM_ADDRESS_PATTERN.test(value)) return value;
  return ETHEREUM_QR_PATTERN.exec(value)?.[1] ?? null;
}

const PHASE_COPY = {
  loading: {
    title: "Restore setup",
    description: "Checking this device for saved setup progress.",
  },
  account: {
    title: "Enter your Hyperliquid wallet",
    description:
      "Enter the public address you use on this Hyperliquid network.",
  },
  protection: {
    title: "Generate your API wallet",
    description:
      "Confirm with your device to generate and protect a new API wallet.",
  },
  authorization: {
    title: "Add this API wallet",
    description:
      "Add this address on Hyperliquid, then return here. We’ll check it automatically.",
  },
  verifying: {
    title: "Add this API wallet",
    description: "Checking Hyperliquid for this API wallet.",
  },
  activating: {
    title: "Add this API wallet",
    description: "Saving your trading account on this device.",
  },
  failure: {
    title: "Setup is safely paused",
    description:
      "Your completed steps remain on this device so you can retry without starting over.",
  },
  ready: {
    title: "Trading access is ready",
    description: "The verified account is saved and Trade will open next.",
  },
} as const;

function stepLabel(phase: keyof typeof PHASE_COPY): string {
  switch (phase) {
    case "loading":
      return "Restoring";
    case "account":
      return "Step 1 of 2";
    case "protection":
      return "Step 1 of 2";
    case "authorization":
    case "verifying":
    case "activating":
    case "ready":
      return "Step 2 of 2";
    case "failure":
      return "Paused";
  }
}

function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Setup could not continue. Your saved progress was not discarded.";
  }
  if (error.message.includes("valid master")) {
    return "Enter a valid 42-character Ethereum master-wallet address.";
  }
  if (error.message.includes("registration name")) {
    return "The default API wallet name could not be prepared. Restart setup and try again.";
  }
  if (error.message.includes("authentication")) {
    return "System authentication did not complete. The API wallet was not generated.";
  }
  return error.message;
}

function verificationMessage(result: SetupVerificationResult): string {
  if (result.status !== "inert") return "Authorization needs review.";
  switch (result.reason) {
    case "registration_unverified":
      return "Hyperliquid does not show this API wallet yet. Check the selected account and address, then try again.";
    case "expired":
      return "This 24-hour setup expired and its staged key was removed. Generate a new address before authorizing again.";
    case "not_pending":
      return "The pending setup checkpoint is no longer available.";
    case "binding_mismatch":
      return "Setup details changed. Start setup again.";
    case "activation_lost":
      return "Setup changed on this device. Reopen it and try again.";
  }
}

export default function SetupScreen(): JSX.Element {
  const insets = useSafeAreaInsets();
  const accent = useThemeColor("accent");
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const directory = useAccountDirectory();
  const tradingContext = useTradingContext();
  const saveAccount = directory.save;
  const selectAccount = directory.select;
  const switchTradingContext = tradingContext.switchContext;
  const [state, dispatch] = useReducer(reduceSetupFlow, INITIAL_SETUP_FLOW);
  const [masterAccount, setMasterAccount] = useState("");
  const [setupNetwork, setSetupNetwork] = useState<HyperliquidNetwork>(
    tradingContext.current.network,
  );
  const [registrationName, setRegistrationName] = useState(
    DEFAULT_API_WALLET_REGISTRATION_NAME,
  );
  const [attempt, setAttempt] = useState<SetupAttempt | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const runtime = useRef<ManualSetupRuntime | null>(null);
  const operation = useRef(0);
  const scannerActive = useRef(false);
  const prepareInFlight = useRef(false);
  const verificationInFlight = useRef(false);
  const verifyOnForeground = useRef<(() => void) | null>(null);
  const copy = PHASE_COPY[state.phase];
  const setupCapabilityEnabled = hasSignerAccessCapability(setupNetwork);

  useEffect(() => {
    const subscription = CameraView.onModernBarcodeScanned(({ data }) => {
      if (!scannerActive.current) return;
      scannerActive.current = false;
      const scannedAddress = masterAddressFromQrCode(data);
      if (scannedAddress === null) {
        setNotice(
          "This QR code does not contain a valid Ethereum wallet address.",
        );
      } else {
        setMasterAccount(scannedAddress);
        setNotice(null);
      }
      void CameraView.dismissScanner().catch(() => undefined);
    });

    return () => {
      const shouldDismissScanner = scannerActive.current;
      scannerActive.current = false;
      subscription.remove();
      if (shouldDismissScanner) {
        void CameraView.dismissScanner().catch(() => undefined);
      }
    };
  }, []);

  const finishActivation = useCallback(
    async (
      setupRuntime: ManualSetupRuntime,
      currentAttempt: SetupAttempt,
      activation: ActivatedSetupRecord,
      generation: number,
    ) => {
      try {
        const account = accountFromManualSetup(currentAttempt, activation);
        if (!(await saveAccount(account))) {
          throw new Error("The verified account could not be saved locally.");
        }
        if (!(await selectAccount(account.id))) {
          throw new Error(
            "The verified account could not be selected locally.",
          );
        }
        const switched = await switchTradingContext({
          network: account.network,
          masterAccount: account.masterAccount,
          targetAccount: account.target.address,
          signer: {
            agentAddress: activation.binding.agentAddress,
            generation: activation.binding.generation,
          },
        });
        if (!switched) {
          throw new Error("A newer account change interrupted activation.");
        }
        await setupRuntime.finish();
        dispatch({ type: "COMPLETE", generation });
      } catch (error) {
        dispatch({
          type: "FAIL",
          generation,
          reason: errorMessage(error),
          returnPhase: "authorization",
        });
      }
    },
    [saveAccount, selectAccount, switchTradingContext],
  );

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const setupRuntime = await getManualSetupRuntime();
        const saved = await setupRuntime.load();
        if (!active) return;
        runtime.current = setupRuntime;
        switch (saved.status) {
          case "empty":
            dispatch({ type: "HYDRATE", phase: "account" });
            return;
          case "identity":
            setSetupNetwork(saved.network);
            setMasterAccount(saved.masterAccount);
            setRegistrationName(DEFAULT_API_WALLET_REGISTRATION_NAME);
            dispatch({ type: "HYDRATE", phase: "account" });
            return;
          case "protection":
            setSetupNetwork(saved.network);
            setMasterAccount(saved.masterAccount);
            setRegistrationName(saved.registrationName);
            dispatch({ type: "HYDRATE", phase: "protection" });
            return;
          case "authorization":
            setSetupNetwork(saved.attempt.network);
            setMasterAccount(saved.attempt.masterAccount);
            setRegistrationName(saved.attempt.registrationName);
            setAttempt(saved.attempt);
            dispatch({ type: "HYDRATE", phase: "authorization" });
            return;
          case "finalizing": {
            setSetupNetwork(saved.attempt.network);
            setMasterAccount(saved.attempt.masterAccount);
            setRegistrationName(saved.attempt.registrationName);
            setAttempt(saved.attempt);
            const generation = ++operation.current;
            dispatch({ type: "HYDRATE", phase: "activating" });
            dispatch({ type: "START_ACTIVATE", generation });
            await finishActivation(
              setupRuntime,
              saved.attempt,
              saved.activation,
              generation,
            );
          }
        }
      } catch (error) {
        if (!active) return;
        dispatch({
          type: "FAIL",
          generation: 0,
          reason: errorMessage(error),
          returnPhase: "account",
        });
      }
    })();
    return () => {
      active = false;
      operation.current += 1;
    };
  }, [finishActivation]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        if (setupConsumesBack(state.phase)) return true;
        if (state.phase === "protection") {
          dispatch({ type: "BACK" });
          return true;
        }
        router.replace("/(tabs)/trade");
        return true;
      },
    );
    return () => subscription.remove();
  }, [router, state.phase]);

  useEffect(() => {
    if (state.phase === "ready") router.replace("/(tabs)/trade");
  }, [router, state.phase]);

  const requireRuntime = async (): Promise<ManualSetupRuntime> => {
    const value = runtime.current ?? (await getManualSetupRuntime());
    runtime.current = value;
    return value;
  };

  const copyPublicValue = async (value: string, label: string) => {
    try {
      await Clipboard.setStringAsync(value);
      setNotice(`${label} copied.`);
    } catch {
      setNotice(
        `Could not copy the ${label.toLowerCase()}. Select it manually.`,
      );
    }
  };

  const openHyperliquid = async () => {
    try {
      await Linking.openURL(HYPERLIQUID_API_WALLET_URLS[setupNetwork]);
    } catch {
      setNotice(
        "Hyperliquid could not be opened. Try again after checking your connection.",
      );
    }
  };

  const generateWallet = async () => {
    if (prepareInFlight.current) return;
    if (!setupCapabilityEnabled) {
      setNotice(
        `${setupNetwork === "mainnet" ? "Mainnet" : "Testnet"} API-wallet setup is unavailable in this build.`,
      );
      return;
    }
    prepareInFlight.current = true;
    const generation = ++operation.current;
    let identitySaved = state.phase !== "account";
    setNotice(null);
    try {
      const setupRuntime = await requireRuntime();
      const identity =
        state.phase === "account"
          ? await setupRuntime.saveMasterAccount(
              setupNetwork,
              masterAccount,
              registrationName,
            )
          : { masterAccount, registrationName };
      if (state.phase === "account") {
        identitySaved = true;
        dispatch({ type: "MASTER_SAVED" });
      }
      setMasterAccount(identity.masterAccount);
      setRegistrationName(identity.registrationName);
      dispatch({ type: "START_PREPARE", generation });
      const prepared = await setupRuntime.prepare(
        setupNetwork,
        identity.masterAccount,
        identity.registrationName,
      );
      if (generation !== operation.current) return;
      setAttempt(prepared);
      dispatch({ type: "PREPARED", generation });
    } catch (error) {
      if (!identitySaved) {
        setNotice(errorMessage(error));
        return;
      }
      dispatch({
        type: "FAIL",
        generation,
        reason: errorMessage(error),
        returnPhase: "protection",
      });
    } finally {
      prepareInFlight.current = false;
    }
  };

  const activateVerified = async (
    setupRuntime: ManualSetupRuntime,
    currentAttempt: SetupAttempt,
    result: SetupVerificationResult,
    generation: number,
  ) => {
    if (result.status === "inert") {
      if (result.reason === "not_pending") {
        const recovered = setupRuntime.activationFor(currentAttempt);
        if (recovered !== null) {
          dispatch({ type: "START_ACTIVATE", generation });
          await finishActivation(
            setupRuntime,
            currentAttempt,
            recovered,
            generation,
          );
          return;
        }
      }
      if (result.reason === "expired") {
        await setupRuntime.finish();
        setAttempt(null);
      }
      dispatch({
        type: "FAIL",
        generation,
        reason: verificationMessage(result),
        returnPhase:
          result.reason === "expired" ? "protection" : "authorization",
      });
      return;
    }
    const activation = setupRuntime.activationFor(currentAttempt);
    if (activation === null) {
      dispatch({
        type: "FAIL",
        generation,
        reason: "The verified activation checkpoint could not be restored.",
        returnPhase: "authorization",
      });
      return;
    }
    dispatch({ type: "START_ACTIVATE", generation });
    await finishActivation(
      setupRuntime,
      currentAttempt,
      activation,
      generation,
    );
  };

  const verifyAuthorization = async (automatic = false) => {
    if (attempt === null || verificationInFlight.current) return;
    verificationInFlight.current = true;
    const generation = ++operation.current;
    setNotice(null);
    dispatch({ type: "START_VERIFY", generation });
    try {
      const setupRuntime = await requireRuntime();
      const result = await setupRuntime.verify(attempt);
      if (
        result.status === "inert" &&
        result.reason === "registration_unverified"
      ) {
        dispatch({ type: "VERIFY_PENDING", generation });
        setNotice(
          automatic
            ? "API wallet not found yet. Finish adding it on Hyperliquid, then tap Check again."
            : "API wallet not found yet. Check the address on Hyperliquid and try again.",
        );
        return;
      }
      await activateVerified(setupRuntime, attempt, result, generation);
    } catch (error) {
      dispatch({
        type: "FAIL",
        generation,
        reason: errorMessage(error),
        returnPhase: "authorization",
      });
    } finally {
      verificationInFlight.current = false;
    }
  };

  verifyOnForeground.current = () => {
    if (state.phase === "authorization" && attempt !== null) {
      void verifyAuthorization(true);
    }
  };

  useEffect(() => {
    let previous = AppState.currentState;
    const subscription = AppState.addEventListener("change", (next) => {
      const returned = previous === "background" || previous === "inactive";
      previous = next;
      if (returned && next === "active") verifyOnForeground.current?.();
    });
    return () => subscription.remove();
  }, []);

  const scanMasterWallet = async () => {
    if (!CameraView.isModernBarcodeScannerAvailable) {
      setNotice(
        "QR scanning is not available on this device. Enter the address manually.",
      );
      return;
    }
    scannerActive.current = true;
    setNotice(null);
    try {
      await CameraView.launchScanner({
        barcodeTypes: ["qr"],
        isGuidanceEnabled: true,
        isHighlightingEnabled: true,
        isPinchToZoomEnabled: true,
      });
    } catch {
      scannerActive.current = false;
      setNotice(
        "The QR scanner could not open. Check camera access and try again.",
      );
    }
  };

  const duration = reducedMotion ? 0 : 160;
  const addressInvalid =
    notice?.includes("42-character Ethereum") || notice?.includes("QR");
  const authorizationVisible =
    attempt !== null &&
    (state.phase === "authorization" ||
      state.phase === "verifying" ||
      state.phase === "activating");

  return (
    <KeyboardAwareView className="flex-1 bg-background">
      <ScrollView
        className="flex-1 bg-background"
        contentContainerClassName="gap-6 px-5"
        contentContainerStyle={{
          flexGrow: 1,
          paddingTop: Math.max(insets.top, 24),
          paddingBottom: Math.max(insets.bottom, 24),
        }}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
      >
        <View className="gap-2">
          <Text className="text-sm font-medium text-accent">
            Hyperliquid {setupNetwork}
          </Text>
          <Text
            accessibilityRole="header"
            className="text-4xl font-semibold tracking-tight text-foreground"
          >
            Set up trading
          </Text>
          <Text className="text-base leading-6 text-muted">
            {stepLabel(state.phase)}
          </Text>
          {setupNetwork === "mainnet" && setupCapabilityEnabled ? (
            <Text className="text-sm leading-5 text-danger">
              Mainnet actions use real funds. This API wallet is isolated from
              testnet and remains bound to this exact account.
            </Text>
          ) : setupNetwork === "mainnet" ? (
            <Text className="text-sm leading-5 text-muted">
              Mainnet API-wallet setup remains unavailable until its release
              evidence is approved.
            </Text>
          ) : null}
        </View>

        <Card variant="default" className="min-h-80 gap-4">
          <Card.Body className="gap-4">
            <Animated.View
              key={state.phase}
              className="gap-4"
              entering={FadeIn.duration(duration).reduceMotion(
                ReduceMotion.System,
              )}
              exiting={FadeOut.duration(Math.min(duration, 100)).reduceMotion(
                ReduceMotion.System,
              )}
            >
              <View className="gap-2">
                <Card.Title>{copy.title}</Card.Title>
                <Card.Description>{copy.description}</Card.Description>
              </View>

              {state.phase === "account" ? (
                <View>
                  <TextField isInvalid={addressInvalid} isRequired>
                    <Label>Master wallet address</Label>
                    <InputGroup>
                      <InputGroup.Input
                        autoCapitalize="none"
                        autoCorrect={false}
                        onChangeText={(value) => {
                          scannerActive.current = false;
                          setMasterAccount(value);
                          setNotice(null);
                        }}
                        placeholder="0x…"
                        value={masterAccount}
                      />
                      <InputGroup.Suffix className="px-1">
                        <Button
                          accessibilityHint="Opens the camera to scan a public wallet address."
                          accessibilityLabel="Scan master wallet QR code"
                          animation={reducedMotion ? "disable-all" : undefined}
                          hitSlop={4}
                          isIconOnly
                          onPress={() => {
                            void scanMasterWallet();
                          }}
                          size="sm"
                          variant="ghost"
                        >
                          <Ionicons
                            accessibilityElementsHidden
                            color={accent}
                            importantForAccessibility="no-hide-descendants"
                            name="qr-code-outline"
                            size={20}
                          />
                        </Button>
                      </InputGroup.Suffix>
                    </InputGroup>
                    <Description>
                      Public address only. Never enter a seed phrase or private
                      key.
                    </Description>
                    {addressInvalid ? <FieldError>{notice}</FieldError> : null}
                  </TextField>
                </View>
              ) : null}

              {state.phase === "protection" ? (
                <View className="gap-3 rounded-2xl bg-surface-secondary p-4">
                  <Text className="font-medium text-foreground">
                    {masterAccount}
                  </Text>
                  <Text className="text-base leading-6 text-muted">
                    Your device protects the private key. Hyper Trader never
                    shows or copies it.
                  </Text>
                </View>
              ) : null}

              {authorizationVisible ? (
                <View className="gap-4">
                  <View className="gap-4 rounded-2xl bg-surface-secondary p-4">
                    <View className="gap-1">
                      <Text className="text-sm font-medium text-muted">
                        API wallet address
                      </Text>
                      <Text className="text-sm leading-5 text-muted">
                        Scan or copy this exact public address into Hyperliquid.
                      </Text>
                    </View>

                    <View
                      accessible
                      accessibilityLabel="QR code for the generated API wallet address"
                      accessibilityRole="image"
                      className="items-center self-center rounded-3xl bg-white p-1"
                      testID="api-wallet-address-qr"
                    >
                      <QRCodeStyled
                        color="#111827"
                        data={attempt.agentAddress}
                        errorCorrectionLevel="M"
                        padding={14}
                        pieceScale={1.03}
                        size={156}
                        testID="api-wallet-address-qr-code"
                      />
                    </View>

                    <Text
                      selectable
                      className="text-center text-sm font-medium leading-5 text-foreground"
                    >
                      {attempt.agentAddress}
                    </Text>
                    <Button
                      accessibilityLabel="Copy API wallet address"
                      animation={reducedMotion ? "disable-all" : undefined}
                      className="min-h-11 w-full"
                      onPress={() => {
                        void copyPublicValue(
                          attempt.agentAddress,
                          "API wallet address",
                        );
                      }}
                      variant="outline"
                    >
                      <Ionicons
                        accessibilityElementsHidden
                        color={accent}
                        importantForAccessibility="no-hide-descendants"
                        name="copy-outline"
                        size={18}
                      />
                      <Button.Label>Copy wallet address</Button.Label>
                    </Button>
                  </View>

                  <Text className="text-sm leading-5 text-muted">
                    Connect {attempt.masterAccount} and add this address. Use
                    {` ${attempt.registrationName}`} if Hyperliquid asks for a
                    name, and choose the expiry you want.
                  </Text>
                </View>
              ) : null}

              {state.phase === "failure" ? (
                <Text
                  accessibilityRole="alert"
                  className="text-sm text-warning"
                >
                  {state.failureReason}
                </Text>
              ) : null}

              {notice !== null && !addressInvalid ? (
                <Text
                  accessibilityLiveRegion="polite"
                  className="text-sm text-muted"
                >
                  {notice}
                </Text>
              ) : null}
            </Animated.View>
          </Card.Body>

          <Card.Footer className="flex-col gap-3">
            {state.phase === "account" ? (
              <Button
                animation={reducedMotion ? "disable-all" : undefined}
                className="min-h-12 w-full"
                isDisabled={!setupCapabilityEnabled}
                onPress={() => void generateWallet()}
                variant="primary"
              >
                Generate API wallet
              </Button>
            ) : null}

            {state.phase === "protection" ? (
              <Button
                animation={reducedMotion ? "disable-all" : undefined}
                className="min-h-12 w-full"
                isDisabled={
                  !setupCapabilityEnabled || state.readiness === "working"
                }
                onPress={() => void generateWallet()}
                variant="primary"
              >
                {state.readiness === "working"
                  ? "Generating wallet…"
                  : "Generate API wallet"}
              </Button>
            ) : null}

            {authorizationVisible ? (
              <>
                <Button
                  animation={reducedMotion ? "disable-all" : undefined}
                  className="min-h-12 w-full"
                  isDisabled={state.readiness === "working"}
                  onPress={() => void openHyperliquid()}
                  variant="primary"
                >
                  Open Hyperliquid API
                </Button>
                <Button
                  animation={reducedMotion ? "disable-all" : undefined}
                  className="min-h-12 w-full"
                  isDisabled={state.readiness === "working"}
                  onPress={() => void verifyAuthorization()}
                  variant="secondary"
                >
                  {state.phase === "verifying"
                    ? "Checking…"
                    : state.phase === "activating"
                      ? "Saving account…"
                      : "Check again"}
                </Button>
              </>
            ) : null}

            {state.phase === "failure" ? (
              <Button
                animation={reducedMotion ? "disable-all" : undefined}
                className="min-h-12 w-full"
                onPress={() => {
                  dispatch({ type: "RETRY" });
                }}
                variant="primary"
              >
                {state.returnPhase === "authorization"
                  ? "Review authorization"
                  : "Try again"}
              </Button>
            ) : null}

            {!setupConsumesBack(state.phase) && state.phase !== "ready" ? (
              <Button
                animation={reducedMotion ? "disable-all" : undefined}
                className="min-h-12 w-full"
                onPress={() => router.replace("/(tabs)/trade")}
                variant="tertiary"
              >
                Finish later
              </Button>
            ) : null}
          </Card.Footer>
        </Card>
      </ScrollView>
    </KeyboardAwareView>
  );
}
