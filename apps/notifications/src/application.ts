import type {
  DeletePriceRuleRequest,
  IssueChallengeRequest,
  LostInstallationRevokeRequest,
  MobileAlertResponse,
  MobileInstallationSnapshotResponse,
  PushTokenRebindRequest,
  PutRuleRequest,
  RegisterInstallationRequest,
  RevokeInstallationRequest,
  RotateInstallationCredentialRequest,
  UnlinkAccountRequest,
  VerifyAccountLinkRequest,
} from "@hyper-trader/notifications";
import {
  parseMobileAlertResponse as parseSharedMobileAlertResponse,
  parseMobileInstallationSnapshotResponse as parseSharedMobileInstallationSnapshotResponse,
} from "@hyper-trader/notifications";

export type {
  MobileAlertResponse,
  MobileInstallationSnapshotResponse,
} from "@hyper-trader/notifications";

export interface NotificationApplicationContext {
  readonly ip: string;
}

export interface AuthenticatedApplicationContext
  extends NotificationApplicationContext {
  readonly credential: string;
}

export interface InstallationResponse {
  readonly installationId: string;
  readonly state: "active";
}

export interface ChallengeResponse {
  readonly challenge: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly operationDigest: string;
  readonly proofVersion: 1;
}

export interface AccountLinkResponse {
  readonly accountLinkId: string;
  readonly state: "active";
}

export interface RuleResponse {
  readonly ruleId: string;
  readonly state: "active";
}

export interface DeletedRuleResponse {
  readonly ruleId: string;
  readonly state: "deleted";
}

export interface CredentialRotationResponse {
  readonly installationId: string;
  readonly credentialGeneration: number;
  readonly state: "active";
}

export interface PushTokenResponse {
  readonly tokenFingerprint: string;
  readonly state: "active";
}

export type DrainResponse =
  | { readonly operationId: string; readonly state: "draining" }
  | {
      readonly operationId: string;
      readonly state: "inactive";
      readonly ledgerSequence: number;
    };

export interface LostRevokeResponse {
  readonly state: "accepted";
  readonly operations: readonly DrainResponse[];
}

export interface NotificationApplication {
  registerInstallation(
    request: RegisterInstallationRequest,
    context: NotificationApplicationContext,
  ): Promise<InstallationResponse>;
  issueChallenge(
    request: IssueChallengeRequest,
    context: AuthenticatedApplicationContext,
  ): Promise<ChallengeResponse>;
  verifyAccountLink(
    request: VerifyAccountLinkRequest,
    context: AuthenticatedApplicationContext,
  ): Promise<AccountLinkResponse>;
  putRule(
    request: PutRuleRequest,
    context: AuthenticatedApplicationContext,
  ): Promise<RuleResponse>;
  revokeInstallation(
    request: RevokeInstallationRequest,
    context: AuthenticatedApplicationContext,
  ): Promise<DrainResponse>;
  unlinkAccount(
    request: UnlinkAccountRequest,
    context: AuthenticatedApplicationContext,
  ): Promise<DrainResponse>;
  revokeLostInstallations(
    request: LostInstallationRevokeRequest,
    context: AuthenticatedApplicationContext,
  ): Promise<LostRevokeResponse>;
  rotateInstallationCredential(
    request: RotateInstallationCredentialRequest,
    context: AuthenticatedApplicationContext,
  ): Promise<CredentialRotationResponse>;
  rebindPushToken(
    request: PushTokenRebindRequest,
    context: AuthenticatedApplicationContext,
  ): Promise<PushTokenResponse>;
  readInstallationSnapshot(
    installationId: string,
    context: AuthenticatedApplicationContext,
  ): Promise<MobileInstallationSnapshotResponse>;
  readAlert(
    alertId: string,
    context: AuthenticatedApplicationContext,
  ): Promise<MobileAlertResponse>;
  deletePriceRule(
    request: DeletePriceRuleRequest,
    context: AuthenticatedApplicationContext,
  ): Promise<DeletedRuleResponse>;
}

export class ResponseContractError extends Error {
  constructor() {
    super("notification application returned an invalid response");
    this.name = "ResponseContractError";
  }
}

export function parseInstallationResponse(
  value: unknown,
): InstallationResponse {
  const record = exactResponse(value, ["installationId", "state"]);
  return {
    installationId: hex(record.installationId, 32),
    state: literal(record.state, "active"),
  };
}

