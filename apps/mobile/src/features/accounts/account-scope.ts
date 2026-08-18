import type { HyperliquidNetwork } from "@hyper-trader/hyperliquid/public";
import { getAddress } from "viem";

import { AGENT_REGISTRATION_NAME_PATTERN } from "../../platform/wallet/setup-identifiers";

export type SavedAccountTarget =
  | {
      readonly kind: "master";
      readonly address: string;
    }
  | {
      readonly kind: "subaccount" | "vault";
      readonly address: string;
      readonly masterAddress: string;
    };

export type AgentRegistrationState =
  | "active"
  | "inactive"
  | "retiring"
  | "expired"
  | "unverified"
  | "quarantined";

export type LocalCredentialState =
  | "protected"
  | "absent"
  | "missing"
  | "invalidated"
  | "quarantined";

/**
 * Display-only persisted metadata. It is not signer authority and must never be
 * converted into a live signer without a separate non-persisted secure-runtime
 * proof.
 */
export interface ApiWalletAuthorizationSummary {
  readonly agentAddress: string | null;
  readonly generation: number | null;
  readonly registrationName: string | null;
  readonly registrationState: AgentRegistrationState;
  readonly requestedExpiryMs: number | null;
  readonly effectiveExpiryMs: number | null;
  readonly lastVerifiedAtMs: number | null;
  readonly credentialState: LocalCredentialState;
}

export interface ReconciliationSummary {
  readonly pendingCount: number;
  readonly allDurable: boolean;
}

export interface SavedAccount {
  readonly id: string;
  readonly label: string;
  readonly network: HyperliquidNetwork;
  readonly masterAccount: string;
  readonly target: SavedAccountTarget;
  readonly authorization: ApiWalletAuthorizationSummary;
  readonly reconciliation: ReconciliationSummary;
}

const ACCOUNT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const AGENT_REGISTRATION_STATES = [
  "active",
  "inactive",
  "retiring",
  "expired",
  "unverified",
  "quarantined",
] as const satisfies readonly AgentRegistrationState[];
const REGISTRATION_STATES: ReadonlySet<AgentRegistrationState> = new Set(
  AGENT_REGISTRATION_STATES,
);
const CREDENTIAL_STATES: ReadonlySet<LocalCredentialState> = new Set([
  "protected",
  "absent",
  "missing",
  "invalidated",
  "quarantined",
]);

type UnknownRecord = Record<string, unknown>;

function strictRecord(
  value: unknown,
  allowedKeys: readonly string[],
  field: string,
): UnknownRecord {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError(`${field} must be an object.`);
  }
  const input = value as UnknownRecord;
  const keys = Object.keys(input);
  if (
    keys.length !== allowedKeys.length ||
    keys.some((key) => !allowedKeys.includes(key))
  ) {
    throw new TypeError(`${field} fields are malformed.`);
  }
  return input;
}

function normalizeNetwork(value: unknown): HyperliquidNetwork {
  if (value !== "mainnet" && value !== "testnet") {
    throw new TypeError("The saved account network is malformed.");
  }
  return value;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${field} must be a string.`);
  }
  return value;
}

function normalizeAddress(value: string, field: string): string {
  try {
    return getAddress(value.trim().toLowerCase()).toLowerCase();
  } catch {
    throw new TypeError(`${field} must be a valid account address.`);
  }
}

function optionalTime(value: unknown, field: string): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${field} must be a positive millisecond timestamp.`);
  }
  return value;
}

