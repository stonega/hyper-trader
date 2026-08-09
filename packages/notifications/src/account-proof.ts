import { timingSafeEqual } from "node:crypto";
import { type Hex, recoverMessageAddress } from "viem";

import {
  ACCOUNT_PROOF_PURPOSES,
  type NotificationNetwork,
  type SupportedChallengePurpose,
} from "./contracts";

export const ACCOUNT_PROOF_VERSION = 1 as const;
export const ACCOUNT_PROOF_TTL_MS = 5 * 60 * 1000;

export type AccountProofPurpose = SupportedChallengePurpose;

export interface AccountProofChallengeRecord {
  readonly challengeHash: string;
  readonly credentialHash: string;
  readonly installationId: string;
  readonly network: NotificationNetwork;
  readonly masterAccount: string;
  readonly targetAccount: string;
  readonly purpose: AccountProofPurpose;
  readonly operationDigest: string;
  readonly serviceOrigin: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly state: "pending" | "consumed";
}

export interface CreateChallengeRecordInput
  extends Omit<
    AccountProofChallengeRecord,
    "challengeHash" | "expiresAt" | "state"
  > {
  readonly challenge: string;
}

export class AccountProofError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountProofError";
  }
}

export async function createChallengeRecord(
  input: CreateChallengeRecordInput,
): Promise<AccountProofChallengeRecord> {
  assertHex(input.challenge, 64, "challenge");
  assertHex(input.credentialHash, 64, "credential hash");
  assertHex(input.installationId, 32, "installation ID");
  assertHex(input.operationDigest, 64, "operation digest");
  assertAddress(input.masterAccount, "master account");
  assertAddress(input.targetAccount, "target account");
  assertServiceOrigin(input.serviceOrigin);
  if (input.network !== "testnet" && input.network !== "mainnet") {
    throw new AccountProofError("network is invalid");
  }
  if (!PROOF_PURPOSES.has(input.purpose)) {
    throw new AccountProofError("proof purpose is invalid");
  }
  if (!Number.isSafeInteger(input.issuedAt) || input.issuedAt <= 0) {
    throw new AccountProofError("issued time is invalid");
  }
  return {
    challengeHash: await sha256Hex(input.challenge),
    credentialHash: input.credentialHash,
    installationId: input.installationId,
    network: input.network,
    masterAccount: input.masterAccount,
    targetAccount: input.targetAccount,
    purpose: input.purpose,
    operationDigest: input.operationDigest,
    serviceOrigin: input.serviceOrigin,
    issuedAt: input.issuedAt,
    expiresAt: input.issuedAt + ACCOUNT_PROOF_TTL_MS,
    state: "pending",
  };
}

const PROOF_PURPOSES = new Set<AccountProofPurpose>(ACCOUNT_PROOF_PURPOSES);

export function buildAccountProofMessage(
  record: AccountProofChallengeRecord,
  challenge: string,
): string {
  return [
    "Hyper Trader Notification Account Scope",
    `Version: ${ACCOUNT_PROOF_VERSION}`,
    `Service-Origin: ${record.serviceOrigin}`,
    `Challenge: ${challenge}`,
    `Installation: ${record.installationId}`,
    `Network: ${record.network}`,
    `Master-Account: ${record.masterAccount}`,
    `Target-Account: ${record.targetAccount}`,
    `Purpose: ${record.purpose}`,
    `Operation-Digest: ${record.operationDigest}`,
    `Issued-At: ${record.issuedAt}`,
    `Expires-At: ${record.expiresAt}`,
  ].join("\n");
}

export async function verifyAccountProof(input: {
  readonly record: AccountProofChallengeRecord;
  readonly challenge: string;
  readonly message: string;
  readonly signature: Hex;
  readonly now: number;
}): Promise<{ readonly masterAccount: string }> {
  if (input.record.state !== "pending") {
    throw new AccountProofError("challenge is not pending");
  }
  if (!Number.isSafeInteger(input.now) || input.now < input.record.issuedAt) {
    throw new AccountProofError("proof time is invalid");
  }
  if (input.now >= input.record.expiresAt) {
    throw new AccountProofError("challenge expired");
  }
  const actualHash = await sha256Hex(input.challenge);
  if (!safeHexEqual(actualHash, input.record.challengeHash)) {
    throw new AccountProofError("challenge binding is invalid");
  }
  const canonical = buildAccountProofMessage(input.record, input.challenge);
  if (input.message !== canonical) {
    throw new AccountProofError("proof message is not canonical");
  }
  let recovered: string;
  try {
    recovered = await recoverMessageAddress({
      message: input.message,
      signature: input.signature,
    });
  } catch {
    throw new AccountProofError("proof signature is invalid");
  }
  if (recovered.toLowerCase() !== input.record.masterAccount) {
    throw new AccountProofError("proof signer does not match master account");
  }
  return { masterAccount: input.record.masterAccount };
}

export async function operationDigest(
  versionedOperation: string,
  operation: unknown,
): Promise<string> {
  if (!/^[a-z0-9-]+\/v[1-9][0-9]*$/.test(versionedOperation)) {
    throw new AccountProofError("operation version is invalid");
  }
  return sha256Hex(`${versionedOperation}\n${canonicalJson(operation)}`);
}

export async function sha256Hex(value: string | Uint8Array): Promise<string> {
  const bytes =
    typeof value === "string" ? new TextEncoder().encode(value) : value;
  return bytesToHex(
    new Uint8Array(await crypto.subtle.digest("SHA-256", cryptoBytes(bytes))),
  );
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number" && Number.isSafeInteger(value))
    return String(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  throw new AccountProofError("operation contains a noncanonical value");
}

function safeHexEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function assertHex(value: string, length: number, name: string): void {
  if (value.length !== length || !/^[0-9a-f]+$/.test(value)) {
    throw new AccountProofError(`${name} is invalid`);
  }
}

function assertAddress(value: string, name: string): void {
  if (!/^0x[0-9a-f]{40}$/.test(value)) {
    throw new AccountProofError(`${name} is invalid`);
  }
}

function assertServiceOrigin(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AccountProofError("service origin is invalid");
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== "" ||
    value !== url.origin.toLowerCase()
  ) {
    throw new AccountProofError("service origin is invalid");
  }
}

function bytesToHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

function cryptoBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(bytes);
}
