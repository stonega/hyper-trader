import type { TradingContextCore } from "../context/supervisor";
import { contextIdentityKey } from "../context/supervisor";

export interface DraftContextInput {
  readonly context: TradingContextCore;
  readonly marketCanonicalId: string;
  readonly metadataFingerprint: string;
}

export interface DraftContextBinding {
  readonly context: TradingContextCore;
  readonly contextKey: string;
  readonly marketCanonicalId: string;
  readonly metadataFingerprint: string;
}

export type DraftInvalidationReason =
  | "account_changed"
  | "network_changed"
  | "market_changed"
  | "market_metadata_changed";

export type DraftContextValidation =
  | { readonly valid: true }
  | {
      readonly valid: false;
      readonly reason: DraftInvalidationReason;
      readonly message: string;
    };

const invalidationMessages: Readonly<Record<DraftInvalidationReason, string>> =
  {
    account_changed: "The active account changed. Review this order again.",
    network_changed: "The active network changed. Review this order again.",
    market_changed: "The selected market changed. Review this order again.",
    market_metadata_changed:
      "Market trading rules changed. Refresh the order and review it again.",
  };

export function bindDraftContext(
  input: DraftContextInput,
): DraftContextBinding {
  return {
    context: input.context,
    contextKey: contextIdentityKey(input.context),
    marketCanonicalId: input.marketCanonicalId,
    metadataFingerprint: input.metadataFingerprint,
  };
}

function invalid(reason: DraftInvalidationReason): DraftContextValidation {
  return { valid: false, reason, message: invalidationMessages[reason] };
}

export function validateDraftContext(
  binding: DraftContextBinding,
  current: DraftContextInput,
): DraftContextValidation {
  if (binding.context.network !== current.context.network) {
    return invalid("network_changed");
  }
  if (binding.contextKey !== contextIdentityKey(current.context)) {
    return invalid("account_changed");
  }
  if (binding.marketCanonicalId !== current.marketCanonicalId) {
    return invalid("market_changed");
  }
  if (binding.metadataFingerprint !== current.metadataFingerprint) {
    return invalid("market_metadata_changed");
  }
  return { valid: true };
}
