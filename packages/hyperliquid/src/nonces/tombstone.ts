import { keccak256, stringToHex, zeroHash } from "viem";

import { HyperliquidValidationError } from "../errors";
import type { HyperliquidNetwork } from "../network";

export type SignerRetirementReason =
  | "rotated"
  | "revoked"
  | "expired"
  | "credential_lost"
  | "external_revocation_unconfirmed";

export const EMPTY_RETIREMENT_CHAIN_ROOT = zeroHash;

const SIGNER_RETIREMENT_REASONS: ReadonlySet<SignerRetirementReason> = new Set([
  "rotated",
  "revoked",
  "expired",
  "credential_lost",
  "external_revocation_unconfirmed",
]);

export interface RetiredSignerTombstoneInput {
  readonly installationEpoch: string;
  readonly sequence: number;
  readonly priorChainRoot: `0x${string}`;
  readonly network: HyperliquidNetwork;
  readonly agentAddressFingerprint: `0x${string}`;
  readonly lastIssuedNonce: number;
  readonly generation: number;
  readonly retiredAt: number;
  readonly reason: SignerRetirementReason;
}

export interface RetiredSignerTombstone extends RetiredSignerTombstoneInput {
  readonly chainRoot: `0x${string}`;
}

const HASH_PATTERN = /^0x[0-9a-f]{64}$/;

function validateHash(
  value: string,
  path: string,
): asserts value is `0x${string}` {
  if (!HASH_PATTERN.test(value)) {
    throw new HyperliquidValidationError(
      path,
      "expected a 32-byte lowercase hash",
    );
  }
}

export function agentAddressFingerprint(address: string): `0x${string}` {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new HyperliquidValidationError(
      "agentAddress",
      "expected a 20-byte Ethereum address",
    );
  }
  return keccak256(
    stringToHex(`hyper-trader-retired-agent/v1\0${address.toLowerCase()}`),
  );
}

export function createRetiredSignerTombstone(
  input: RetiredSignerTombstoneInput,
): RetiredSignerTombstone {
  validateHash(input.priorChainRoot, "priorChainRoot");
  validateHash(input.agentAddressFingerprint, "agentAddressFingerprint");
  if (
    input.installationEpoch.length < 16 ||
    input.installationEpoch.length > 128
  ) {
    throw new HyperliquidValidationError(
      "installationEpoch",
      "expected a bounded opaque installation epoch",
    );
  }
  if (input.network !== "mainnet" && input.network !== "testnet") {
    throw new HyperliquidValidationError("network", "unknown network");
  }
  if (!SIGNER_RETIREMENT_REASONS.has(input.reason)) {
    throw new HyperliquidValidationError("reason", "unknown retirement reason");
  }
  for (const [path, value, minimum] of [
    ["sequence", input.sequence, 1],
    ["lastIssuedNonce", input.lastIssuedNonce, 0],
    ["generation", input.generation, 1],
    ["retiredAt", input.retiredAt, 0],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < minimum) {
      throw new HyperliquidValidationError(path, "expected a safe integer");
    }
  }
  const canonical = JSON.stringify([
    "hyper-trader-retirement/v1",
    input.installationEpoch,
    input.sequence,
    input.priorChainRoot,
    input.network,
    input.agentAddressFingerprint,
    input.lastIssuedNonce,
    input.generation,
    input.retiredAt,
    input.reason,
  ]);
  return { ...input, chainRoot: keccak256(stringToHex(canonical)) };
}
