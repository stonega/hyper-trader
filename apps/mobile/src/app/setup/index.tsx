import * as Clipboard from "expo-clipboard";
import { useRouter } from "expo-router";
import { Button } from "heroui-native/button";
import { Card } from "heroui-native/card";
import { Description } from "heroui-native/description";
import { FieldError } from "heroui-native/field-error";
import { Input } from "heroui-native/input";
import { Label } from "heroui-native/label";
import { TextField } from "heroui-native/text-field";
import type { JSX } from "react";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { BackHandler, Linking, ScrollView, View } from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  ReduceMotion,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/app-text";
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
import { HYPERLIQUID_TESTNET_API_WALLET_URL } from "../../platform/wallet/manual-authority";

const PHASE_COPY = {
  loading: {
    title: "Restore setup",
    description: "Checking this device for saved setup progress.",
  },
  account: {
    title: "Enter your Hyperliquid wallet",
    description:
      "Use the public address of the master wallet you connect to Hyperliquid testnet.",
  },
  protection: {
    title: "Protect this device",
    description:
      "Your API-wallet key is secured on this device and opened only after system authentication.",
  },
  authorization: {
    title: "Add this API wallet",
    description:
      "Copy the public values below into Hyperliquid testnet, then return here to verify them.",
  },
  verifying: {
    title: "Verify authorization",
    description:
      "Checking the exact address, master account, and finite expiry directly with Hyperliquid.",
  },
  activating: {
    title: "Save trading access",
    description:
      "The verified account and protected credential are being activated locally.",
  },
  failure: {
    title: "Setup is safely paused",
    description:
      "Your completed steps remain on this device so you can retry without starting over.",
  },
  ready: {
    title: "Trading access is ready",
    description:
      "The verified testnet account is saved and Trade will open next.",
  },
} as const;

function stepLabel(phase: keyof typeof PHASE_COPY): string {
  switch (phase) {
    case "loading":
      return "Restoring";
    case "account":
      return "Step 1 of 4";
    case "protection":
      return "Step 2 of 4";
    case "authorization":
      return "Step 3 of 4";
    case "verifying":
    case "activating":
    case "ready":
      return "Step 4 of 4";
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
    return "Enter an API wallet name using 1 to 16 characters.";
  }
  if (error.message.includes("authentication")) {
    return "System authentication did not complete. The API wallet was not generated.";
  }
  if (error.message.includes("named-agent slot")) {
    return "No reviewed named API-wallet slot is available for this account.";
  }
  if (error.message.includes("Replacing the existing")) {
    return "This account already has Hyper Trader’s named API wallet. Review or revoke it on Hyperliquid before replacing it.";
  }
  return error.message;
}

function verificationMessage(result: SetupVerificationResult): string {
  if (result.status !== "inert") return "Authorization needs review.";
  switch (result.reason) {
    case "registration_unverified":
      return "Hyperliquid does not show this exact API-wallet address with a finite 30-day expiry yet. Check the selected master account and address, then try again.";
    case "expired":
      return "This 24-hour setup expired and its staged key was removed. Generate a new address before authorizing again.";
    case "not_pending":
      return "The pending setup checkpoint is no longer available.";
    case "binding_mismatch":
      return "The saved setup identity did not match. No authorization was activated.";
    case "activation_lost":
      return "Another local activation changed first. Reopen setup to verify the current state.";
  }
}

