import { parseNotificationSystemPath } from "./features/notifications/intent";
import { parseWalletReturn } from "./platform/wallet/callback";

export function redirectSystemPath({
  path,
}: {
  path: string;
  initial: boolean;
}) {
  const notificationPath = parseNotificationSystemPath(path);
  if (notificationPath) return notificationPath;
  const walletReturn = parseWalletReturn(path);
  if (walletReturn) {
    return `/setup/return?attemptId=${encodeURIComponent(walletReturn.attemptId)}&connectorSessionId=${encodeURIComponent(walletReturn.connectorSessionId)}`;
  }
  if (path.startsWith("hypertrader://wallet-return")) {
    return "/setup/return?invalid=1";
  }
  return path;
}
