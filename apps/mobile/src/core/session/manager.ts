import {
  assertSignerBinding,
  assertTestnetSigningCapability,
  type Eip712Payload,
  type Eip712Signature,
  type InjectedTypedDataSigner,
  normalizeSignerBinding,
  type SignerBinding,
  signTestnetTypedData,
} from "@hyper-trader/hyperliquid";

export const SIGNER_SESSION_DURATION_MS = 5 * 60 * 1_000;

export type SignerSessionStopReason =
  | "app_inactive"
  | "app_background"
  | "android_blur"
  | "context_changed"
  | "manual"
  | "timeout"
  | "memory_warning"
  | "app_terminated"
  | "authentication_error"
  | "credential_invalidated"
  | "compromised_device";

export type SignerSessionLifecycleStopReason = Extract<
  SignerSessionStopReason,
  "app_inactive" | "app_background" | "android_blur"
>;

export type SignerSessionUnlockFailureCode =
  | "app_not_active"
  | "context_changed"
  | "session_invalidated";

export class SignerSessionUnlockError extends Error {
  readonly code: SignerSessionUnlockFailureCode;

  constructor(code: SignerSessionUnlockFailureCode) {
    super("The signer unlock could not complete in the current app context.");
    this.name = "SignerSessionUnlockError";
    this.code = code;
  }
}

export interface ProtectedAgentSecret {
  readonly binding: SignerBinding;
  readonly bytes: Uint8Array;
  dispose(): void;
}

export interface DestroyableAgentSigner extends InjectedTypedDataSigner {
  destroy(): void;
}

export interface SessionTimer {
  now(): number;
  schedule(durationMs: number, callback: () => void): unknown;
  cancel(handle: unknown): void;
}

export type SignerSessionSnapshot =
  | {
      readonly status: "locked";
      readonly epoch: number;
      readonly reason: SignerSessionStopReason | null;
    }
  | {
      readonly status: "unlocking";
      readonly epoch: number;
      readonly binding: SignerBinding;
      readonly capturedContextEpoch: number;
    }
  | {
      readonly status: "unlocked";
      readonly epoch: number;
      readonly binding: SignerBinding;
      readonly capturedContextEpoch: number;
      readonly unlockedAt: number;
      readonly expiresAt: number;
    };

export interface SignerSessionManager {
  read(): SignerSessionSnapshot;
  subscribe(listener: (state: SignerSessionSnapshot) => void): () => void;
  unlock(input: {
    readonly binding: SignerBinding;
    readonly capturedContextEpoch: number;
    readonly isContextCurrent: () => boolean;
  }): Promise<SignerSessionSnapshot>;
  signTypedData(input: {
    readonly expectedBinding: SignerBinding;
    readonly payload: Eip712Payload;
    readonly capturedContextEpoch: number;
    readonly isContextCurrent: () => boolean;
  }): Promise<Eip712Signature>;
  lock(reason: SignerSessionStopReason): void;
}

export function shouldLockSignerSessionForLifecycle(
  snapshot: SignerSessionSnapshot,
  reason: SignerSessionLifecycleStopReason,
): boolean {
  return !(
    snapshot.status === "unlocking" &&
    (reason === "app_inactive" || reason === "android_blur")
  );
}

function sameUnlockRequest(
  state: SignerSessionSnapshot,
  binding: SignerBinding,
  capturedContextEpoch: number,
): boolean {
  if (state.status !== "unlocking") return false;
  try {
    assertSignerBinding(state.binding, binding);
    return state.capturedContextEpoch === capturedContextEpoch;
  } catch {
    return false;
  }
}

function unlockFailureReason(error: unknown): SignerSessionStopReason {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "missing_or_invalidated" ||
      error.code === "malformed_record")
  ) {
    return "credential_invalidated";
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "context_changed"
  ) {
    return "context_changed";
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "app_not_active"
  ) {
    return "app_inactive";
  }
  return "authentication_error";
}