export function parseChallengeResponse(value: unknown): ChallengeResponse {
  const record = exactResponse(value, [
    "challenge",
    "issuedAt",
    "expiresAt",
    "operationDigest",
    "proofVersion",
  ]);
  const issuedAt = positiveInteger(record.issuedAt);
  const expiresAt = positiveInteger(record.expiresAt);
  if (expiresAt <= issuedAt) throw new ResponseContractError();
  return {
    challenge: hex(record.challenge, 64),
    issuedAt,
    expiresAt,
    operationDigest: hex(record.operationDigest, 64),
    proofVersion: literal(record.proofVersion, 1),
  };
}

export function parseAccountLinkResponse(value: unknown): AccountLinkResponse {
  const record = exactResponse(value, ["accountLinkId", "state"]);
  return {
    accountLinkId: hex(record.accountLinkId, 32),
    state: literal(record.state, "active"),
  };
}

export function parseRuleResponse(value: unknown): RuleResponse {
  const record = exactResponse(value, ["ruleId", "state"]);
  return {
    ruleId: hex(record.ruleId, 32),
    state: literal(record.state, "active"),
  };
}

export function parseDeletedRuleResponse(value: unknown): DeletedRuleResponse {
  const record = exactResponse(value, ["ruleId", "state"]);
  return {
    ruleId: hex(record.ruleId, 32),
    state: literal(record.state, "deleted"),
  };
}

export function parseMobileSnapshotResponse(
  value: unknown,
): MobileInstallationSnapshotResponse {
  try {
    return parseSharedMobileInstallationSnapshotResponse(value);
  } catch {
    throw new ResponseContractError();
  }
}

export function parseMobileAlertResponse(value: unknown): MobileAlertResponse {
  try {
    return parseSharedMobileAlertResponse(value);
  } catch {
    throw new ResponseContractError();
  }
}

export function parseCredentialRotationResponse(
  value: unknown,
): CredentialRotationResponse {
  const record = exactResponse(value, [
    "installationId",
    "credentialGeneration",
    "state",
  ]);
  return {
    installationId: hex(record.installationId, 32),
    credentialGeneration: positiveInteger(record.credentialGeneration),
    state: literal(record.state, "active"),
  };
}

export function parsePushTokenResponse(value: unknown): PushTokenResponse {
  const record = exactResponse(value, ["tokenFingerprint", "state"]);
  return {
    tokenFingerprint: hex(record.tokenFingerprint, 64),
    state: literal(record.state, "active"),
  };
}

export function parseDrainResponse(value: unknown): DrainResponse {
  if (
    !isRecord(value) ||
    (value.state !== "draining" && value.state !== "inactive")
  ) {
    throw new ResponseContractError();
  }
  if (value.state === "draining") {
    const record = exactResponse(value, ["operationId", "state"]);
    return {
      operationId: hex(record.operationId, 32),
      state: literal(record.state, "draining"),
    };
  }
  const record = exactResponse(value, [
    "operationId",
    "state",
    "ledgerSequence",
  ]);
  return {
    operationId: hex(record.operationId, 32),
    state: literal(record.state, "inactive"),
    ledgerSequence: positiveInteger(record.ledgerSequence),
  };
}

export function parseLostRevokeResponse(value: unknown): LostRevokeResponse {
  const record = exactResponse(value, ["state", "operations"]);
  if (!Array.isArray(record.operations) || record.operations.length > 10) {
    throw new ResponseContractError();
  }
  return {
    state: literal(record.state, "accepted"),
    operations: record.operations.map(parseDrainResponse),
  };
}

function exactResponse(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (!isRecord(value)) throw new ResponseContractError();
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new ResponseContractError();
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hex(value: unknown, characters: number): string {
  if (
    typeof value !== "string" ||
    value.length !== characters ||
    !/^[0-9a-f]+$/.test(value)
  ) {
    throw new ResponseContractError();
  }
  return value;
}

function literal<T extends string | number>(value: unknown, expected: T): T {
  if (value !== expected) throw new ResponseContractError();
  return expected;
}

function positiveInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new ResponseContractError();
  }
  return value as number;
}

export class ApplicationError extends Error {
  readonly status: number;
  readonly retryAfterMs?: number;

  constructor(status: number, message: string, retryAfterMs?: number) {
    super(message);
    this.name = "ApplicationError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}