export default function SetupScreen(): JSX.Element {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const directory = useAccountDirectory();
  const tradingContext = useTradingContext();
  const saveAccount = directory.save;
  const selectAccount = directory.select;
  const switchTradingContext = tradingContext.switchContext;
  const [state, dispatch] = useReducer(reduceSetupFlow, INITIAL_SETUP_FLOW);
  const [masterAccount, setMasterAccount] = useState("");
  const [registrationName, setRegistrationName] = useState("");
  const [attempt, setAttempt] = useState<SetupAttempt | null>(null);
  const [expiryReview, setExpiryReview] = useState<{
    readonly requestedExpiry: number;
    readonly effectiveExpiry: number;
  } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const runtime = useRef<ManualSetupRuntime | null>(null);
  const operation = useRef(0);
  const copy = PHASE_COPY[state.phase];

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
          network: "testnet",
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
            setMasterAccount(saved.masterAccount);
            setRegistrationName(saved.registrationName);
            dispatch({ type: "HYDRATE", phase: "account" });
            return;
          case "protection":
            setMasterAccount(saved.masterAccount);
            setRegistrationName(saved.registrationName);
            dispatch({ type: "HYDRATE", phase: "protection" });
            return;
          case "authorization":
            setMasterAccount(saved.attempt.masterAccount);
            setRegistrationName(saved.attempt.registrationName);
            setAttempt(saved.attempt);
            dispatch({ type: "HYDRATE", phase: "authorization" });
            return;
          case "finalizing": {
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

  const saveMaster = async () => {
    setNotice(null);
    try {
      const setupRuntime = await requireRuntime();
      const saved = await setupRuntime.saveMasterAccount(
        masterAccount,
        registrationName,
      );
      setMasterAccount(saved.masterAccount);
      setRegistrationName(saved.registrationName);
      dispatch({ type: "MASTER_SAVED" });
    } catch (error) {
      setNotice(errorMessage(error));
    }
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
      await Linking.openURL(HYPERLIQUID_TESTNET_API_WALLET_URL);
    } catch {
      setNotice(
        "Hyperliquid could not be opened. Try again after checking your connection.",
      );
    }
  };

  const generateWallet = async () => {
    const generation = ++operation.current;
    setNotice(null);
    dispatch({ type: "START_PREPARE", generation });
    try {
      const setupRuntime = await requireRuntime();
      const prepared = await setupRuntime.prepare(
        masterAccount,
        registrationName,
      );
      if (generation !== operation.current) return;
      setAttempt(prepared);
      dispatch({ type: "PREPARED", generation });
    } catch (error) {
      dispatch({
        type: "FAIL",
        generation,
        reason: errorMessage(error),
        returnPhase: "protection",
      });
    }
  };

  const activateVerified = async (
    setupRuntime: ManualSetupRuntime,
    currentAttempt: SetupAttempt,
    result: SetupVerificationResult,
    generation: number,
  ) => {
    if (result.status === "expiry_confirmation_required") {
      setExpiryReview({
        requestedExpiry: result.requestedExpiry,
        effectiveExpiry: result.effectiveExpiry,
      });
      dispatch({
        type: "FAIL",
        generation,
        reason:
          "Hyperliquid registered a shorter expiry. Review it before activation.",
        returnPhase: "authorization",
      });
      return;
    }
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

  const verifyAuthorization = async () => {
    if (attempt === null) return;
    const generation = ++operation.current;
    setNotice(null);
    setExpiryReview(null);
    dispatch({ type: "START_VERIFY", generation });
    try {
      const setupRuntime = await requireRuntime();
      await activateVerified(
        setupRuntime,
        attempt,
        await setupRuntime.verify(attempt),
        generation,
      );
    } catch (error) {
      dispatch({
        type: "FAIL",
        generation,
        reason: errorMessage(error),
        returnPhase: "authorization",
      });
    }
  };

  const acceptShorterExpiry = async () => {
    if (attempt === null || expiryReview === null) return;
    const generation = ++operation.current;
    dispatch({ type: "START_VERIFY", generation });
    try {
      const setupRuntime = await requireRuntime();
      await activateVerified(
        setupRuntime,
        attempt,
        await setupRuntime.confirmShorterExpiry(
          attempt,
          expiryReview.effectiveExpiry,
        ),
        generation,
      );
    } catch (error) {
      dispatch({
        type: "FAIL",
        generation,
        reason: errorMessage(error),
        returnPhase: "authorization",
      });
    }
  };

  const duration = reducedMotion ? 0 : 160;
  const addressInvalid = notice?.includes("42-character Ethereum");
  const nameInvalid = notice?.includes("API wallet name");

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="gap-6 px-5"
      contentContainerStyle={{
        flexGrow: 1,
        paddingTop: Math.max(insets.top, 24),
        paddingBottom: Math.max(insets.bottom, 24),
      }}
      keyboardShouldPersistTaps="handled"
    >
      <View className="gap-2">
        <Text className="text-sm font-medium text-accent">
          Hyperliquid testnet
        </Text>
        <Text
          accessibilityRole="header"
          className="text-4xl font-semibold tracking-tight text-foreground"
        >
          Set up trading
        </Text>
        <Text className="text-base leading-6 text-muted">
          {stepLabel(state.phase)} · Progress is saved on this device.
        </Text>
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
              <View className="gap-4">
                <TextField isInvalid={addressInvalid} isRequired>
                  <Label>Master wallet address</Label>
                  <Input
                    autoCapitalize="none"
                    autoCorrect={false}
                    onChangeText={(value) => {
                      setMasterAccount(value);
                      setNotice(null);
                    }}
                    placeholder="0x…"
                    value={masterAccount}
                  />
                  <Description>
                    This public address is used for account data and
                    verification; never enter a seed phrase or private key.
                  </Description>
                  {addressInvalid ? <FieldError>{notice}</FieldError> : null}
                </TextField>

                <TextField isInvalid={nameInvalid} isRequired>
                  <Label>API wallet name</Label>
                  <Input
                    autoCorrect={false}
                    maxLength={16}
                    onChangeText={(value) => {
                      setRegistrationName(value);
                      setNotice(null);
                    }}
                    placeholder="Trading wallet"
                    value={registrationName}
                  />
                  <Description>
                    Choose a 1–16 character label. Verification uses the wallet
                    address, not this name.
                  </Description>
                  {nameInvalid ? <FieldError>{notice}</FieldError> : null}
                </TextField>
              </View>
            ) : null}

            {state.phase === "protection" ? (
              <View className="gap-3 rounded-2xl bg-surface-secondary p-4">
                <Text className="font-medium text-foreground">
                  Biometrics with passcode fallback
                </Text>
                <Text className="text-base leading-6 text-muted">
                  Face ID, fingerprint, or the device passcode offered by iOS or
                  Android protects access. Hyper Trader never stores that
                  passcode.
                </Text>
                <Text className="text-sm leading-5 text-muted">
                  A fresh API-wallet address is generated only after the system
                  prompt succeeds. The private key is never shown or copied.
                </Text>
                <Text className="text-sm leading-5 text-muted">
                  It will use your label: {registrationName}
                </Text>
              </View>
            ) : null}

            {state.phase === "authorization" && attempt !== null ? (
              <View className="gap-4">
                <View className="gap-2 rounded-2xl bg-surface-secondary p-4">
                  <Text className="text-sm font-medium text-muted">
                    API wallet address
                  </Text>
                  <Text selectable className="font-medium text-foreground">
                    {attempt.agentAddress}
                  </Text>
                  <Button
                    animation={reducedMotion ? "disable-all" : undefined}
                    className="mt-1 min-h-11 w-full"
                    onPress={() => {
                      void copyPublicValue(
                        attempt.agentAddress,
                        "API wallet address",
                      );
                    }}
                    variant="outline"
                  >
                    Copy wallet address
                  </Button>
                </View>

                <View className="gap-2 rounded-2xl bg-surface-secondary p-4">
                  <Text className="text-sm font-medium text-muted">
                    API wallet name
                  </Text>
                  <Text selectable className="font-medium text-foreground">
                    {attempt.registrationName}
                  </Text>
                  <Button
                    animation={reducedMotion ? "disable-all" : undefined}
                    className="mt-1 min-h-11 w-full"
                    onPress={() => {
                      void copyPublicValue(
                        attempt.registrationName,
                        "API wallet name",
                      );
                    }}
                    variant="outline"
                  >
                    Copy wallet name
                  </Button>
                </View>

                <Text className="text-sm leading-5 text-muted">
                  Connect {attempt.masterAccount} and add the exact API-wallet
                  address shown above. The name is only a label. In the
                  confirmation dialog, enter 30 in Days valid—do not leave it
                  blank.
                </Text>
              </View>
            ) : null}

            {state.phase === "failure" ? (
              <View className="gap-3">
                <Text
                  accessibilityRole="alert"
                  className="text-sm text-warning"
                >
                  {state.failureReason}
                </Text>
                {expiryReview !== null ? (
                  <View className="gap-1 rounded-2xl bg-surface-secondary p-4">
                    <Text className="text-sm text-muted">Requested expiry</Text>
                    <Text className="text-foreground">
                      {new Date(expiryReview.requestedExpiry).toLocaleString()}
                    </Text>
                    <Text className="mt-2 text-sm text-muted">
                      Verified expiry
                    </Text>
                    <Text className="text-foreground">
                      {new Date(expiryReview.effectiveExpiry).toLocaleString()}
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : null}

            {notice !== null && !addressInvalid && !nameInvalid ? (
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
              onPress={() => void saveMaster()}
              variant="primary"
            >
              Continue
            </Button>
          ) : null}

          {state.phase === "protection" ? (
            <Button
              animation={reducedMotion ? "disable-all" : undefined}
              className="min-h-12 w-full"
              isDisabled={state.readiness === "working"}
              onPress={() => void generateWallet()}
              variant="primary"
            >
              {state.readiness === "working"
                ? "Protecting wallet…"
                : "Protect & generate wallet"}
            </Button>
          ) : null}

          {state.phase === "authorization" && attempt !== null ? (
            <>
              <Button
                animation={reducedMotion ? "disable-all" : undefined}
                className="min-h-12 w-full"
                onPress={() => void openHyperliquid()}
                variant="primary"
              >
                Open Hyperliquid API
              </Button>
              <Button
                animation={reducedMotion ? "disable-all" : undefined}
                className="min-h-12 w-full"
                onPress={() => void verifyAuthorization()}
                variant="secondary"
              >
                I’ve added it — verify
              </Button>
            </>
          ) : null}

          {state.phase === "failure" && expiryReview !== null ? (
            <Button
              animation={reducedMotion ? "disable-all" : undefined}
              className="min-h-12 w-full"
              onPress={() => void acceptShorterExpiry()}
              variant="primary"
            >
              Accept verified expiry
            </Button>
          ) : null}

          {state.phase === "failure" ? (
            <Button
              animation={reducedMotion ? "disable-all" : undefined}
              className="min-h-12 w-full"
              onPress={() => {
                setExpiryReview(null);
                dispatch({ type: "RETRY" });
              }}
              variant={expiryReview === null ? "primary" : "secondary"}
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
  );
}