export function createSignerSessionManager(options: {
  readonly timer: SessionTimer;
  readonly deviceAuth: { assertAvailable(): Promise<void> };
  readonly vault: {
    read(binding: SignerBinding): Promise<ProtectedAgentSecret>;
  };
  readonly signerFactory: (
    secret: ProtectedAgentSecret,
  ) => Promise<DestroyableAgentSigner>;
  readonly isActiveAndFocused: () => boolean;
  readonly waitUntilActiveAndFocused?: () => Promise<boolean>;
  readonly onStateChange?: (state: SignerSessionSnapshot) => void;
}): SignerSessionManager {
  let epoch = 0;
  let state: SignerSessionSnapshot = {
    status: "locked",
    epoch,
    reason: null,
  };
  let signer: DestroyableAgentSigner | null = null;
  let expiryTimer: unknown = null;
  let inFlight: {
    readonly promise: Promise<SignerSessionSnapshot>;
    readonly token: object;
  } | null = null;
  const listeners = new Set<(snapshot: SignerSessionSnapshot) => void>();

  const publish = (next: SignerSessionSnapshot) => {
    state = next;
    options.onStateChange?.(next);
    for (const listener of listeners) listener(next);
  };
  const clearSigner = () => {
    if (expiryTimer !== null) {
      options.timer.cancel(expiryTimer);
      expiryTimer = null;
    }
    signer?.destroy();
    signer = null;
  };
  const lock = (reason: SignerSessionStopReason) => {
    epoch += 1;
    clearSigner();
    inFlight = null;
    publish({ status: "locked", epoch, reason });
  };
  const assertUnlockCurrent = (
    unlockEpoch: number,
    input: {
      readonly isContextCurrent: () => boolean;
    },
  ) => {
    if (epoch !== unlockEpoch) {
      throw new SignerSessionUnlockError("session_invalidated");
    }
    if (!input.isContextCurrent()) {
      throw new SignerSessionUnlockError("context_changed");
    }
    if (!options.isActiveAndFocused()) {
      throw new SignerSessionUnlockError("app_not_active");
    }
  };
  const settleActiveFocus = async (
    unlockEpoch: number,
    input: {
      readonly isContextCurrent: () => boolean;
    },
  ) => {
    if (options.isActiveAndFocused()) return;
    const restored = await options.waitUntilActiveAndFocused?.();
    if (epoch !== unlockEpoch) {
      throw new SignerSessionUnlockError("session_invalidated");
    }
    if (!input.isContextCurrent()) {
      throw new SignerSessionUnlockError("context_changed");
    }
    if (restored !== true || !options.isActiveAndFocused()) {
      throw new SignerSessionUnlockError("app_not_active");
    }
  };

  const manager: SignerSessionManager = {
    read: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    lock,
    unlock(input) {
      try {
        assertTestnetSigningCapability(input.binding.network);
      } catch (error) {
        return Promise.reject(error);
      }
      const binding = normalizeSignerBinding(input.binding);
      if (
        inFlight &&
        sameUnlockRequest(state, binding, input.capturedContextEpoch)
      ) {
        return inFlight.promise;
      }
      if (state.status === "unlocked") {
        try {
          assertSignerBinding(state.binding, binding);
          if (
            state.capturedContextEpoch === input.capturedContextEpoch &&
            input.isContextCurrent() &&
            options.isActiveAndFocused() &&
            options.timer.now() < state.expiresAt
          ) {
            return Promise.resolve(state);
          }
        } catch {
          // A different exact binding must begin from a new epoch.
        }
      }

      lock("context_changed");
      const unlockEpoch = epoch;
      publish({
        status: "unlocking",
        epoch: unlockEpoch,
        binding,
        capturedContextEpoch: input.capturedContextEpoch,
      });
      const unlockToken = {};
      const promise = (async (): Promise<SignerSessionSnapshot> => {
        let secret: ProtectedAgentSecret | null = null;
        let candidate: DestroyableAgentSigner | null = null;
        try {
          await options.deviceAuth.assertAvailable();
          assertUnlockCurrent(unlockEpoch, input);
          secret = await options.vault.read(binding);
          assertSignerBinding(binding, secret.binding);
          await settleActiveFocus(unlockEpoch, input);
          assertUnlockCurrent(unlockEpoch, input);
          candidate = await options.signerFactory(secret);
          assertSignerBinding(binding, candidate.binding);
          assertUnlockCurrent(unlockEpoch, input);
          signer = candidate;
          candidate = null;
          const unlockedAt = options.timer.now();
          const next: SignerSessionSnapshot = {
            status: "unlocked",
            epoch: unlockEpoch,
            binding,
            capturedContextEpoch: input.capturedContextEpoch,
            unlockedAt,
            expiresAt: unlockedAt + SIGNER_SESSION_DURATION_MS,
          };
          publish(next);
          expiryTimer = options.timer.schedule(SIGNER_SESSION_DURATION_MS, () =>
            lock("timeout"),
          );
          return next;
        } catch (error) {
          candidate?.destroy();
          if (epoch === unlockEpoch) {
            lock(unlockFailureReason(error));
          }
          throw error;
        } finally {
          secret?.dispose();
          if (inFlight?.token === unlockToken) inFlight = null;
        }
      })();
      inFlight = {
        promise,
        token: unlockToken,
      };
      return promise;
    },
    async signTypedData(input) {
      assertTestnetSigningCapability(input.expectedBinding.network);
      const current = state;
      if (current.status !== "unlocked" || signer === null) {
        throw new Error("The signer session is locked.");
      }
      if (options.timer.now() >= current.expiresAt) {
        lock("timeout");
        throw new Error("The signer session expired.");
      }
      assertSignerBinding(input.expectedBinding, current.binding);
      if (
        current.capturedContextEpoch !== input.capturedContextEpoch ||
        !input.isContextCurrent() ||
        !options.isActiveAndFocused()
      ) {
        lock("context_changed");
        throw new Error("The signer session context changed.");
      }
      const signEpoch = epoch;
      const signature = await signTestnetTypedData({
        expectedBinding: input.expectedBinding,
        payload: { network: "testnet", typedData: input.payload },
        signer,
      });
      if (
        epoch !== signEpoch ||
        !input.isContextCurrent() ||
        !options.isActiveAndFocused()
      ) {
        lock("context_changed");
        throw new Error("The signing result belongs to a stale session.");
      }
      return signature;
    },
  };
  return manager;
}
