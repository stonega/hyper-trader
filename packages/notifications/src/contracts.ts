import type { Hex } from "viem";

export const CONTRACT_LIMITS = Object.freeze({
  maxBodyBytes: 64 * 1024,
  maxLinkedAccounts: 10,
  maxActiveRules: 100,
  maxPushTokenChars: 512,
  maxMarketIdChars: 128,
  maxRouteHintChars: 128,
  maxResponseBytes: 64 * 1024,
  installationMutationsPerMinute: 30,
  ipMutationsPerMinute: 60,
  challengeIssuesPerHour: 5,
  failedProofsPerIpHour: 10,
  tokenChangesPerHour: 10,
  upstreamUtilizationPercent: 70,
} as const);

export type NotificationNetwork = "testnet" | "mainnet";
export type RuleScope = "price" | "account";
export type NotificationEventType =
  | "fill"
  | "cancellation"
  | "rejection"
  | "margin_risk"
  | "liquidation_risk"
  | "price_above"
  | "price_below"
  | "funding_above"
  | "funding_below";

export interface RegisterInstallationRequest {
  readonly installationId: string;
  readonly credential: string;
  readonly provider: "expo";
  readonly pushToken: string;
}

export interface CreateRuleRequest {
  readonly ruleId: string;
  readonly scope: RuleScope;
  readonly network: NotificationNetwork;
  readonly marketId: string;
  readonly eventType: NotificationEventType;
  readonly threshold: string;
  readonly accountLinkId?: string;
}

export const ACCOUNT_PROOF_PURPOSES = [
  "notification-account-link",
  "notification-account-rule-mutation",
  "notification-push-token-rebind",
  "notification-installation-revoke",
] as const;
export type SupportedChallengePurpose = (typeof ACCOUNT_PROOF_PURPOSES)[number];

export interface IssueChallengeRequest {
  readonly installationId: string;
  readonly network: NotificationNetwork;
  readonly masterAccount: string;
  readonly targetAccount: string;
  readonly purpose: SupportedChallengePurpose;
  readonly operationDigest: string;
}

export interface AccountProofSubmission {
  readonly challenge: string;
  readonly message: string;
  readonly signature: Hex;
}

export interface VerifyAccountLinkRequest extends AccountProofSubmission {
  readonly installationId: string;
  readonly accountLinkId: string;
}

export interface PutRuleRequest {
  readonly rule: CreateRuleRequest;
  readonly proof?: AccountProofSubmission;
}

export interface RotateInstallationCredentialRequest {
  readonly installationId: string;
  readonly newCredential: string;
}

export interface PriceOnlyPushTokenRebindRequest {
  readonly installationId: string;
  readonly provider: "expo";
  readonly pushToken: string;
}

export interface AccountPushTokenRebindRequest
  extends PriceOnlyPushTokenRebindRequest {
  readonly installationId: string;
  readonly accountLinkId: string;
  readonly proof: AccountProofSubmission;
}

export type PushTokenRebindRequest =
  | PriceOnlyPushTokenRebindRequest
  | AccountPushTokenRebindRequest;

export interface RevokeInstallationRequest {
  readonly installationId: string;
  readonly operationId: string;
}

export interface UnlinkAccountRequest extends RevokeInstallationRequest {
  readonly accountLinkId: string;
}

export interface LostInstallationRevokeRequest extends AccountProofSubmission {
  readonly requestingInstallationId: string;
  readonly operationId: string;
  readonly network: NotificationNetwork;
  readonly masterAccount: string;
  readonly targetAccount: string;
  readonly selectedInstallationIds: readonly string[];
}

const FORBIDDEN_FIELDS = new Set([
  "apikey",
  "apiwalletkey",
  "exchangepayload",
  "masterprivatekey",
  "mnemonic",
  "privatekey",
  "seedphrase",
  "signedaction",
  "signedpayload",
  "signingpayload",
]);
export const NOTIFICATION_HEX_128 = /^[0-9a-f]{32}$/;
const HEX_256 = /^[0-9a-f]{64}$/;
const DECIMAL = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
export const NOTIFICATION_EVENT_TYPES: ReadonlySet<NotificationEventType> =
  new Set([
    "fill",
    "cancellation",
    "rejection",
    "margin_risk",
    "liquidation_risk",
    "price_above",
    "price_below",
    "funding_above",
    "funding_below",
  ]);

export class ContractError extends Error {
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = "ContractError";
  }
}

export function assertRequestBodySize(byteLength: number): void {
  if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
    throw new ContractError("request body length is invalid");
  }
  if (byteLength > CONTRACT_LIMITS.maxBodyBytes) {
    throw new ContractError("request body exceeds 64 KiB");
  }
}

