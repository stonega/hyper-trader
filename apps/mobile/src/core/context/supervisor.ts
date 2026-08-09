import type { HyperliquidNetwork } from "@hyper-trader/hyperliquid/public";

export interface TradingContextCore {
  readonly network: HyperliquidNetwork;
  readonly masterAccount: string | null;
  readonly targetAccount: string | null;
}

export interface SignerIdentity {
  readonly agentAddress: string;
  readonly generation: number;
}

export interface TradingContextIdentity extends TradingContextCore {
  readonly signer?: SignerIdentity | null;
}

export interface ContextCapture {
  readonly epoch: number;
  readonly identityKey: string;
  readonly signerScopeKey: string | null;
}

export interface ContextSwitchResult {
  readonly committed: boolean;
  readonly epoch: number;
}

export interface ContextSupervisorOptions {
  readonly initial: TradingContextIdentity;
  readonly cancelPrivateQueries?: (
    next: NormalizedTradingContext,
    epoch: number,
  ) => Promise<void>;
  readonly lockSignerSession?: (
    reason: "context_changed",
    epoch: number,
  ) => void;
  readonly invalidateDrafts?: (
    next: NormalizedTradingContext,
    epoch: number,
  ) => void;
  readonly removeIncompatiblePrivateQueries?: (
    next: NormalizedTradingContext,
    epoch: number,
  ) => void;
  readonly onCommit?: (next: NormalizedTradingContext, epoch: number) => void;
}

export interface ContextSupervisor {
  capture(): ContextCapture;
  canCommit(capture: ContextCapture): boolean;
  switchContext(next: TradingContextIdentity): Promise<ContextSwitchResult>;
}

export interface NormalizedTradingContext extends TradingContextCore {
  readonly signer: SignerIdentity | null;
}

function normalizeAddress(address: string | null): string | null {
  const normalized = address?.trim().toLowerCase() ?? null;
  return normalized === "" ? null : normalized;
}

export function normalizeTradingContext(
  context: TradingContextIdentity,
): NormalizedTradingContext {
  const signer = context.signer;
  return {
    network: context.network,
    masterAccount: normalizeAddress(context.masterAccount),
    targetAccount: normalizeAddress(context.targetAccount),
    signer:
      signer == null
        ? null
        : {
            agentAddress: normalizeAddress(signer.agentAddress) ?? "",
            generation: signer.generation,
          },
  };
}

export function contextIdentityKey(context: TradingContextIdentity): string {
  const normalized = normalizeTradingContext(context);
  return JSON.stringify([
    normalized.network,
    normalized.masterAccount,
    normalized.targetAccount,
  ]);
}

export function signerScopeKey(context: TradingContextIdentity): string | null {
  const normalized = normalizeTradingContext(context);
  return normalized.signer === null
    ? null
    : JSON.stringify([
        normalized.network,
        normalized.masterAccount,
        normalized.targetAccount,
        normalized.signer.agentAddress,
        normalized.signer.generation,
      ]);
}

export function createContextSupervisor(
  options: ContextSupervisorOptions,
): ContextSupervisor {
  let current = normalizeTradingContext(options.initial);
  let epoch = 0;

  return {
    capture: () => ({
      epoch,
      identityKey: contextIdentityKey(current),
      signerScopeKey: signerScopeKey(current),
    }),
    canCommit(capture) {
      return (
        capture.epoch === epoch &&
        capture.identityKey === contextIdentityKey(current) &&
        capture.signerScopeKey === signerScopeKey(current)
      );
    },
    async switchContext(next) {
      const normalized = normalizeTradingContext(next);
      const switchEpoch = ++epoch;
      await options.cancelPrivateQueries?.(normalized, switchEpoch);
      if (switchEpoch !== epoch) {
        return { committed: false, epoch: switchEpoch };
      }
      options.lockSignerSession?.("context_changed", switchEpoch);
      options.invalidateDrafts?.(normalized, switchEpoch);
      options.removeIncompatiblePrivateQueries?.(normalized, switchEpoch);
      current = normalized;
      options.onCommit?.(normalized, switchEpoch);
      return { committed: true, epoch: switchEpoch };
    },
  };
}
