import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { Button } from "heroui-native/button";
import type { JSX } from "react";
import { useMemo, useState } from "react";
import { Linking, ScrollView, Share, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ScreenHeading } from "../../components/screen-heading";
import { SetupResumeCard } from "../../components/setup-resume-card";
import { useReducedMotion } from "../../components/use-reduced-motion";
import { useTradingContext } from "../../core/context/provider";
import { SIGNER_SESSION_DURATION_MS } from "../../core/session/manager";
import { useSignerSession } from "../../core/session/provider";
import { resolveDirectoryAccount } from "../../features/accounts/account-directory";
import { useAccountDirectory } from "../../features/accounts/account-directory-provider";
import {
  accountGateMessage,
  accountMutationGate,
} from "../../features/accounts/account-lifecycle";
import {
  addressSuffix,
  authorizationDisplayLabel,
  readOnlyTradingContextForSavedAccount,
  type SavedAccount,
  targetDisplayName,
} from "../../features/accounts/account-scope";
import { GlobalAccountSwitcher } from "../../features/accounts/global-account-switcher";
import { useActionRuntime } from "../../features/actions/runtime-provider";
import {
  buildRedactedDiagnosticExport,
  diagnosticExportJson,
} from "../../features/diagnostics/diagnostic-export";
import { useNotificationRuntime } from "../../features/notifications/provider";
import { useOnboardingPreference } from "../../features/onboarding/provider";
import { useDeviceAuthStatus } from "../../features/security/device-auth-status";
import { sessionStatusText } from "../../features/security/session-presentation";
import { useAppearancePreference } from "../../features/settings/appearance-provider";
import { useScopedTradingPreferences } from "../../features/settings/preferences-provider";
import { SettingsSection } from "../../features/settings/settings-section";

const API_WALLET_GUIDANCE_URL =
  "https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/nonces-and-api-wallets";
const SESSION_DURATION_MINUTES = SIGNER_SESSION_DURATION_MS / 60_000;

function shortAddress(address: string | null): string {
  return address === null ? "no account" : `…${address.slice(-6)}`;
}

