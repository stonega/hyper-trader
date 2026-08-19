import { useRouter } from "expo-router";
import { Button } from "heroui-native/button";
import { Dialog } from "heroui-native/dialog";
import type { JSX } from "react";
import { useMemo, useRef, useState } from "react";
import { ScrollView, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/app-text";
import { useReducedMotion } from "../../components/use-reduced-motion";
import { useTradingContext } from "../../core/context/provider";
import { useActionRuntime } from "../actions/runtime-provider";
import { resolveDirectoryAccount } from "./account-directory";
import { useAccountDirectory } from "./account-directory-provider";
import { accountGateMessage, accountMutationGate } from "./account-lifecycle";
import {
  accountDisplayLabel,
  accountNetworkLabel,
} from "./account-presentation";
import {
  readOnlyTradingContextForSavedAccount,
  type SavedAccount,
} from "./account-scope";
import { ApiWalletAvatar, shortenWalletAddress } from "./api-wallet-avatar";
import { accountSwitcherDialogLayout } from "./global-account-switcher-layout";
import { getManualSetupRuntime } from "./manual-setup-runtime";

function triggerAvatarAccount(
  accounts: readonly SavedAccount[],
  activeAccountId: string | null,
  active: SavedAccount | null,
): SavedAccount | null {
  if (active !== null) return active;
  if (activeAccountId !== null) {
    return accounts.find((account) => account.id === activeAccountId) ?? null;
  }
  return accounts.length === 1 ? (accounts[0] ?? null) : null;
}

export function GlobalAccountSwitcher({
  avatarOnly = false,
  compact = false,
}: {
  readonly avatarOnly?: boolean;
  readonly compact?: boolean;
}): JSX.Element {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const router = useRouter();
  const directory = useAccountDirectory();
  const tradingContext = useTradingContext();
  const actionRuntime = useActionRuntime();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const switchingRef = useRef(false);
  const [switching, setSwitching] = useState(false);
  const active = useMemo(
    () =>
      resolveDirectoryAccount(
        directory.accounts,
        directory.activeAccountId,
        tradingContext.current,
      ),
    [directory.accounts, directory.activeAccountId, tradingContext.current],
  );
  const avatarAccount = triggerAvatarAccount(
    directory.accounts,
    directory.activeAccountId,
    active,
  );

  const switchTo = async (account: SavedAccount) => {
    if (switchingRef.current) return;
    if (tradingContext.current.masterAccount !== null && active === null) {
      setMessage(
        "The active context is not in the validated account directory. Repair it in Settings before switching.",
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
    const signerMatches =
      tradingContext.current.signer?.agentAddress ===
        account.authorization.agentAddress &&
      tradingContext.current.signer?.generation ===
        account.authorization.generation;
    if (
      active?.id === account.id &&
      (account.network === "mainnet" || signerMatches)
    ) {
      setOpen(false);
      return;
    }
    switchingRef.current = true;
    setSwitching(true);
    setMessage("Switching the exact account, target, and network…");
    try {
      const nextContext =
        account.network === "testnet"
          ? await (await getManualSetupRuntime()).restoreTradingContext(account)
          : readOnlyTradingContextForSavedAccount(account);
      const committed = await tradingContext.switchContext(nextContext);
      if (!committed) {
        setMessage("A newer context switch superseded this request.");
        return;
      }
      const saved = await directory.select(account.id);
      if (!saved) {
        setMessage(
          "The account switched safely, but active selection could not be persisted.",
        );
        return;
      }
      setMessage(null);
      setOpen(false);
    } catch {
      setMessage(
        "The account switch could not be completed safely. Verify the active account, then try again.",
      );
    } finally {
      switchingRef.current = false;
      setSwitching(false);
    }
  };

  const primaryLabel = active
    ? `${accountDisplayLabel(active)} · ${shortenWalletAddress(active.target.address)}`
    : directory.status === "loading"
      ? "Loading accounts…"
      : "Choose an account";
  const secondaryLabel = active
    ? accountNetworkLabel(active.network)
    : "Read only";
  const label = `${primaryLabel}. ${secondaryLabel}`;
  const visibleLabel = compact
    ? primaryLabel
    : `${primaryLabel}\n${secondaryLabel}`;
  const dialogLayout = accountSwitcherDialogLayout({
    height,
    insetBottom: insets.bottom,
    insetLeft: insets.left,
    insetRight: insets.right,
    insetTop: insets.top,
  });

  return (
    <Dialog
      animation={reducedMotion ? "disable-all" : undefined}
      isOpen={open}
      onOpenChange={(next) => {
        if (switchingRef.current && !next) return;
        setOpen(next);
        if (next) setMessage(null);
      }}
    >
      <Dialog.Trigger asChild>
        <Button
          accessibilityHint="Opens your saved accounts."
          accessibilityLabel={`Switch account. ${label}`}
          animation={reducedMotion ? "disable-all" : undefined}
          className={
            avatarOnly
              ? "h-12 min-h-12 w-12 min-w-12 overflow-hidden rounded-2xl p-0"
              : compact
                ? "min-h-12 min-w-0 flex-1 px-3"
                : "min-h-16 w-full"
          }
          isIconOnly={avatarOnly}
          onPress={() => setOpen(true)}
          variant={avatarOnly ? "ghost" : "tertiary"}
        >
          {avatarOnly ? (
            <ApiWalletAvatar
              address={avatarAccount?.authorization.agentAddress ?? null}
            />
          ) : (
            <Button.Label
              adjustsFontSizeToFit={compact}
              className="text-left"
              numberOfLines={compact ? 1 : 2}
            >
              {visibleLabel}
            </Button.Label>
          )}
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal
        style={{
          paddingBottom: dialogLayout.paddingBottom,
          paddingLeft: dialogLayout.paddingLeft,
          paddingRight: dialogLayout.paddingRight,
          paddingTop: dialogLayout.paddingTop,
        }}
        unstable_accessibilityContainerViewIsModal
      >
        <Dialog.Overlay
          animation={reducedMotion ? false : undefined}
          isCloseOnPress={!switching}
        />
        <Dialog.Content
          animation={reducedMotion ? false : undefined}
          className="bg-background"
          isSwipeable={!switching}
          style={{
            maxHeight: dialogLayout.maxHeight,
            overflow: "hidden",
            padding: 0,
          }}
        >
          <Dialog.Close
            className="absolute right-3 top-3 z-10"
            isDisabled={switching}
            testID="account-switcher-close"
            variant="ghost"
          />
          <ScrollView
            contentContainerClassName="gap-4 p-5"
            showsVerticalScrollIndicator={false}
            style={{ flexShrink: 1, maxHeight: dialogLayout.maxHeight }}
            testID="account-switcher-scroll"
          >
            <View className="relative gap-2 pr-12">
              <Dialog.Title>Accounts</Dialog.Title>
              <Dialog.Description>
                Choose the account used for balances and trades.
              </Dialog.Description>
            </View>
            {message ? (
              <Text
                accessibilityLiveRegion="polite"
                accessibilityRole="alert"
                className="text-sm leading-5 text-warning"
              >
                {message}
              </Text>
            ) : null}
            <View className="gap-3">
              {directory.accounts.map((account) => {
                const selected = active?.id === account.id;
                const address = shortenWalletAddress(account.target.address);
                const accountLabel = accountDisplayLabel(account);
                const network = accountNetworkLabel(account.network);
                return (
                  <Button
                    accessibilityHint={`Switches balances and trades to this ${network} account.`}
                    accessibilityLabel={`Use ${accountLabel}, ${address}, ${network}`}
                    accessibilityState={{ selected }}
                    animation={reducedMotion ? "disable-all" : undefined}
                    className="min-h-20 w-full justify-start gap-3 px-3 py-3"
                    isDisabled={switching}
                    key={account.id}
                    onPress={() => void switchTo(account)}
                    testID={`account-switcher-item-${account.id}`}
                    variant={selected ? "secondary" : "outline"}
                  >
                    <ApiWalletAvatar
                      address={account.authorization.agentAddress}
                    />
                    <Button.Label
                      className="min-w-0 flex-1 text-left"
                      numberOfLines={2}
                    >
                      {accountLabel}
                      {"\n"}
                      {address} · {network}
                    </Button.Label>
                  </Button>
                );
              })}
              {directory.accounts.length === 0 ? (
                <Text className="text-sm leading-5 text-muted">
                  No validated saved accounts are available. Trading remains
                  read-only.
                </Text>
              ) : null}
            </View>
            <Button
              animation={reducedMotion ? "disable-all" : undefined}
              className="min-h-12 w-full"
              isDisabled={switching}
              onPress={() => {
                setOpen(false);
                router.navigate("/(tabs)/settings");
              }}
              variant="secondary"
            >
              Manage accounts
            </Button>
          </ScrollView>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  );
}