export function assertNoForbiddenFields(value: unknown): void {
  const seen = new Set<object>();
  const visit = (entry: unknown): void => {
    if (entry === null || typeof entry !== "object") return;
    if (seen.has(entry)) throw new ContractError("cyclic request body");
    seen.add(entry);
    if (Array.isArray(entry)) {
      for (const item of entry) visit(item);
      return;
    }
    for (const [key, child] of Object.entries(entry)) {
      if (FORBIDDEN_FIELDS.has(key.toLowerCase().replaceAll(/[_-]/g, ""))) {
        throw new ContractError(`forbidden field: ${key}`);
      }
      visit(child);
    }
  };
  visit(value);
}

export function parseRegisterInstallationRequest(
  value: unknown,
): RegisterInstallationRequest {
  assertNoForbiddenFields(value);
  const record = exactRecord(value, [
    "installationId",
    "credential",
    "provider",
    "pushToken",
  ]);
  const installationId = boundedString(
    record.installationId,
    "installationId",
    32,
  );
  const credential = boundedString(record.credential, "credential", 64);
  const provider = boundedString(record.provider, "provider", 16);
  const pushToken = boundedString(
    record.pushToken,
    "pushToken",
    CONTRACT_LIMITS.maxPushTokenChars,
  );
  if (!NOTIFICATION_HEX_128.test(installationId)) {
    throw new ContractError("installationId must be 128-bit lowercase hex");
  }
  if (!HEX_256.test(credential)) {
    throw new ContractError("credential must be 256-bit lowercase hex");
  }
  if (provider !== "expo") throw new ContractError("provider must be expo");
  if (!/^ExponentPushToken\[[\x21-\x7e]{1,480}\]$/.test(pushToken)) {
    throw new ContractError("pushToken is not a bounded Expo token");
  }
  return { installationId, credential, provider, pushToken };
}

export function parseCreateRuleRequest(value: unknown): CreateRuleRequest {
  assertNoForbiddenFields(value);
  if (!isRecord(value)) throw new ContractError("request must be an object");
  const scope = boundedString(value.scope, "scope", 16);
  const allowed =
    scope === "account"
      ? [
          "ruleId",
          "scope",
          "network",
          "marketId",
          "eventType",
          "threshold",
          "accountLinkId",
        ]
      : ["ruleId", "scope", "network", "marketId", "eventType", "threshold"];
  const record = exactRecord(value, allowed);
  const ruleId = boundedString(record.ruleId, "ruleId", 32);
  const network = parseNetwork(record.network);
  const marketId = boundedString(
    record.marketId,
    "marketId",
    CONTRACT_LIMITS.maxMarketIdChars,
  );
  const eventType = boundedString(record.eventType, "eventType", 32);
  const threshold = boundedString(record.threshold, "threshold", 96);
  if (!NOTIFICATION_HEX_128.test(ruleId))
    throw new ContractError("ruleId must be lowercase hex");
  if (scope !== "price" && scope !== "account") {
    throw new ContractError("scope is invalid");
  }
  if (!/^[\x21-\x7e]+$/.test(marketId)) {
    throw new ContractError("marketId is invalid");
  }
  if (!NOTIFICATION_EVENT_TYPES.has(eventType as NotificationEventType)) {
    throw new ContractError("eventType is invalid");
  }
  if (!DECIMAL.test(threshold)) throw new ContractError("threshold is invalid");
  if (scope === "price" && !eventType.startsWith("price_")) {
    throw new ContractError("price scope accepts only price rules");
  }
  if (scope === "account" && eventType.startsWith("price_")) {
    throw new ContractError("account scope cannot create a price-only rule");
  }
  const accountLinkId =
    record.accountLinkId === undefined
      ? undefined
      : boundedString(record.accountLinkId, "accountLinkId", 32);
  if (
    scope === "account" &&
    (!accountLinkId || !NOTIFICATION_HEX_128.test(accountLinkId))
  ) {
    throw new ContractError("accountLinkId is required for account rules");
  }
  return {
    ruleId,
    scope,
    network,
    marketId,
    eventType: eventType as NotificationEventType,
    threshold,
    ...(accountLinkId === undefined ? {} : { accountLinkId }),
  };
}