function normalizeTarget(
  value: unknown,
  masterAccount: string,
): SavedAccountTarget {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("The saved account target kind is malformed.");
  }
  const kind = (value as UnknownRecord).kind;
  if (kind === "master") {
    const target = strictRecord(
      value,
      ["kind", "address"],
      "The master target",
    );
    const address = normalizeAddress(
      requiredString(target.address, "The target address"),
      "target address",
    );
    if (address !== masterAccount) {
      throw new TypeError("A master target must match its master account.");
    }
    return { kind: "master", address };
  }
  if (kind !== "subaccount" && kind !== "vault") {
    throw new TypeError("The saved account target kind is malformed.");
  }
  const target = strictRecord(
    value,
    ["kind", "address", "masterAddress"],
    "The saved account target",
  );
  const address = normalizeAddress(
    requiredString(target.address, "The target address"),
    "target address",
  );
  const targetMaster = normalizeAddress(
    requiredString(target.masterAddress, "The target master address"),
    "target master address",
  );
  if (targetMaster !== masterAccount) {
    throw new TypeError("The target must belong to the saved master account.");
  }
  return { kind, address, masterAddress: targetMaster };
}

function normalizeAuthorization(
  value: unknown,
  network: HyperliquidNetwork,
): ApiWalletAuthorizationSummary {
  const input = strictRecord(
    value,
    [
      "agentAddress",
      "generation",
      "registrationName",
      "registrationState",
      "requestedExpiryMs",
      "effectiveExpiryMs",
      "lastVerifiedAtMs",
      "credentialState",
    ],
    "The API-wallet authorization summary",
  );
  if (input.agentAddress !== null && typeof input.agentAddress !== "string") {
    throw new TypeError("The API-wallet agent address is malformed.");
  }
  if (
    input.generation !== null &&
    (!Number.isSafeInteger(input.generation) ||
      (input.generation as number) < 1)
  ) {
    throw new TypeError("The API-wallet generation is malformed.");
  }
  if (
    input.registrationName !== null &&
    typeof input.registrationName !== "string"
  ) {
    throw new TypeError("The API-wallet registration name is malformed.");
  }
  if (
    !REGISTRATION_STATES.has(input.registrationState as AgentRegistrationState)
  ) {
    throw new TypeError("The API-wallet registration state is malformed.");
  }
  if (!CREDENTIAL_STATES.has(input.credentialState as LocalCredentialState)) {
    throw new TypeError("The local credential state is malformed.");
  }
  const agentAddress =
    input.agentAddress === null
      ? null
      : normalizeAddress(input.agentAddress as string, "agent address");
  const generation = input.generation as number | null;
  if (
    (agentAddress === null) !== (generation === null) ||
    (generation !== null &&
      (!Number.isSafeInteger(generation) || generation < 1))
  ) {
    throw new TypeError(
      "Agent address and registration generation must be present together.",
    );
  }
  if (
    input.registrationName !== null &&
    !AGENT_REGISTRATION_NAME_PATTERN.test(input.registrationName as string)
  ) {
    throw new TypeError("The API-wallet registration name is malformed.");
  }
  const normalized: ApiWalletAuthorizationSummary = {
    agentAddress,
    generation,
    registrationName: input.registrationName as string | null,
    registrationState: input.registrationState as AgentRegistrationState,
    requestedExpiryMs: optionalTime(
      input.requestedExpiryMs,
      "requestedExpiryMs",
    ),
    effectiveExpiryMs: optionalTime(
      input.effectiveExpiryMs,
      "effectiveExpiryMs",
    ),
    lastVerifiedAtMs: optionalTime(input.lastVerifiedAtMs, "lastVerifiedAtMs"),
    credentialState: input.credentialState as LocalCredentialState,
  };
  return network === "mainnet"
    ? {
        agentAddress: null,
        generation: null,
        registrationName: null,
        registrationState: "inactive",
        requestedExpiryMs: null,
        effectiveExpiryMs: null,
        lastVerifiedAtMs: null,
        credentialState: "absent",
      }
    : normalized;
}

