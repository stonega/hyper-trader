import type { TradingContextCore } from "../context/supervisor";
import {
  type DraftContextBinding,
  type DraftContextInput,
  type DraftContextValidation,
  validateDraftContext,
} from "./draft-context";

export interface DraftInvalidationRegistry {
  register(
    binding: DraftContextBinding,
    onInvalidated: (
      result: Exclude<DraftContextValidation, { valid: true }>,
    ) => void,
  ): () => void;
  invalidateForContext(context: TradingContextCore): void;
  invalidateForMarket(input: DraftContextInput): void;
}

interface DraftRegistration {
  readonly binding: DraftContextBinding;
  readonly onInvalidated: (
    result: Exclude<DraftContextValidation, { valid: true }>,
  ) => void;
}

export function createDraftInvalidationRegistry(): DraftInvalidationRegistry {
  const registrations = new Set<DraftRegistration>();

  const invalidate = (
    registration: DraftRegistration,
    input: DraftContextInput,
  ) => {
    const result = validateDraftContext(registration.binding, input);
    if (!result.valid) {
      registration.onInvalidated(result);
      registrations.delete(registration);
    }
  };

  return {
    register(binding, onInvalidated) {
      const registration = { binding, onInvalidated };
      registrations.add(registration);
      return () => registrations.delete(registration);
    },
    invalidateForContext(context) {
      for (const registration of [...registrations]) {
        invalidate(registration, {
          context,
          marketCanonicalId: registration.binding.marketCanonicalId,
          metadataFingerprint: registration.binding.metadataFingerprint,
        });
      }
    },
    invalidateForMarket(input) {
      for (const registration of [...registrations]) {
        invalidate(registration, input);
      }
    },
  };
}
