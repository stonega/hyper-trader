import "@walletconnect/react-native-compat";

import type { MasterWalletApprovalAdapter } from "../../features/accounts/setup-coordinator";

/**
 * Live wallet handoff remains compile-disabled until one reviewed Reown project,
 * redirect allowlist, native configuration diff, and unconditional security
 * evidence revision are supplied together.
 */
export const REOWN_RUNTIME_GATE = Object.freeze({
  enabled: false as const,
  reason: "security_review_pending" as const,
});

export interface MasterWalletConnection {
  readonly connectorSessionId: string;
  readonly account: string;
  readonly chainId: number;
}

export interface MasterWalletConnector {
  connect(): Promise<MasterWalletConnection>;
  disconnect(): Promise<void>;
}

export class WalletRuntimeUnavailableError extends Error {
  constructor() {
    super(
      "External wallet approval is unavailable until the reviewed native wallet configuration is enabled.",
    );
    this.name = "WalletRuntimeUnavailableError";
  }
}

export function createReleaseGatedWalletConnector(): MasterWalletConnector {
  return {
    async connect() {
      throw new WalletRuntimeUnavailableError();
    },
    async disconnect() {},
  };
}

export function createReleaseGatedApprovalAdapter(): MasterWalletApprovalAdapter {
  return {
    async requestApproval(_input) {
      return {
        status: "unavailable",
        reason: REOWN_RUNTIME_GATE.reason,
      };
    },
  };
}
