import type { SignerBinding } from "@hyper-trader/hyperliquid";

import type { TradingContextIdentity } from "../../core/context/supervisor";
import {
  type CustodyManifest,
  custodyBindingId,
} from "../../platform/security/credential-vault";
import {
  normalizeSavedAccount,
  readOnlyTradingContextForSavedAccount,
  type SavedAccount,
} from "./account-scope";
import type { ActiveSetupBindingRecord } from "./setup-repository";

function sameBinding(left: SignerBinding, right: SignerBinding): boolean {
  return (
    left.network === right.network &&
    left.masterAccount === right.masterAccount &&
    left.targetAccount === right.targetAccount &&
    left.agentAddress === right.agentAddress &&
    left.generation === right.generation
  );
}

export function restoredTradingContextForSavedAccount(input: {
  readonly account: SavedAccount;
  readonly activeBinding: ActiveSetupBindingRecord | null;
  readonly manifest: CustodyManifest | null;
  readonly nowMs: number;
}): TradingContextIdentity {
  const account = normalizeSavedAccount(input.account);
  const readOnly = readOnlyTradingContextForSavedAccount(account);
  const authorization = account.authorization;
  if (
    account.network !== "testnet" ||
    authorization.agentAddress === null ||
    authorization.generation === null ||
    authorization.registrationName === null ||
    authorization.registrationState !== "active" ||
    authorization.credentialState !== "protected" ||
    authorization.requestedExpiryMs === null ||
    authorization.effectiveExpiryMs === null ||
    !Number.isSafeInteger(input.nowMs) ||
    input.nowMs < 0 ||
    authorization.effectiveExpiryMs <= input.nowMs ||
    input.activeBinding === null ||
    input.manifest === null
  ) {
    return readOnly;
  }

  const expected: SignerBinding = {
    network: "testnet",
    masterAccount: account.masterAccount,
    targetAccount: account.target.address,
    agentAddress: authorization.agentAddress,
    generation: authorization.generation,
  };
  const active = input.activeBinding;
  if (
    !sameBinding(expected, active.binding) ||
    active.registrationName !== authorization.registrationName ||
    active.requestedExpiry !== authorization.requestedExpiryMs ||
    active.effectiveExpiry !== authorization.effectiveExpiryMs ||
    active.effectiveExpiry <= input.nowMs
  ) {
    return readOnly;
  }

  const bindingId = custodyBindingId(expected);
  const custodyRecord = input.manifest.records.find(
    (record) => record.bindingId === bindingId,
  );
  if (
    custodyRecord === undefined ||
    custodyRecord.network !== "testnet" ||
    custodyRecord.agentAddress !== expected.agentAddress ||
    custodyRecord.generation !== expected.generation
  ) {
    return readOnly;
  }

  return {
    ...readOnly,
    signer: {
      agentAddress: expected.agentAddress,
      generation: expected.generation,
    },
  };
}
