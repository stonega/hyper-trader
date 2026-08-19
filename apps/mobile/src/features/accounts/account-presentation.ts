import type { SavedAccount } from "./account-scope";

export function accountNetworkLabel(network: SavedAccount["network"]): string {
  return network === "testnet" ? "Testnet" : "Mainnet";
}

export function accountDisplayLabel(account: SavedAccount): string {
  const generatedLabel = `Hyperliquid · …${account.masterAccount.slice(-6)}`;
  return account.label === generatedLabel ? "Hyperliquid" : account.label;
}
