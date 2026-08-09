import { HyperliquidValidationError } from "../errors";

export const ACTION_EXPIRY_MS = 15_000;
export const MAX_CLOCK_ROLLBACK_MS = 1_000;
export const MAX_SERVER_SAMPLE_AGE_MS = 30_000;
export const MAX_SERVER_SKEW_MS = 5_000;

export interface ClockGateInput {
  readonly wallTimeMs: number;
  readonly monotonicTimeMs: number;
  readonly serverTimeMs: number;
  readonly serverSampledAtMonotonicMs: number;
  readonly lastObservedWallMs: number | null;
}

export interface NonceAllocationInput extends ClockGateInput {
  readonly lastIssuedNonce: number | null;
}

export interface NonceAllocation {
  readonly nonce: number;
  readonly expiresAfterMs: number;
  readonly observedWallMs: number;
}

function safeMilliseconds(value: number, path: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new HyperliquidValidationError(
      path,
      "expected a non-negative safe-integer millisecond value",
    );
  }
  return value;
}

export function assertClockGate(input: ClockGateInput): void {
  const wall = safeMilliseconds(input.wallTimeMs, "clock.wallTimeMs");
  const monotonic = safeMilliseconds(
    input.monotonicTimeMs,
    "clock.monotonicTimeMs",
  );
  const server = safeMilliseconds(input.serverTimeMs, "clock.serverTimeMs");
  const sampledAt = safeMilliseconds(
    input.serverSampledAtMonotonicMs,
    "clock.serverSampledAtMonotonicMs",
  );
  if (
    sampledAt > monotonic ||
    monotonic - sampledAt > MAX_SERVER_SAMPLE_AGE_MS
  ) {
    throw new HyperliquidValidationError(
      "clock.serverSample",
      "the authoritative server-time sample is missing or stale",
    );
  }
  const advancedServerTime = server + (monotonic - sampledAt);
  if (
    !Number.isSafeInteger(advancedServerTime) ||
    Math.abs(wall - advancedServerTime) > MAX_SERVER_SKEW_MS
  ) {
    throw new HyperliquidValidationError(
      "clock.skew",
      "device and Hyperliquid time differ by more than 5 seconds",
    );
  }
  if (
    input.lastObservedWallMs !== null &&
    safeMilliseconds(input.lastObservedWallMs, "clock.lastObservedWallMs") -
      wall >
      MAX_CLOCK_ROLLBACK_MS
  ) {
    throw new HyperliquidValidationError(
      "clock.rollback",
      "the device wall clock moved backwards by more than 1 second",
    );
  }
}

export function allocateNonce(input: NonceAllocationInput): NonceAllocation {
  assertClockGate(input);
  const prior =
    input.lastIssuedNonce === null
      ? null
      : safeMilliseconds(input.lastIssuedNonce, "lastIssuedNonce");
  const nonce = Math.max(input.wallTimeMs, (prior ?? -1) + 1);
  const expiresAfterMs = input.wallTimeMs + ACTION_EXPIRY_MS;
  if (!Number.isSafeInteger(expiresAfterMs) || expiresAfterMs <= nonce) {
    throw new HyperliquidValidationError(
      "expiresAfterMs",
      "the next signer nonce is too far ahead of validated wall time",
    );
  }
  return {
    nonce,
    expiresAfterMs,
    observedWallMs: input.wallTimeMs,
  };
}
