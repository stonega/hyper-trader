import {
  type HyperliquidNetwork,
  hasTradingActionCapability,
  MAINNET_TRADING_RELEASE_STAGE,
} from "@hyper-trader/hyperliquid";

/**
 * Opening this compile-owned release gate requires the immutable mainnet release
 * evidence and reviewer approvals. It has no environment, remote, OTA, or UI
 * override.
 */
export const RELEASE_ACTION_RUNTIME_ENABLED =
  MAINNET_TRADING_RELEASE_STAGE === "candidate";

export function signingRuntimeEnabled(isDevelopmentBuild: boolean): boolean {
  return isDevelopmentBuild || RELEASE_ACTION_RUNTIME_ENABLED;
}

export function tradingRuntimeEnabled(input: {
  readonly isDevelopmentBuild: boolean;
  readonly network: HyperliquidNetwork;
}): boolean {
  return (
    signingRuntimeEnabled(input.isDevelopmentBuild) &&
    hasTradingActionCapability(input.network)
  );
}

/** @deprecated Use signingRuntimeEnabled or tradingRuntimeEnabled. */
export function developmentTestnetSubmissionEnabled(
  isDevelopmentBuild: boolean,
): boolean {
  return signingRuntimeEnabled(isDevelopmentBuild);
}
