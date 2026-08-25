import type { JSX } from "react";
import { View } from "react-native";

import { AppText as Text } from "../../components/app-text";
import {
  accountDisplayLabel,
  accountNetworkLabel,
} from "./account-presentation";
import { authorizationDisplayLabel, type SavedAccount } from "./account-scope";
import { ApiWalletAvatar, shortenWalletAddress } from "./api-wallet-avatar";

export function AccountDirectoryList({
  accounts,
  activeAccountId,
}: {
  readonly accounts: readonly SavedAccount[];
  readonly activeAccountId: string | null;
}): JSX.Element {
  return (
    <View className="gap-2" testID="settings-account-list">
      {accounts.map((account) => {
        const active = account.id === activeAccountId;
        const label = accountDisplayLabel(account);
        const address = shortenWalletAddress(account.target.address);
        const network = accountNetworkLabel(account.network);
        const authorization = authorizationDisplayLabel(account);
        return (
          <View
            accessible
            accessibilityLabel={`${label}, ${address}, ${network}, ${authorization}${active ? ", active account" : ""}`}
            className="min-h-20 flex-row items-center gap-3 rounded-2xl border border-border/70 bg-background/40 px-3 py-3"
            key={account.id}
            testID={`settings-account-${account.id}`}
          >
            <ApiWalletAvatar
              address={account.target.address}
              colorSeed={account.id}
            />
            <View className="min-w-0 flex-1 gap-0.5">
              <Text
                className="text-base font-semibold text-foreground"
                numberOfLines={1}
              >
                {label}
              </Text>
              <Text className="text-sm text-muted" numberOfLines={1}>
                {address} · {network}
              </Text>
              <Text
                className={
                  active ? "text-xs text-accent" : "text-xs text-muted"
                }
                numberOfLines={1}
              >
                {authorization}
              </Text>
            </View>
            {active ? (
              <Text className="rounded-lg bg-accent/10 px-2 py-1 text-xs font-semibold text-accent">
                Active
              </Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
