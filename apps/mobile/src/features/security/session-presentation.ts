import type { SignerSessionSnapshot } from "../../core/session/manager";

export function sessionStatusText(snapshot: SignerSessionSnapshot): string {
  if (snapshot.status === "unlocking") {
    return "Unlocking one exact testnet API-wallet binding";
  }
  if (snapshot.status === "unlocked") {
    return `Unlocked until ${new Date(snapshot.expiresAt).toLocaleTimeString()}`;
  }
  if (snapshot.reason === null) return "Locked";
  return `Locked · ${snapshot.reason.replaceAll("_", " ")}`;
}
