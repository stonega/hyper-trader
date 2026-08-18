import type {
  PreparedActionInput,
  PreparedActionRecord,
} from "../reconciliation";
import type { SignerBinding } from "../signing";
import type { ClockGateInput } from "./allocation";
import type {
  RetiredSignerTombstone,
  RetiredSignerTombstoneInput,
} from "./tombstone";

export interface AtomicActionReservationInput {
  readonly binding: SignerBinding;
  readonly capturedContextEpoch: number;
  readonly clock: ClockGateInput;
  readonly preparedAction: Omit<
    PreparedActionInput,
    | "network"
    | "masterAccount"
    | "targetAccount"
    | "agentAddress"
    | "signerGeneration"
    | "capturedContextEpoch"
    | "nonce"
    | "expiresAfterMs"
    | "preparedAt"
  >;
}

/**
 * Synchronous fence owned by the mobile context supervisor. Implementations
 * compare the captured epoch and run `commit` while the same supervisor lock is
 * held, so an account, target, or network switch cannot interleave with the
 * SQLite reservation transaction.
 */
export interface ContextEpochAuthority {
  commitIfCurrent<T>(
    input: {
      readonly binding: SignerBinding;
      readonly capturedContextEpoch: number;
    },
    commit: () => T,
  ): T;
}

export interface SignerScopeRegistration {
  readonly binding: SignerBinding;
  readonly activatedAt: number;
}

export interface NonceAndJournalRepository {
  registerActiveSignerScope(input: SignerScopeRegistration): void;
  reservePreparedAction(
    input: AtomicActionReservationInput,
  ): PreparedActionRecord;
  markSignerRetiring(binding: SignerBinding, now: number): void;
  retireSignerScope(
    binding: SignerBinding,
    tombstone: RetiredSignerTombstoneInput,
  ): RetiredSignerTombstone;
}
