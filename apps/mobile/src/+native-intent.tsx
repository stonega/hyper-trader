import { parseWalletReturn } from "./platform/wallet/callback";

export function redirectSystemPath({
  path,
}: {
  path: string;
  initial: boolean;
}) {
  const walletReturn = parseWalletReturn(path);
  if (walletReturn) {
    return `/setup/return?attemptId=${encodeURIComponent(walletReturn.attemptId)}&connectorSessionId=${encodeURIComponent(walletReturn.connectorSessionId)}`;
  }
  if (path.startsWith("hypertrader://wallet-return")) {
    return "/setup/return?invalid=1";
  }
  return path;
}