export function normalizeSavedAccount(value: unknown): SavedAccount {
  const input = strictRecord(
    value,
    [
      "id",
      "label",
      "network",
      "masterAccount",
      "target",
      "authorization",
      "reconciliation",
    ],
    "The saved account",
  );
  const network = normalizeNetwork(input.network);
  const id = requiredString(input.id, "The saved account identifier");
  if (!ACCOUNT_ID_PATTERN.test(id)) {
    throw new TypeError("The saved account identifier is malformed.");
  }
  const label = requiredString(input.label, "The saved account label").trim();
  if (label.length < 1 || label.length > 64) {
    throw new TypeError("The saved account label must be 1 to 64 characters.");
  }
  const masterAccount = normalizeAddress(
    requiredString(input.masterAccount, "The master account"),
    "master account",
  );
  const reconciliation = strictRecord(
    input.reconciliation,
    ["pendingCount", "allDurable"],
    "The reconciliation summary",
  );
  if (
    !Number.isSafeInteger(reconciliation.pendingCount) ||
    (reconciliation.pendingCount as number) < 0
  ) {
    throw new TypeError("The pending reconciliation count is malformed.");
  }
  if (typeof reconciliation.allDurable !== "boolean") {
    throw new TypeError("The reconciliation durability flag is malformed.");
  }
  const pendingCount = reconciliation.pendingCount as number;
  return {
    id,
    label,
    network,
    masterAccount,
    target: normalizeTarget(input.target, masterAccount),
    authorization: normalizeAuthorization(input.authorization, network),
    reconciliation: {
      pendingCount,
      allDurable: pendingCount === 0 || reconciliation.allDurable,
    },
  };
}

type AccountScopeInput = Pick<
  SavedAccount,
  "network" | "masterAccount" | "target"
>;

function normalizedScopeTuple(input: AccountScopeInput) {
  const network = normalizeNetwork(input.network);
  const masterAccount = normalizeAddress(input.masterAccount, "master account");
  const target = normalizeTarget(input.target, masterAccount);
  return [network, masterAccount, target.kind, target.address] as const;
}

function scopeTupleFromNormalizedAccount(account: SavedAccount) {
  return [
    account.network,
    account.masterAccount,
    account.target.kind,
    account.target.address,
  ] as const;
}

export function accountScopeKey(input: AccountScopeInput): string {
  return JSON.stringify([
    "hyper-trader-account/v1",
    ...normalizedScopeTuple(input),
  ]);
}

export function accountPreferenceKey(input: AccountScopeInput): string {
  return JSON.stringify([
    "hyper-trader-trading-preferences/v1",
    ...normalizedScopeTuple(input),
  ]);
}

export function accountCacheKey(input: AccountScopeInput): string {
  return JSON.stringify([
    "hyper-trader-private-cache/v1",
    ...normalizedScopeTuple(input),
  ]);
}

export function accountAuthorizationKey(input: SavedAccount): string {
  const normalized = normalizeSavedAccount(input);
  return JSON.stringify([
    "hyper-trader-api-wallet-authorization/v1",
    ...scopeTupleFromNormalizedAccount(normalized),
    normalized.authorization.agentAddress,
    normalized.authorization.generation,
  ]);
}

export function targetDisplayName(target: SavedAccountTarget): string {
  if (target.kind === "master") return "Master account";
  return target.kind === "subaccount" ? "Subaccount" : "Vault";
}

export function addressSuffix(address: string): string {
  return normalizeAddress(address, "address").slice(-6);
}

export function authorizationDisplayLabel(account: SavedAccount): string {
  if (account.network === "mainnet") return "read only";
  return account.authorization.agentAddress === null
    ? "read only · authorization required"
    : "authorization recorded · verification required";
}

export function readOnlyTradingContextForSavedAccount(account: SavedAccount): {
  readonly network: HyperliquidNetwork;
  readonly masterAccount: string;
  readonly targetAccount: string;
  readonly signer: null;
} {
  // Account-directory metadata is AsyncStorage-backed and therefore untrusted.
  // Secure runtime authority must enter the context through its own
  // non-persisted verified binding, never through this navigation conversion.
  const normalized = normalizeSavedAccount(account);
  return {
    network: normalized.network,
    masterAccount: normalized.masterAccount,
    targetAccount: normalized.target.address,
    signer: null,
  };
}
