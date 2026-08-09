import { isConnectorSessionId, isSetupAttemptId } from "./setup-identifiers";

export interface ParsedWalletReturn {
  readonly attemptId: string;
  readonly connectorSessionId: string;
}

export function parseWalletReturn(value: string): ParsedWalletReturn | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "hypertrader:" || url.hostname !== "wallet-return") {
      return null;
    }
    if (
      url.searchParams.getAll("attempt").length !== 1 ||
      url.searchParams.getAll("session").length !== 1
    ) {
      return null;
    }
    const attemptId = url.searchParams.get("attempt") ?? "";
    const connectorSessionId = url.searchParams.get("session") ?? "";
    if (
      !isSetupAttemptId(attemptId) ||
      !isConnectorSessionId(connectorSessionId)
    ) {
      return null;
    }
    return { attemptId, connectorSessionId };
  } catch {
    return null;
  }
}
