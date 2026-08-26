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

/**
 * The only source switch that may compile mainnet authority into an artifact.
 *
 * `candidate` is an immutable, privately distributed release candidate. It is
 * not permission to distribute publicly: the external evidence manifest must
 * still pass the release preflight for the exact candidate binaries after the
 * bounded canary. There is intentionally no environment, remote, OTA, deep
 * link, callback, persisted-state, or UI override for this value.
 */
export type MainnetTradingReleaseStage = "preactivation" | "candidate";

export const MAINNET_TRADING_RELEASE_STAGE: MainnetTradingReleaseStage =
  "candidate";

export function actionCapabilitiesForReleaseStage(
  stage: MainnetTradingReleaseStage,
): Readonly<Record<HyperliquidNetwork, Readonly<ActionCapability>>> {
  const mainnetEnabled = stage === "candidate";
  return Object.freeze({
    mainnet: Object.freeze({
      signerAccess: mainnetEnabled,
      exchangeTransport: mainnetEnabled,
    }),
    testnet: Object.freeze({
      signerAccess: true,
      exchangeTransport: true,
    }),
  });
}

export const ACTION_CAPABILITIES = actionCapabilitiesForReleaseStage(
  MAINNET_TRADING_RELEASE_STAGE,
);

function actionCapability(network: string): Readonly<ActionCapability> {
  if (network !== "mainnet" && network !== "testnet") {
    throw new HyperliquidValidationError("network", "unknown network");
  }
  return ACTION_CAPABILITIES[network];
}

export function assertKnownActionNetwork(
  network: string,
): asserts network is HyperliquidNetwork {
  actionCapability(network);
}

export function hasSignerAccessCapability(
  network: HyperliquidNetwork,
): boolean {
  return actionCapability(network).signerAccess;
}

export function hasExchangeTransportCapability(
  network: HyperliquidNetwork,
): boolean {
  return actionCapability(network).exchangeTransport;
}

export function hasTradingActionCapability(
  network: HyperliquidNetwork,
): boolean {
  const capability = actionCapability(network);
  return capability.signerAccess && capability.exchangeTransport;
}

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

export function assertSignerAccessCapability(network: string): void {
  if (!actionCapability(network).signerAccess) {
    throw new HyperliquidValidationError(
      "network",
      `${network} signer access is disabled by the local capability policy`,
    );
  }
}

export function assertExchangeTransportCapability(network: string): void {
  if (!actionCapability(network).exchangeTransport) {
    throw new HyperliquidValidationError(
      "network",
      `${network} exchange transport is disabled by the local capability policy`,
    );
  }
}

export function assertTradingActionCapability(network: string): void {
  assertSignerAccessCapability(network);
  assertExchangeTransportCapability(network);
}

/** @deprecated Use the capability-specific assertions. */
export const assertTestnetSigningCapability = assertTradingActionCapability;

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

export async function signNetworkTypedData(input: {
  readonly expectedBinding: SignerBinding;
  readonly payload: NetworkTypedData;
  readonly signer: InjectedTypedDataSigner;
}): Promise<Eip712Signature> {
  assertSignerAccessCapability(input.expectedBinding.network);
  assertSignerAccessCapability(input.payload.network);
  if (input.payload.network !== input.expectedBinding.network) {
    throw new HyperliquidValidationError(
      "signer.network",
      "the signing payload network does not match the signer binding",
    );
  }
  assertSignerBinding(input.expectedBinding, input.signer.binding);
  return validateSignature(
    await input.signer.signTypedData(input.payload.typedData),
  );
}

export async function signNetworkBytes(input: {
  readonly expectedBinding: SignerBinding;
  readonly network: "mainnet" | "testnet";
  readonly bytes: Uint8Array;
  readonly signer: InjectedBytesSigner;
}): Promise<Eip712Signature> {
  assertSignerAccessCapability(input.expectedBinding.network);
  assertSignerAccessCapability(input.network);
  if (input.network !== input.expectedBinding.network) {
    throw new HyperliquidValidationError(
      "signer.network",
      "the signing bytes network does not match the signer binding",
    );
  }
  assertSignerBinding(input.expectedBinding, input.signer.binding);
  return validateSignature(await input.signer.signBytes(input.bytes));
}

/** @deprecated Use signNetworkTypedData. */
export const signTestnetTypedData = signNetworkTypedData;

/** @deprecated Use signNetworkBytes. */
export const signTestnetBytes = signNetworkBytes;
