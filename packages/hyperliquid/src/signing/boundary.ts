import { getAddress } from "viem";

import { HyperliquidValidationError } from "../errors";
import type { HyperliquidNetwork } from "../network";
import type {
  Eip712Signature,
  InjectedBytesSigner,
  InjectedTypedDataSigner,
  NetworkTypedData,
  SignerBinding,
} from "./types";

const SIGNATURE_COMPONENT = /^0x[0-9a-fA-F]{64}$/;

export interface ActionCapability {
  readonly signerAccess: boolean;
  readonly exchangeTransport: boolean;
}

export const ACTION_CAPABILITIES = Object.freeze({
  mainnet: Object.freeze({
    signerAccess: false,
    exchangeTransport: false,
  }),
  testnet: Object.freeze({
    signerAccess: true,
    exchangeTransport: true,
  }),
}) satisfies Readonly<Record<HyperliquidNetwork, Readonly<ActionCapability>>>;

export function normalizeSignerBinding(binding: SignerBinding): SignerBinding {
  if (!Number.isSafeInteger(binding.generation) || binding.generation < 1) {
    throw new HyperliquidValidationError(
      "signer.generation",
      "expected a positive safe integer",
    );
  }
  try {
    return {
      ...binding,
      masterAccount: getAddress(binding.masterAccount).toLowerCase(),
      targetAccount: getAddress(binding.targetAccount).toLowerCase(),
      agentAddress: getAddress(binding.agentAddress).toLowerCase(),
    };
  } catch {
    throw new HyperliquidValidationError(
      "signer.binding",
      "expected valid master, target, and agent addresses",
    );
  }
}

export function assertSignerBinding(
  expected: SignerBinding,
  actual: SignerBinding,
): void {
  const left = normalizeSignerBinding(expected);
  const right = normalizeSignerBinding(actual);
  if (
    left.network !== right.network ||
    left.masterAccount !== right.masterAccount ||
    left.targetAccount !== right.targetAccount ||
    left.agentAddress !== right.agentAddress ||
    left.generation !== right.generation
  ) {
    throw new HyperliquidValidationError(
      "signer.binding",
      "the unlocked signer is not bound to this exact action target",
    );
  }
}

export function assertTestnetSigningCapability(network: string): void {
  const capability =
    network === "testnet"
      ? ACTION_CAPABILITIES.testnet
      : ACTION_CAPABILITIES.mainnet;
  if (!capability.signerAccess || !capability.exchangeTransport) {
    throw new HyperliquidValidationError(
      "network",
      "mainnet signing is disabled by the local capability policy",
    );
  }
}

function validateSignature(signature: Eip712Signature): Eip712Signature {
  if (
    !SIGNATURE_COMPONENT.test(signature.r) ||
    !SIGNATURE_COMPONENT.test(signature.s) ||
    (signature.v !== 27 && signature.v !== 28)
  ) {
    throw new HyperliquidValidationError(
      "signature",
      "the signer returned malformed signature components",
    );
  }
  return {
    r: signature.r.toLowerCase() as `0x${string}`,
    s: signature.s.toLowerCase() as `0x${string}`,
    v: signature.v,
  };
}

export async function signTestnetTypedData(input: {
  readonly expectedBinding: SignerBinding;
  readonly payload: NetworkTypedData;
  readonly signer: InjectedTypedDataSigner;
}): Promise<Eip712Signature> {
  assertTestnetSigningCapability(input.expectedBinding.network);
  assertTestnetSigningCapability(input.payload.network);
  assertSignerBinding(input.expectedBinding, input.signer.binding);
  return validateSignature(
    await input.signer.signTypedData(input.payload.typedData),
  );
}

export async function signTestnetBytes(input: {
  readonly expectedBinding: SignerBinding;
  readonly network: "mainnet" | "testnet";
  readonly bytes: Uint8Array;
  readonly signer: InjectedBytesSigner;
}): Promise<Eip712Signature> {
  assertTestnetSigningCapability(input.expectedBinding.network);
  assertTestnetSigningCapability(input.network);
  assertSignerBinding(input.expectedBinding, input.signer.binding);
  return validateSignature(await input.signer.signBytes(input.bytes));
}
