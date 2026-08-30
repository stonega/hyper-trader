import { hasSignerAccessCapability } from "@hyper-trader/hyperliquid";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { Button } from "heroui-native/button";
import type { JSX } from "react";
import { useMemo, useState } from "react";
import { Linking, ScrollView, Share, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText as Text } from "../../components/app-text";
import { floatingTabBarInset } from "../../components/navigation/floating-tab-bar";
import { ScreenHeading } from "../../components/screen-heading";
import { useReducedMotion } from "../../components/use-reduced-motion";
import { useTradingContext } from "../../core/context/provider";
import { useSignerSession } from "../../core/session/provider";
import {
  resolveDirectoryAccount,
  resolveNetworkAccountSelection,
} from "../../features/accounts/account-directory";
import { AccountDirectoryList } from "../../features/accounts/account-directory-list";
import { useAccountDirectory } from "../../features/accounts/account-directory-provider";
import {
  accountGateMessage,
  accountMutationGate,
} from "../../features/accounts/account-lifecycle";
import { getManualSetupRuntime } from "../../features/accounts/manual-setup-runtime";
import { useActionRuntime } from "../../features/actions/runtime-provider";
import {
  buildRedactedDiagnosticExport,
  diagnosticExportJson,
} from "../../features/diagnostics/diagnostic-export";
import { NOTIFICATION_SETTINGS_AVAILABLE } from "../../features/notifications/availability";
import { useNotificationRuntime } from "../../features/notifications/provider";
import { AboutCard } from "../../features/settings/about-card";
import { useAppearancePreference } from "../../features/settings/appearance-provider";
import { useScopedTradingPreferences } from "../../features/settings/preferences-provider";
import { SettingsSection } from "../../features/settings/settings-section";

const API_WALLET_GUIDANCE_URL =
  "https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/nonces-and-api-wallets";

function shortAddress(address: string | null): string {
  return address === null ? "no account" : `…${address.slice(-6)}`;
}

interface SettingsMessage {
  readonly placement: "accounts" | "page";
  readonly text: string;
}

