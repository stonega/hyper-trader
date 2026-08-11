import { useRouter } from "expo-router";
import { Button } from "heroui-native/button";
import { Dialog } from "heroui-native/dialog";
import type { JSX } from "react";
import { useMemo, useRef, useState } from "react";
import { ScrollView, View } from "react-native";

import { AppText as Text } from "../../components/app-text";
import { useReducedMotion } from "../../components/use-reduced-motion";
import { useTradingContext } from "../../core/context/provider";
import { useActionRuntime } from "../actions/runtime-provider";
import { resolveDirectoryAccount } from "./account-directory";
import { useAccountDirectory } from "./account-directory-provider";
import { accountGateMessage, accountMutationGate } from "./account-lifecycle";
import {
  addressSuffix,
  authorizationDisplayLabel,
  readOnlyTradingContextForSavedAccount,
  type SavedAccount,
  targetDisplayName,
} from "./account-scope";

export function GlobalAccountSwitcher(): JSX.Element {
  const reducedMotion = useReducedMotion();
  const router = useRouter();
  const directory = useAccountDirectory();
  const tradingContext = useTradingContext();
  const actionRuntime = useActionRuntime();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const switching = useRef(false);
  const active = useMemo(
    () =>
      resolveDirectoryAccount(
        directory.accounts,
        directory.activeAccountId,
        tradingContext.current,
      ),
    [directory.accounts, directory.activeAccountId, tradingContext.current],
  );

  const switchTo = async (account: SavedAccount) => {
    if (switching.current) return;
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
    if (active?.id === account.id) {
      setOpen(false);
      return;
    }
    switching.current = true;
    setMessage("Switching the exact account, target, and network…");
    try {
      const committed = await tradingContext.switchContext(
        readOnlyTradingContextForSavedAccount(account),
      );
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
    } finally {
      switching.current = false;
    }
  };

  const label = active
    ? `${active.label} · ${targetDisplayName(active.target)} · ${authorizationDisplayLabel(active)}`
    : directory.status === "loading"
      ? "Accounts · loading"
      : "Accounts · read only";

  return (
    <Dialog
      animation={reducedMotion ? "disable-all" : undefined}
      isOpen={open}
      onOpenChange={(next) => {
        if (switching.current && !next) return;
        setOpen(next);
        if (next) setMessage(null);
      }}
    >
      <Dialog.Trigger asChild>
        <Button
          accessibilityHint="Opens saved master accounts and exact account targets."
          accessibilityLabel={`Switch account. ${label}`}
          animation={reducedMotion ? "disable-all" : undefined}
          className="min-h-12 w-full"
          variant="tertiary"
        >
          {label}
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal unstable_accessibilityContainerViewIsModal>
        <Dialog.Overlay
          animation={reducedMotion ? false : undefined}
          isCloseOnPress={!switching.current}
        />
        <Dialog.Content
          animation={reducedMotion ? false : undefined}
          className="max-h-[80%] gap-4 bg-background"
          isSwipeable={!switching.current}
        >
          <Dialog.Close isDisabled={switching.current} variant="ghost" />
          <View className="gap-2 pr-10">
            <Dialog.Title>Account and target</Dialog.Title>
            <Dialog.Description>
              Switching cancels obsolete reads, invalidates incompatible drafts,
              locks the prior signer session, and keeps durable reconciliation
              in its original scope. A saved entry always opens read-only until
              the secure runtime verifies authority again.
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
          <ScrollView
            className="max-h-96"
            contentContainerClassName="gap-3"
            showsVerticalScrollIndicator={false}
          >
            {directory.accounts.map((account) => {
              const selected = active?.id === account.id;
              return (
                <Button
                  accessibilityHint={`${targetDisplayName(account.target)}, ${account.network}, API wallet ${account.authorization.registrationState}.`}
                  accessibilityLabel={`Use ${account.label}`}
                  accessibilityState={{ selected }}
                  animation={reducedMotion ? "disable-all" : undefined}
                  className="min-h-16 w-full justify-start"
                  isDisabled={switching.current}
                  key={account.id}
                  onPress={() => void switchTo(account)}
                  variant={selected ? "secondary" : "outline"}
                >
                  <Button.Label className="text-left">
                    {account.label} · {account.network}
                    {"\n"}
                    Master · …{addressSuffix(account.masterAccount)}
                    {"\n"}
                    {targetDisplayName(account.target)} · …
                    {addressSuffix(account.target.address)} ·{" "}
                    {authorizationDisplayLabel(account)} ·{" "}
                    {selected ? "active" : "available"}
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
          </ScrollView>
          <Button
            animation={reducedMotion ? "disable-all" : undefined}
            className="min-h-12 w-full"
            onPress={() => {
              setOpen(false);
              router.navigate("/(tabs)/settings");
            }}
            variant="secondary"
          >
            Manage accounts in Settings
          </Button>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  );
}
