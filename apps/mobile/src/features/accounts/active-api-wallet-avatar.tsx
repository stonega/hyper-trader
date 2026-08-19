import type { JSX } from "react";
import { useMemo } from "react";
import { View } from "react-native";

import { useTradingContext } from "../../core/context/provider";
import { resolveDirectoryAccount } from "./account-directory";
import { useAccountDirectory } from "./account-directory-provider";
import type { SavedAccount } from "./account-scope";
import { ApiWalletAvatar, shortenApiWalletAddress } from "./api-wallet-avatar";

function networkDisplayName(network: SavedAccount["network"]): string {
  return network === "testnet" ? "Testnet" : "Mainnet";
}

export function activeApiWalletLabel(account: SavedAccount | null): string {
  if (account === null || account.authorization.agentAddress === null) {
    return "No API wallet for the active account";
  }
  const address = account.authorization.agentAddress;
  const name = account.authorization.registrationName;
  return `Active API wallet, ${name === null ? "" : `${name}, `}${shortenApiWalletAddress(address)}, ${networkDisplayName(account.network)}`;
}

export function ActiveApiWalletAvatar(): JSX.Element {
  const directory = useAccountDirectory();
  const { current } = useTradingContext();
  const activeAccount = useMemo(
    () =>
      resolveDirectoryAccount(
        directory.accounts,
        directory.activeAccountId,
        current,
      ),
    [current, directory.accounts, directory.activeAccountId],
  );

  return (
    <View
      accessible
      accessibilityLabel={activeApiWalletLabel(activeAccount)}
      accessibilityRole="image"
      testID="active-api-wallet-avatar"
    >
      <ApiWalletAvatar
        address={activeAccount?.authorization.agentAddress ?? null}
      />
    </View>
  );
}
