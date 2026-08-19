import type { JSX } from "react";
import { useEffect, useMemo, useRef } from "react";

import { useTradingContext } from "../../core/context/provider";
import { useAccountDirectory } from "./account-directory-provider";
import { accountAuthorizationKey, type SavedAccount } from "./account-scope";
import { getManualSetupRuntime } from "./manual-setup-runtime";

function selectedAccount(
  accounts: readonly SavedAccount[],
  activeAccountId: string | null,
): SavedAccount | null {
  if (activeAccountId === null) return null;
  return accounts.find((account) => account.id === activeAccountId) ?? null;
}

export function ActiveAccountContextRestorer(): JSX.Element | null {
  const directory = useAccountDirectory();
  const tradingContext = useTradingContext();
  const attempted = useRef<string | null>(null);
  const account = useMemo(
    () => selectedAccount(directory.accounts, directory.activeAccountId),
    [directory.accounts, directory.activeAccountId],
  );

  useEffect(() => {
    if (directory.status !== "ready" || account === null) return;
    const current = tradingContext.current;
    const currentIsReadOnly =
      current.masterAccount === null && current.targetAccount === null;
    const currentMatchesAccount =
      current.network === account.network &&
      current.masterAccount === account.masterAccount &&
      current.targetAccount === account.target.address;
    if (!currentIsReadOnly && !currentMatchesAccount) return;

    const expectedAgent = account.authorization.agentAddress;
    const expectedGeneration = account.authorization.generation;
    if (
      currentMatchesAccount &&
      current.signer?.agentAddress === expectedAgent &&
      current.signer?.generation === expectedGeneration
    ) {
      return;
    }

    const attemptKey = `${account.id}:${accountAuthorizationKey(account)}`;
    if (attempted.current === attemptKey) return;
    attempted.current = attemptKey;
    const capture = tradingContext.capture();
    let cancelled = false;
    void getManualSetupRuntime()
      .then((runtime) => runtime.restoreTradingContext(account))
      .then(async (next) => {
        if (cancelled || !tradingContext.canCommit(capture)) return;
        await tradingContext.switchContext(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [account, directory.status, tradingContext]);

  return null;
}