export function parseIssueChallengeRequest(
  value: unknown,
): IssueChallengeRequest {
  assertNoForbiddenFields(value);
  const record = exactRecord(value, [
    "installationId",
    "network",
    "masterAccount",
    "targetAccount",
    "purpose",
    "operationDigest",
  ]);
  const installationId = parseHexId(
    record.installationId,
    "installationId",
    NOTIFICATION_HEX_128,
  );
  const network = parseNetwork(record.network);
  const masterAccount = parseAddress(record.masterAccount, "masterAccount");
  const targetAccount = parseAddress(record.targetAccount, "targetAccount");
  const purpose = boundedString(record.purpose, "purpose", 64);
  if (!isSupportedChallengePurpose(purpose)) {
    throw new ContractError("proof purpose is unsupported");
  }
  return {
    installationId,
    network,
    masterAccount,
    targetAccount,
    purpose,
    operationDigest: parseHexId(
      record.operationDigest,
      "operationDigest",
      HEX_256,
    ),
  };
}

function isSupportedChallengePurpose(
  value: string,
): value is SupportedChallengePurpose {
  return ACCOUNT_PROOF_PURPOSES.some((purpose) => purpose === value);
}

export function parseRotateInstallationCredentialRequest(
  value: unknown,
): RotateInstallationCredentialRequest {
  assertNoForbiddenFields(value);
  const record = exactRecord(value, ["installationId", "newCredential"]);
  return {
    installationId: parseHexId(
      record.installationId,
      "installationId",
      NOTIFICATION_HEX_128,
    ),
    newCredential: parseHexId(record.newCredential, "newCredential", HEX_256),
  };
}

export function parsePushTokenRebindRequest(
  value: unknown,
): PushTokenRebindRequest {
  assertNoForbiddenFields(value);
  if (!isRecord(value)) throw new ContractError("request must be an object");
  const proofBound = "accountLinkId" in value || "proof" in value;
  const record = exactRecord(
    value,
    proofBound
      ? ["installationId", "accountLinkId", "provider", "pushToken", "proof"]
      : ["installationId", "provider", "pushToken"],
  );
  const provider = boundedString(record.provider, "provider", 16);
  if (provider !== "expo") throw new ContractError("provider must be expo");
  const expoProvider: "expo" = provider;
  const pushToken = boundedString(
    record.pushToken,
    "pushToken",
    CONTRACT_LIMITS.maxPushTokenChars,
  );
  if (!/^ExponentPushToken\[[\x21-\x7e]{1,480}\]$/.test(pushToken)) {
    throw new ContractError("pushToken is not a bounded Expo token");
  }
  const shared = {
    installationId: parseHexId(
      record.installationId,
      "installationId",
      NOTIFICATION_HEX_128,
    ),
    provider: expoProvider,
    pushToken,
  };
  if (!proofBound) return shared;
  return {
    ...shared,
    accountLinkId: parseHexId(
      record.accountLinkId,
      "accountLinkId",
      NOTIFICATION_HEX_128,
    ),
    proof: parseAccountProofSubmission(record.proof),
  };
}

export function parseVerifyAccountLinkRequest(
  value: unknown,
): VerifyAccountLinkRequest {
  assertNoForbiddenFields(value);
  const record = exactRecord(value, [
    "installationId",
    "accountLinkId",
    "challenge",
    "message",
    "signature",
  ]);
  return {
    installationId: parseHexId(
      record.installationId,
      "installationId",
      NOTIFICATION_HEX_128,
    ),
    accountLinkId: parseHexId(
      record.accountLinkId,
      "accountLinkId",
      NOTIFICATION_HEX_128,
    ),
    ...parseAccountProofSubmission({
      challenge: record.challenge,
      message: record.message,
      signature: record.signature,
    }),
  };
}

export function parsePutRuleRequest(value: unknown): PutRuleRequest {
  assertNoForbiddenFields(value);
  if (!isRecord(value)) throw new ContractError("request must be an object");
  const { proof, ...ruleValue } = value;
  const rule = parseCreateRuleRequest(ruleValue);
  if (rule.scope === "price") {
    if (proof !== undefined)
      throw new ContractError("price rule must not include proof");
    return { rule };
  }
  if (proof === undefined)
    throw new ContractError("account rule requires proof");
  return { rule, proof: parseAccountProofSubmission(proof) };
}

export function parseRevokeInstallationRequest(
  value: unknown,
): RevokeInstallationRequest {
  assertNoForbiddenFields(value);
  const record = exactRecord(value, ["installationId", "operationId"]);
  return {
    installationId: parseHexId(
      record.installationId,
      "installationId",
      NOTIFICATION_HEX_128,
    ),
    operationId: parseHexId(
      record.operationId,
      "operationId",
      NOTIFICATION_HEX_128,
    ),
  };
}

