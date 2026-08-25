import { normalizeSavedAccount, type SavedAccount } from "./account-scope";
import type { SetupAttempt } from "./setup-coordinator";
import type { ActivatedSetupRecord } from "./setup-repository";

export function accountFromManualSetup(
  attempt: SetupAttempt,
  activation: ActivatedSetupRecord,
): SavedAccount {
  if (
    activation.attemptId !== attempt.id ||
    activation.binding.network !== attempt.network ||
    activation.binding.masterAccount !== attempt.masterAccount ||
    activation.binding.targetAccount !== attempt.targetAccount ||
    activation.binding.agentAddress !== attempt.agentAddress ||
    activation.binding.generation !== attempt.registrationGeneration ||
    activation.registrationName !== attempt.registrationName ||
    activation.requestedExpiry !== attempt.requestedExpiry
  ) {
    throw new Error("The activated API-wallet binding does not match setup.");
  }
  return normalizeSavedAccount({
    id: `${attempt.network}.${attempt.masterAccount.slice(2)}`,
    label: `Hyperliquid · …${attempt.masterAccount.slice(-6)}`,
    network: attempt.network,
    masterAccount: attempt.masterAccount,
    target: { kind: "master", address: attempt.masterAccount },
    authorization: {
      agentAddress: attempt.agentAddress,
      generation: attempt.registrationGeneration,
      registrationName: attempt.registrationName,
      registrationState: "active",
      requestedExpiryMs: attempt.requestedExpiry,
      effectiveExpiryMs: activation.effectiveExpiry,
      lastVerifiedAtMs: activation.activatedAt,
      credentialState: "protected",
    },
    reconciliation: { pendingCount: 0, allDurable: true },
  });
}