export default function SettingsScreen(): JSX.Element {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const tradingContext = useTradingContext();
  const { current } = tradingContext;
  const signerSession = useSignerSession();
  const actionRuntime = useActionRuntime();
  const directory = useAccountDirectory();
  const scopedPreferences = useScopedTradingPreferences();
  const appearance = useAppearancePreference();
  const notifications = useNotificationRuntime();
  const [message, setMessageState] = useState<SettingsMessage | null>(null);
  const setMessage = (
    text: string,
    placement: SettingsMessage["placement"] = "page",
  ) => setMessageState({ placement, text });
  const activeAccount = useMemo(
    () =>
      resolveDirectoryAccount(
        directory.accounts,
        directory.activeAccountId,
        current,
      ),
    [current, directory.accounts, directory.activeAccountId],
  );

  const reportGate = (operation: "add") => {
    const gate = accountMutationGate({
      operation,
      actionPhase: actionRuntime.flow.phase,
      actionStatus: { known: false },
      riskAcknowledged: false,
    });
    if (!gate.allowed) {
      setMessage(accountGateMessage(gate.reason));
      return false;
    }
    return true;
  };

  const switchNetwork = async (network: "mainnet" | "testnet") => {
    if (current.masterAccount !== null && activeAccount === null) {
      setMessage(
        "Repair the unrecognized active context before changing networks.",
      );
      return;
    }
    if (current.network === network && activeAccount !== null) {
      setMessage(
        `${network === "mainnet" ? "Mainnet" : "Testnet"} is already selected.`,
      );
      return;
    }
    const gate = accountMutationGate({
      operation: "switch",
      actionPhase: actionRuntime.flow.phase,
      actionStatus: { known: false },
      riskAcknowledged: false,
    });
    if (!gate.allowed) {
      setMessage(accountGateMessage(gate.reason));
      return;
    }
    const selection = resolveNetworkAccountSelection(
      directory.accounts,
      network,
    );
    if (selection.kind === "unique") {
      try {
        const nextContext = await (
          await getManualSetupRuntime()
        ).restoreTradingContext(selection.account);
        const committed = await tradingContext.switchContext(nextContext);
        if (!committed) {
          setMessage("A newer context change superseded this network request.");
          return;
        }
        const selected = await directory.select(selection.account.id);
        if (!selected) {
          setMessage(
            "The account was restored, but its active selection could not be persisted.",
          );
          return;
        }
        setMessage(
          `${network === "mainnet" ? "Mainnet" : "Testnet"} selected for ${shortAddress(selection.account.target.address)}.`,
        );
      } catch {
        setMessage(
          "The saved account could not be restored safely. Select it from the account switcher and try again.",
        );
      }
      return;
    }
    const committed = await tradingContext.switchContext({
      network,
      masterAccount: null,
      targetAccount: null,
      signer: null,
    });
    if (!committed) {
      setMessage("A newer context change superseded this network request.");
      return;
    }
    await directory.select(null);
    if (selection.kind === "ambiguous") {
      setMessage(
        `${network === "mainnet" ? "Mainnet" : "Testnet"} selected. Choose a saved account from the account switcher.`,
      );
      return;
    }
    setMessage(
      network === "mainnet"
        ? hasSignerAccessCapability("mainnet")
          ? "Mainnet selected. Add an exact mainnet authorization before trading."
          : "Mainnet public browsing selected. Trading remains disabled until release approval."
        : "Testnet selected. Add an exact authorization before trading.",
      "accounts",
    );
  };

  const shareDiagnostics = async () => {
    try {
      const bundle = buildRedactedDiagnosticExport({
        generatedAtMs: Date.now(),
        appVersion: Constants.expoConfig?.version ?? null,
        buildVersion: Constants.nativeBuildVersion ?? null,
        network: current.network,
        account:
          activeAccount === null
            ? null
            : {
                masterAccount: activeAccount.masterAccount,
                targetAccount: activeAccount.target.address,
                agentAddress: activeAccount.authorization.agentAddress,
                generation: activeAccount.authorization.generation,
                registrationState:
                  activeAccount.authorization.registrationState,
              },
        session: {
          status: signerSession.snapshot.status,
          reason:
            signerSession.snapshot.status === "locked"
              ? signerSession.snapshot.reason
              : null,
        },
        actions: [],
        notification: {
          tokenState:
            notifications.status === "error"
              ? "error"
              : notifications.snapshot === null
                ? "absent"
                : "registered",
          tokenSuffix: null,
        },
      });
      await Share.share({
        title: "Hyper Trader redacted diagnostics",
        message: diagnosticExportJson(bundle),
      });
      setMessage(
        "The system share sheet received a redacted diagnostic bundle.",
      );
    } catch {
      setMessage("A redacted diagnostic bundle could not be prepared.");
    }
  };

  const startAccountSetup = () => {
    if (!reportGate("add")) return;
    if (!hasSignerAccessCapability(current.network)) {
      setMessage(
        `${current.network === "mainnet" ? "Mainnet" : "Testnet"} API-wallet setup is disabled by the release capability policy.`,
      );
      return;
    }
    router.push("/setup");
  };

  const saveTradingPreference = async (
    patch: Parameters<typeof scopedPreferences.update>[0],
    label: string,
  ) => {
    const saved = await scopedPreferences.update(patch);
    setMessage(saved ? `${label} saved.` : `${label} could not be saved.`);
  };

  const resetTradingPreferences = async () => {
    const saved = await scopedPreferences.reset();
    setMessage(
      saved
        ? "Trading defaults reset."
        : "Trading defaults could not be reset.",
    );
  };

  const saveAppearance = async (
    preference: Parameters<typeof appearance.setPreference>[0],
  ) => {
    const saved = await appearance.setPreference(preference);
    setMessage(
      saved
        ? `Appearance now follows ${preference}.`
        : "Appearance could not be saved. The prior selection remains active.",
    );
  };

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="gap-6 px-5"
      contentContainerStyle={{
        paddingBottom: floatingTabBarInset(insets.bottom) + 16,
        paddingTop: Math.max(insets.top, 20),
      }}
      showsVerticalScrollIndicator={false}
    >
      <ScreenHeading
        title="Settings"
        description="Accounts, preferences, and support."
        network={current.network}
        accountLabel={shortAddress(current.targetAccount)}
        showContext={false}
      />

      {message?.placement === "page" ? (
        <Text
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          className="text-sm leading-5 text-warning"
        >
          {message.text}
        </Text>
      ) : null}

      <SettingsSection
        title="Accounts and API wallets"
        description="Saved accounts and their API-wallet status."
      >
        {message?.placement === "accounts" ? (
          <Text
            accessibilityLiveRegion="polite"
            accessibilityRole="alert"
            className="text-sm leading-5 text-warning"
          >
            {message.text}
          </Text>
        ) : null}
        {directory.status === "error" ? (
          <View className="gap-3">
            <Text accessibilityRole="alert" className="text-sm text-warning">
              {directory.message}
            </Text>
            <Button
              animation={reducedMotion ? "disable-all" : undefined}
              className="min-h-12 w-full"
              onPress={async () => {
                const ready = await directory.reload();
                setMessage(
                  ready
                    ? "Saved accounts were revalidated."
                    : "Saved accounts still cannot be loaded.",
                );
              }}
              variant="outline"
            >
              Retry saved accounts
            </Button>
          </View>
        ) : null}
        {directory.accounts.length > 0 ? (
          <AccountDirectoryList
            accounts={directory.accounts}
            activeAccountId={activeAccount?.id ?? null}
          />
        ) : directory.status === "loading" ? (
          <Text className="text-sm leading-5 text-muted">
            Loading saved accounts…
          </Text>
        ) : null}
        {directory.accounts.length === 0 ? (
          <Button
            accessibilityHint={`Opens ${current.network === "mainnet" ? "Mainnet" : "Testnet"} API-wallet setup.`}
            animation={reducedMotion ? "disable-all" : undefined}
            className="min-h-12 w-full"
            onPress={() => void startAccountSetup()}
            variant="secondary"
          >
            <Button.Label>Set up API wallet</Button.Label>
          </Button>
        ) : (
          <Button
            animation={reducedMotion ? "disable-all" : undefined}
            className="min-h-12 w-full"
            onPress={() => void startAccountSetup()}
            variant="secondary"
          >
            Add account
          </Button>
        )}
      </SettingsSection>

      <SettingsSection title="Network" description="Choose the network.">
        <Text className="text-sm leading-5 text-muted">
          Current context · {current.network} ·{" "}
          {shortAddress(current.targetAccount)}
        </Text>
        <View className="flex-row flex-wrap gap-2">
          <Button
            accessibilityState={{ selected: current.network === "mainnet" }}
            animation={reducedMotion ? "disable-all" : undefined}
            className="min-h-12 flex-1"
            isDisabled={directory.status === "loading"}
            onPress={() => void switchNetwork("mainnet")}
            variant={current.network === "mainnet" ? "secondary" : "outline"}
          >
            Mainnet
          </Button>
          <Button
            accessibilityState={{ selected: current.network === "testnet" }}
            animation={reducedMotion ? "disable-all" : undefined}
            className="min-h-12 flex-1"
            isDisabled={directory.status === "loading"}
            onPress={() => void switchNetwork("testnet")}
            variant={current.network === "testnet" ? "secondary" : "outline"}
          >
            Testnet
          </Button>
        </View>
      </SettingsSection>

      <SettingsSection
        title="Trading preferences"
        description="Order defaults for this account."
      >
        {scopedPreferences.account === null ? (
          <Text className="text-sm leading-5 text-muted">
            Select a saved account to edit its order defaults.
          </Text>
        ) : (
          <>
            {scopedPreferences.status === "error" ? (
              <Text accessibilityRole="alert" className="text-sm text-warning">
                Preferences could not be loaded. Choose a value to try again.
              </Text>
            ) : null}
            <Text className="text-sm font-medium text-foreground">
              Default order type
            </Text>
            <View className="flex-row gap-2">
              {(["market", "limit"] as const).map((value) => (
                <Button
                  accessibilityState={{
                    selected:
                      scopedPreferences.preferences.defaultOrderType === value,
                  }}
                  animation={reducedMotion ? "disable-all" : undefined}
                  className="min-h-12 flex-1"
                  isDisabled={scopedPreferences.status === "loading"}
                  key={value}
                  onPress={() =>
                    void saveTradingPreference(
                      { defaultOrderType: value },
                      "Default order type",
                    )
                  }
                  variant={
                    scopedPreferences.preferences.defaultOrderType === value
                      ? "secondary"
                      : "outline"
                  }
                >
                  {value === "market" ? "Market" : "Limit"}
                </Button>
              ))}
            </View>
            <Text className="text-sm font-medium text-foreground">
              Market-order slippage
            </Text>
            <View className="flex-row flex-wrap gap-2">
              {[10, 25, 50, 100].map((value) => (
                <Button
                  accessibilityLabel={`${value / 100} percent default slippage`}
                  accessibilityState={{
                    selected:
                      scopedPreferences.preferences.defaultSlippageBps ===
                      value,
                  }}
                  animation={reducedMotion ? "disable-all" : undefined}
                  className="min-h-12 min-w-20 flex-1"
                  isDisabled={scopedPreferences.status === "loading"}
                  key={value}
                  onPress={() =>
                    void saveTradingPreference(
                      { defaultSlippageBps: value },
                      "Default slippage",
                    )
                  }
                  variant={
                    scopedPreferences.preferences.defaultSlippageBps === value
                      ? "secondary"
                      : "outline"
                  }
                >
                  {value / 100}%
                </Button>
              ))}
            </View>
            <Button
              animation={reducedMotion ? "disable-all" : undefined}
              className="min-h-12 w-full"
              isDisabled={scopedPreferences.status === "loading"}
              onPress={() => void resetTradingPreferences()}
              variant="ghost"
            >
              Reset scoped defaults
            </Button>
          </>
        )}
      </SettingsSection>

      {NOTIFICATION_SETTINGS_AVAILABLE ? (
        <SettingsSection
          title="Notifications"
          description="Manage price alerts."
        >
          <Button
            animation={reducedMotion ? "disable-all" : undefined}
            className="min-h-12 w-full"
            onPress={() => router.push("/notification-settings")}
            variant="secondary"
          >
            Manage notifications
          </Button>
        </SettingsSection>
      ) : null}

      <SettingsSection
        title="Appearance"
        description="Choose how Hyper Trader looks on this device."
      >
        {appearance.status === "error" ? (
          <Text accessibilityRole="alert" className="text-sm text-warning">
            Appearance could not be saved. System appearance is active.
          </Text>
        ) : null}
        <View className="flex-row flex-wrap gap-2">
          {(["system", "light", "dark"] as const).map((preference) => (
            <Button
              accessibilityState={{
                selected: appearance.preference === preference,
              }}
              animation={reducedMotion ? "disable-all" : undefined}
              className="min-h-12 min-w-24 flex-1"
              isDisabled={appearance.status === "loading"}
              key={preference}
              onPress={() => void saveAppearance(preference)}
              variant={
                appearance.preference === preference ? "secondary" : "outline"
              }
            >
              {preference[0]?.toUpperCase()}
              {preference.slice(1)}
            </Button>
          ))}
        </View>
      </SettingsSection>

      <SettingsSection
        title="Help and privacy"
        description="Private keys are never included in logs or support reports."
      >
        <Button
          animation={reducedMotion ? "disable-all" : undefined}
          className="min-h-12 w-full"
          onPress={() => void shareDiagnostics()}
          variant="secondary"
        >
          Share diagnostics
        </Button>
        <Button
          animation={reducedMotion ? "disable-all" : undefined}
          className="min-h-12 w-full"
          onPress={() => void Linking.openURL(API_WALLET_GUIDANCE_URL)}
          variant="outline"
        >
          API-wallet help
        </Button>
        <Text className="text-sm leading-5 text-muted">
          Trading can cause losses. Always review an order before confirming.
        </Text>
      </SettingsSection>

      <AboutCard />
    </ScrollView>
  );
}