export function parseUnlinkAccountRequest(
  value: unknown,
): UnlinkAccountRequest {
  assertNoForbiddenFields(value);
  const record = exactRecord(value, [
    "installationId",
    "accountLinkId",
    "operationId",
  ]);
  return {
    installationId: parseHexId(
      record.installationId,
      "installationId",
      NOTIFICATION_HEX_128,
    ),
    accountLinkId: parseHexId(
      record.accountLinkId,
      "accountLinkId",
      NOTIFICATION_HEX_128,
    ),
    operationId: parseHexId(
      record.operationId,
      "operationId",
      NOTIFICATION_HEX_128,
    ),
  };
}

export function parseLostInstallationRevokeRequest(
  value: unknown,
): LostInstallationRevokeRequest {
  assertNoForbiddenFields(value);
  const record = exactRecord(value, [
    "requestingInstallationId",
    "operationId",
    "network",
    "masterAccount",
    "targetAccount",
    "selectedInstallationIds",
    "challenge",
    "message",
    "signature",
  ]);
  if (!Array.isArray(record.selectedInstallationIds)) {
    throw new ContractError("selectedInstallationIds must be an array");
  }
  if (
    record.selectedInstallationIds.length < 1 ||
    record.selectedInstallationIds.length > CONTRACT_LIMITS.maxLinkedAccounts
  ) {
    throw new ContractError("selected installation count is invalid");
  }
  const selectedInstallationIds = record.selectedInstallationIds.map((id) =>
    parseHexId(id, "selectedInstallationId", NOTIFICATION_HEX_128),
  );
  for (let index = 1; index < selectedInstallationIds.length; index += 1) {
    if (
      (selectedInstallationIds[index - 1] ?? "") >=
      (selectedInstallationIds[index] ?? "")
    ) {
      throw new ContractError(
        "selected installation IDs must be sorted and unique",
      );
    }
  }
  return {
    requestingInstallationId: parseHexId(
      record.requestingInstallationId,
      "requestingInstallationId",
      NOTIFICATION_HEX_128,
    ),
    operationId: parseHexId(
      record.operationId,
      "operationId",
      NOTIFICATION_HEX_128,
    ),
    network: parseNetwork(record.network),
    masterAccount: parseAddress(record.masterAccount, "masterAccount"),
    targetAccount: parseAddress(record.targetAccount, "targetAccount"),
    selectedInstallationIds,
    ...parseAccountProofSubmission({
      challenge: record.challenge,
      message: record.message,
      signature: record.signature,
    }),
  };
}

function exactRecord(
  value: unknown,
  allowedKeys: readonly string[],
): Record<string, unknown> {
  return exactContractRecord(value, allowedKeys);
}

export function exactContractRecord(
  value: unknown,
  allowedKeys: readonly string[],
  options: {
    readonly label?: "request" | "response";
    readonly requireAll?: boolean;
  } = {},
): Record<string, unknown> {
  const label = options.label ?? "request";
  if (!isRecord(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new ContractError(`${label} must be an object`);
  }
  const allowed = new Set(allowedKeys);
  const actual = Object.keys(value);
  for (const key of actual) {
    if (allowed.has(key)) continue;
    throw new ContractError(
      options.requireAll
        ? `${label} contains an unknown field`
        : `unknown field: ${key}`,
    );
  }
  if (options.requireAll && actual.length !== allowed.size) {
    throw new ContractError(`${label} contains an unknown field`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function boundedString(
  value: unknown,
  name: string,
  maxLength: number,
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength
  ) {
    throw new ContractError(`${name} is invalid`);
  }
  return value;
}

function parseAccountProofSubmission(value: unknown): AccountProofSubmission {
  const record = exactRecord(value, ["challenge", "message", "signature"]);
  const challenge = parseHexId(record.challenge, "challenge", HEX_256);
  const message = boundedString(record.message, "message", 2048);
  const signature = boundedString(record.signature, "signature", 132);
  if (!/^0x[0-9a-f]{130}$/.test(signature)) {
    throw new ContractError("signature is invalid");
  }
  return { challenge, message, signature: signature as Hex };
}

function parseHexId(value: unknown, name: string, pattern: RegExp): string {
  const parsed = boundedString(value, name, 128);
  if (!pattern.test(parsed)) throw new ContractError(`${name} is invalid`);
  return parsed;
}

function parseAddress(value: unknown, name: string): string {
  const parsed = boundedString(value, name, 42);
  if (!/^0x[0-9a-f]{40}$/.test(parsed))
    throw new ContractError(`${name} is invalid`);
  return parsed;
}

function parseNetwork(value: unknown): NotificationNetwork {
  if (value !== "testnet" && value !== "mainnet") {
    throw new ContractError("network is invalid");
  }
  return value;
}
