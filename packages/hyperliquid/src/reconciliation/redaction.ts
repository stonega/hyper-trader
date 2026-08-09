import { HyperliquidValidationError } from "../errors";
import type {
  JournalActionType,
  JournalState,
  SecretFreeIntent,
} from "./types";
import { JOURNAL_ACTION_TYPES, JOURNAL_STATES } from "./types";

const FORBIDDEN_KEY =
  /(?:private.?key|seed|mnemonic|secret|signature|signed.?payload|signing.?payload|action.?bytes|preimage|exchange.?body)/i;
const MAX_INTENT_BYTES = 32_768;
const ACTION_TYPES: ReadonlySet<string> = new Set(JOURNAL_ACTION_TYPES);
const JOURNAL_STATE_SET: ReadonlySet<string> = new Set(JOURNAL_STATES);

function validateValue(value: unknown, path: string, depth: number): void {
  if (depth > 12) {
    throw new HyperliquidValidationError(path, "intent nesting is too deep");
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isSafeInteger(value))
  ) {
    return;
  }
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      validateValue(item, `${path}[${index}]`, depth + 1);
    }
    return;
  }
  if (
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    for (const [key, item] of Object.entries(value)) {
      if (FORBIDDEN_KEY.test(key)) {
        throw new HyperliquidValidationError(
          `${path}.${key}`,
          "forbidden signing or secret material",
        );
      }
      validateValue(item, `${path}.${key}`, depth + 1);
    }
    return;
  }
  throw new HyperliquidValidationError(
    path,
    "intent contains an unsupported value",
  );
}

export function serializeSecretFreeIntent(value: unknown): string {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new HyperliquidValidationError(
      "intent",
      "expected a plain secret-free intent object",
    );
  }
  validateValue(value, "intent", 0);
  const serialized = JSON.stringify(value);
  if (new TextEncoder().encode(serialized).length > MAX_INTENT_BYTES) {
    throw new HyperliquidValidationError("intent", "intent exceeds 32 KiB");
  }
  return serialized;
}

export function assertSecretFreeIntent(
  value: unknown,
): asserts value is SecretFreeIntent {
  serializeSecretFreeIntent(value);
}

export interface RedactedActionEvent {
  readonly correlationId: string;
  readonly actionType: JournalActionType;
  readonly state: JournalState;
  readonly intentDigest: `0x${string}`;
  readonly network: "mainnet" | "testnet";
  readonly agentAddressSuffix: string;
  readonly timestamp: number;
}

export function createRedactedActionEvent(
  input: RedactedActionEvent,
): RedactedActionEvent {
  if (!/^act_[0-9a-f]{32}$/.test(input.correlationId)) {
    throw new HyperliquidValidationError(
      "correlationId",
      "expected an opaque action correlation ID",
    );
  }
  if (!/^0x[0-9a-f]{64}$/.test(input.intentDigest)) {
    throw new HyperliquidValidationError(
      "intentDigest",
      "expected a lowercase 32-byte digest",
    );
  }
  if (!/^0x[0-9a-f]{8}$/i.test(input.agentAddressSuffix)) {
    throw new HyperliquidValidationError(
      "agentAddressSuffix",
      "expected only the final four address bytes",
    );
  }
  if (!ACTION_TYPES.has(input.actionType)) {
    throw new HyperliquidValidationError("actionType", "unknown action type");
  }
  if (!JOURNAL_STATE_SET.has(input.state)) {
    throw new HyperliquidValidationError("state", "unknown journal state");
  }
  if (
    (input.network !== "mainnet" && input.network !== "testnet") ||
    !Number.isSafeInteger(input.timestamp) ||
    input.timestamp < 0
  ) {
    throw new HyperliquidValidationError(
      "event",
      "invalid network or timestamp",
    );
  }
  return { ...input };
}