function formatTime(value: number | null): string {
  if (value === null) return "Not available";
  return new Date(value).toLocaleString();
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
  const onboarding = useOnboardingPreference();
  const notifications = useNotificationRuntime();
  const deviceAuth = useDeviceAuthStatus();
  const [message, setMessage] = useState<string | null>(null);
  const activeAccount = useMemo(
    () =>
      resolveDirectoryAccount(
        directory.accounts,
        directory.activeAccountId,
        current,
      ),
    [current, directory.accounts, directory.activeAccountId],
  );

  const reportGate = (operation: "add" | "revoke_external") => {
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

  const switchPublicNetwork = async (network: "mainnet" | "testnet") => {
    if (current.masterAccount !== null && activeAccount === null) {
      setMessage(
        "Repair the unrecognized active context before changing networks.",
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
    setMessage(
      network === "mainnet"
        ? "Mainnet public browsing selected. Signing and exchange submission remain locally disabled."
        : "Testnet read-only browsing selected. Add an exact authorization before trading.",
    );
  };

  const switchSavedAccount = async (account: SavedAccount) => {
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
    const committed = await tradingContext.switchContext(
      readOnlyTradingContextForSavedAccount(account),
    );
    if (!committed) {
      setMessage("A newer context change superseded this account request.");
      return;
    }
    const persisted = await directory.select(account.id);
    setMessage(
      persisted
        ? `${account.label} is now active for ${targetDisplayName(account.target).toLowerCase()} ${shortAddress(account.target.address)} in read-only mode. Fresh secure-runtime verification is required before signing.`
        : "The account changed safely, but active selection could not be persisted.",
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

  const startAccountSetup = async () => {
    if (!reportGate("add")) return;
    const saved = await onboarding.requestSetup();
    if (!saved) {
      setMessage(
        "Setup intent could not be saved. No wallet handoff was started.",
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
    setMessage(
      saved
        ? `${label} was saved for this exact account, target, and network.`
        : `${label} could not be saved. The prior scoped default is unchanged.`,
    );
  };

  const resetTradingPreferences = async () => {
    const saved = await scopedPreferences.reset();
    setMessage(
      saved
        ? "Trading defaults were reset for this exact account, target, and network."
        : "Trading defaults could not be reset. The prior scoped record is unchanged.",
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
      contentContainerClassName="gap-6 px-5 pb-12"
      contentContainerStyle={{ paddingTop: Math.max(insets.top, 20) }}
      showsVerticalScrollIndicator={false}
    >
      <ScreenHeading
        title="Settings"
        description="Manage exact account targets, security posture, safe defaults, privacy, and support without bypassing action review."
        network={current.network}
        accountLabel={`${shortAddress(current.targetAccount)}${current.signer === null ? " · read only" : ""}`}
      />

      {message ? (
        <Text
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          className="text-sm leading-5 text-warning"
        >
          {message}
        </Text>
      ) : null}

      <SettingsSection
        title="Accounts and API wallets"
        description="Every saved master, target, network, authorization generation, preference record, cache, and pending action remains separately scoped. Saved authorization summaries are display-only and can never restore a signer. Secret key material is never displayed."
      >
        <GlobalAccountSwitcher />
        <Text className="text-sm leading-5 text-muted">
          Saved reconciliation counts are display-only. Rotation, repair, and
          unlink remain unavailable until an authoritative action-journal
          adapter is connected.
        </Text>
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
                    : "Saved accounts still cannot be validated. Trading remains read-only.",
                );
              }}
              variant="outline"
            >
              Retry saved accounts
            </Button>
          </View>
        ) : null}
        {directory.accounts.map((account) => {
          const selected = activeAccount?.id === account.id;
          const authorization = account.authorization;
          return (
            <View
              accessibilityLabel={`${account.label}, ${account.network}, ${targetDisplayName(account.target)}, API wallet ${authorization.registrationState}`}
              className="gap-3 rounded-2xl bg-surface-secondary p-4"
              key={account.id}
            >
              <Text className="text-base font-semibold text-foreground">
                {account.label} · {selected ? "Active" : "Saved"}
              </Text>
              <Text className="text-sm leading-5 text-muted">
                {account.network} · Master …
                {addressSuffix(account.masterAccount)}
                {"\n"}
                {targetDisplayName(account.target)} · …
                {addressSuffix(account.target.address)} ·{" "}
                {authorizationDisplayLabel(account)}
              </Text>
              <Text className="text-sm leading-5 text-muted">
                API wallet · {authorization.registrationState} · local
                credential {authorization.credentialState}
                {"\n"}
                Agent{" "}
                {authorization.agentAddress
                  ? `…${addressSuffix(authorization.agentAddress)}`
                  : "not stored"}{" "}
                · generation {authorization.generation ?? "none"}
                {"\n"}
                Expires {formatTime(authorization.effectiveExpiryMs)}
                {"\n"}
                Last authoritative verification{" "}
                {formatTime(authorization.lastVerifiedAtMs)}
                {"\n"}
                Pending reconciliation {account.reconciliation.pendingCount} ·{" "}
                {account.reconciliation.allDurable
                  ? "all durable"
                  : "durability pending"}
              </Text>
              {!selected ? (
                <Button
                  animation={reducedMotion ? "disable-all" : undefined}
                  className="min-h-12 w-full"
                  onPress={() => void switchSavedAccount(account)}
                  variant="secondary"
                >
                  Use this exact target
                </Button>
              ) : null}
              <View className="flex-row flex-wrap gap-2">
                <Button
                  animation={reducedMotion ? "disable-all" : undefined}
                  accessibilityHint="Unavailable until authoritative pending-action status is connected."
                  className="min-h-12 flex-1"
                  isDisabled
                  variant="outline"
                >
                  Rotate or repair unavailable
                </Button>
                <Button
                  animation={reducedMotion ? "disable-all" : undefined}
                  className="min-h-12 flex-1"
                  isDisabled={!selected}
                  onPress={() => {
                    if (!reportGate("revoke_external")) return;
                    void Linking.openURL(API_WALLET_GUIDANCE_URL);
                  }}
                  variant="outline"
                >
                  Open external revoke guidance
                </Button>
              </View>
              <Button
                animation={reducedMotion ? "disable-all" : undefined}
                accessibilityHint="Unavailable until authoritative pending-action status and cleanup adapters are connected."
                className="min-h-12 w-full"
                isDisabled
                variant="danger-soft"
              >
                Unlink unavailable
              </Button>
            </View>
          );
        })}
        {directory.accounts.length === 0 ? (
          <SetupResumeCard />
        ) : (
          <Button
            animation={reducedMotion ? "disable-all" : undefined}
            className="min-h-12 w-full"
            isDisabled={onboarding.status === "loading"}
            onPress={() => void startAccountSetup()}
            variant="secondary"
          >
            Add account or exact target
          </Button>
        )}
      </SettingsSection>

      <SettingsSection
        title="Security"
        description={`Device authentication unlocks one exact signer for a non-sliding ${SESSION_DURATION_MINUTES}-minute in-memory session. Every action still requires review.`}
      >
        <Text className="text-sm leading-5 text-muted">
          Session · {sessionStatusText(signerSession.snapshot)}
          {"\n"}
          Device authentication · {deviceAuth.message}
          {"\n"}
          Methods · {deviceAuth.methods.join(", ") || "None verified"}
          {"\n"}
          Timeout · {SESSION_DURATION_MINUTES} minutes, fixed by the reviewed
          custody policy
        </Text>
        <Button
          animation={reducedMotion ? "disable-all" : undefined}
          className="min-h-12 w-full"
          onPress={() => {
            signerSession.lock("manual");
            setMessage("The in-memory signing session is locked.");
          }}
          variant="secondary"
        >
          Lock trading session now
        </Button>
      </SettingsSection>

      <SettingsSection
        title="Network"
        description="Mainnet is public read-only in this build. No setting, remote response, restored state, or notification can enable mainnet signing or submission."
      >
        <Text className="text-sm leading-5 text-muted">
          Current context · {current.network} ·{" "}
          {shortAddress(current.targetAccount)}
        </Text>
        <View className="flex-row flex-wrap gap-2">
          <Button
            accessibilityState={{ selected: current.network === "testnet" }}
            animation={reducedMotion ? "disable-all" : undefined}
            className="min-h-12 flex-1"
            onPress={() => void switchPublicNetwork("testnet")}
            variant={current.network === "testnet" ? "secondary" : "outline"}
          >
            Testnet browsing
          </Button>
          <Button
            accessibilityState={{ selected: current.network === "mainnet" }}
            animation={reducedMotion ? "disable-all" : undefined}
            className="min-h-12 flex-1"
            onPress={() => void switchPublicNetwork("mainnet")}
            variant={current.network === "mainnet" ? "secondary" : "outline"}
          >
            Mainnet read-only
          </Button>
        </View>
      </SettingsSection>

      <SettingsSection
        title="Trading preferences"
        description="Defaults apply only to this exact account, target, and network. They never skip review or replace current market, precision, balance, leverage, margin, or slippage validation."
      >
        {scopedPreferences.account === null ? (
          <Text className="text-sm leading-5 text-muted">
            Select a validated saved account target to edit scoped defaults.
          </Text>
        ) : (
          <>
            {scopedPreferences.status === "error" ? (
              <Text accessibilityRole="alert" className="text-sm text-warning">
                Scoped preference storage is unavailable. You may retry by
                selecting a value or reset.
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
                  accessibilityLabel={`${value} basis points default slippage`}
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
                  {value} bps
                </Button>
              ))}
            </View>
            <Text className="text-sm font-medium text-foreground">
              Portfolio chart range
            </Text>
            <View className="flex-row flex-wrap gap-2">
              {(["24h", "7d", "30d", "all"] as const).map((value) => (
                <Button
                  accessibilityState={{
                    selected:
                      scopedPreferences.preferences.defaultChartRange === value,
                  }}
                  animation={reducedMotion ? "disable-all" : undefined}
                  className="min-h-12 min-w-16 flex-1"
                  isDisabled={scopedPreferences.status === "loading"}
                  key={value}
                  onPress={() =>
                    void saveTradingPreference(
                      { defaultChartRange: value },
                      "Portfolio chart range",
                    )
                  }
                  variant={
                    scopedPreferences.preferences.defaultChartRange === value
                      ? "secondary"
                      : "outline"
                  }
                >
                  {value === "all" ? "All" : value}
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

      <SettingsSection
        title="Notifications"
        description="Manage contextual permission, device-token delivery, price alerts, proof-bound account alerts, and verified server deletion."
      >
        <Text className="text-sm leading-5 text-muted">
          Permission is requested only after you add an alert. Notification taps
          open an opaque record, then refresh authoritative Hyperliquid state.
        </Text>
        <Button
          animation={reducedMotion ? "disable-all" : undefined}
          className="min-h-12 w-full"
          onPress={() => router.push("/notification-settings")}
          variant="secondary"
        >
          Manage notifications
        </Button>
      </SettingsSection>

      <SettingsSection
        title="Appearance"
        description="Appearance is device-global and does not affect account, authorization, action, or network state."
      >
        {appearance.status === "error" ? (
          <Text accessibilityRole="alert" className="text-sm text-warning">
            Appearance storage is unavailable. The system appearance remains
            active unless a retry succeeds.
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
        title="Privacy"
        description="The app does not place secrets, signatures, complete signed actions, full push tokens, or signed payloads in diagnostics, logs, analytics, notifications, or support bundles."
      >
        <Text className="text-sm leading-5 text-muted">
          Public address suffixes, secret-free correlation IDs, intent digests,
          state labels, and timestamps are the maximum diagnostic detail exposed
          here.
        </Text>
      </SettingsSection>

      <SettingsSection
        title="Diagnostics"
        description="Create a bounded, structurally allowlisted local report. The report contains no credential value or signing material."
      >
        <Button
          animation={reducedMotion ? "disable-all" : undefined}
          className="min-h-12 w-full"
          onPress={() => void shareDiagnostics()}
          variant="secondary"
        >
          Share redacted diagnostics
        </Button>
      </SettingsSection>

      <SettingsSection
        title="Support"
        description="For account access problems, keep the local session locked and use an independently trusted Hyperliquid or wallet interface to inspect or replace the named API wallet."
      >
        <Button
          animation={reducedMotion ? "disable-all" : undefined}
          className="min-h-12 w-full"
          onPress={() => void Linking.openURL(API_WALLET_GUIDANCE_URL)}
          variant="outline"
        >
          Open API-wallet guidance
        </Button>
      </SettingsSection>

      <SettingsSection
        title="Legal and risk"
        description="Trading involves loss, liquidation, market, protocol, device, and connectivity risk. Cached or delayed data can be stale. Hyper Trader does not custody your master key and cannot reverse exchange actions."
      >
        <Text className="text-sm leading-5 text-muted">
          Mainnet trading is not enabled. Testnet behavior is not evidence that
          a future mainnet release is safe. Always verify the active network,
          master, exact target, market, size, price behavior, leverage, margin
          mode, reduce-only state, fees, and slippage at review.
        </Text>
      </SettingsSection>
    </ScrollView>
  );
}
