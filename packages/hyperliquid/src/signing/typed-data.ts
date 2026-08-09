import { getAddress, zeroAddress } from "viem";

import type { EncodedL1Action } from "../actions/codec";
import { HyperliquidValidationError } from "../errors";
import type { HyperliquidNetwork } from "../network";
import type { NetworkTypedData } from "./types";

const APPROVAL_CHAIN_ID = 421_614;
const AGENT_NAME_SUFFIX = " valid_until ";
const MAX_AGENT_VALIDITY_MS = 180 * 24 * 60 * 60 * 1_000;

export const L1_AGENT_TYPES = {
  Agent: [
    { name: "source", type: "string" },
    { name: "connectionId", type: "bytes32" },
  ],
} as const;

export const APPROVE_AGENT_TYPES = {
  "HyperliquidTransaction:ApproveAgent": [
    { name: "hyperliquidChain", type: "string" },
    { name: "agentAddress", type: "address" },
    { name: "agentName", type: "string" },
    { name: "nonce", type: "uint64" },
  ],
} as const;

function normalizeAddress(value: string, path: string): `0x${string}` {
  try {
    return getAddress(value);
  } catch {
    throw new HyperliquidValidationError(
      path,
      "expected a 20-byte Ethereum address",
    );
  }
}

function validateNonce(nonce: number): number {
  if (!Number.isSafeInteger(nonce) || nonce < 0) {
    throw new HyperliquidValidationError(
      "nonce",
      "expected a non-negative safe integer",
    );
  }
  return nonce;
}

function validateNetwork(network: string): HyperliquidNetwork {
  if (network !== "mainnet" && network !== "testnet") {
    throw new HyperliquidValidationError("network", "unknown network");
  }
  return network;
}

export function buildL1TypedData(
  network: HyperliquidNetwork,
  encoded: EncodedL1Action,
): NetworkTypedData {
  const validatedNetwork = validateNetwork(network);
  return {
    network: validatedNetwork,
    typedData: {
      domain: {
        chainId: 1_337,
        name: "Exchange",
        verifyingContract: zeroAddress,
        version: "1",
      },
      types: L1_AGENT_TYPES,
      primaryType: "Agent",
      message: {
        source: validatedNetwork === "mainnet" ? "a" : "b",
        connectionId: encoded.actionHash,
      },
    },
  };
}

export function formatExpiringAgentName(
  baseName: string,
  validUntil: number,
): string {
  if (
    baseName.length < 1 ||
    baseName.length > 16 ||
    !/^[\x21-\x7e]+$/.test(baseName) ||
    baseName.includes(AGENT_NAME_SUFFIX)
  ) {
    throw new HyperliquidValidationError(
      "agentName",
      "expected 1-16 visible ASCII characters without an expiry suffix",
    );
  }
  if (!Number.isSafeInteger(validUntil) || validUntil <= 0) {
    throw new HyperliquidValidationError(
      "validUntil",
      "expected a positive millisecond timestamp",
    );
  }
  return `${baseName}${AGENT_NAME_SUFFIX}${validUntil}`;
}

export interface ApproveAgentInput {
  readonly network: HyperliquidNetwork;
  readonly agentAddress: string;
  readonly agentBaseName: string;
  readonly validUntil: number;
  readonly nonce: number;
}

export interface ApproveAgentAction {
  readonly type: "approveAgent";
  readonly signatureChainId: "0x66eee";
  readonly hyperliquidChain: "Mainnet" | "Testnet";
  readonly agentAddress: `0x${string}`;
  readonly agentName: string;
  readonly nonce: number;
}

export function buildApproveAgentAction(
  input: ApproveAgentInput,
): ApproveAgentAction {
  const network = validateNetwork(input.network);
  const nonce = validateNonce(input.nonce);
  if (
    input.validUntil <= nonce ||
    input.validUntil - nonce > MAX_AGENT_VALIDITY_MS
  ) {
    throw new HyperliquidValidationError(
      "validUntil",
      "expected agent expiry after nonce and within 180 days",
    );
  }
  return {
    type: "approveAgent",
    signatureChainId: "0x66eee",
    hyperliquidChain: network === "mainnet" ? "Mainnet" : "Testnet",
    agentAddress: normalizeAddress(input.agentAddress, "agentAddress"),
    agentName: formatExpiringAgentName(input.agentBaseName, input.validUntil),
    nonce,
  };
}

export function buildApproveAgentTypedData(
  input: ApproveAgentInput,
): NetworkTypedData & { readonly action: ApproveAgentAction } {
  const action = buildApproveAgentAction(input);
  return {
    network: input.network,
    action,
    typedData: {
      domain: {
        name: "HyperliquidSignTransaction",
        version: "1",
        chainId: APPROVAL_CHAIN_ID,
        verifyingContract: zeroAddress,
      },
      types: APPROVE_AGENT_TYPES,
      primaryType: "HyperliquidTransaction:ApproveAgent",
      message: {
        hyperliquidChain: action.hyperliquidChain,
        agentAddress: action.agentAddress,
        agentName: action.agentName,
        nonce: action.nonce,
      },
    },
  };
}
