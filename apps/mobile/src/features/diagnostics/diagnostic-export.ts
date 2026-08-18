import {
  JOURNAL_ACTION_TYPES,
  JOURNAL_STATES,
  type JournalActionType,
  type JournalState,
} from "@hyper-trader/hyperliquid";

import type { SignerSessionStopReason } from "../../core/session/manager";
import {
  CORRELATION_ID_PATTERN,
  LOWERCASE_HASH_PATTERN,
} from "../../platform/persistence/validation";
import {
  AGENT_REGISTRATION_STATES,
  type AgentRegistrationState,
} from "../accounts/account-scope";

type DiagnosticObject = Record<string, unknown>;

const SESSION_STATUSES = ["locked", "unlocking", "unlocked"] as const;
const SESSION_REASONS = [
  "app_inactive",
  "app_background",
  "android_blur",
  "context_changed",
  "manual",
  "timeout",
  "memory_warning",
  "app_terminated",
  "authentication_error",
  "credential_invalidated",
  "compromised_device",
] as const satisfies readonly SignerSessionStopReason[];
const TOKEN_STATES = ["absent", "registered", "revoked", "error"] as const;

type DiagnosticSessionStatus = (typeof SESSION_STATUSES)[number];
type DiagnosticTokenState = (typeof TOKEN_STATES)[number];

export interface RedactedDiagnosticExport {
  readonly schema: "hyper-trader-diagnostics/v1";
  readonly generatedAtMs: number;
  readonly appVersion: string | null;
  readonly buildVersion: string | null;
  readonly network: "mainnet" | "testnet" | null;
  readonly account: {
    readonly masterSuffix: string;
    readonly targetSuffix: string;
    readonly agentSuffix: string | null;
    readonly generation: number | null;
    readonly registrationState: AgentRegistrationState;
  } | null;
  readonly session: {
    readonly status: DiagnosticSessionStatus;
    readonly reason: SignerSessionStopReason | null;
  } | null;
  readonly actions: readonly {
    readonly correlationId: string;
    readonly actionType: JournalActionType;
    readonly state: JournalState;
    readonly intentDigest: string;
    readonly observedAtMs: number;
  }[];
  readonly notification: {
    readonly tokenState: DiagnosticTokenState;
    readonly tokenSuffix: string | null;
  } | null;
}

function object(value: unknown): DiagnosticObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as DiagnosticObject)
    : null;
}

function requiredTime(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(
      `${field} must be a non-negative millisecond timestamp.`,
    );
  }
  return value as number;
}

function boundedString(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= max ? normalized : null;
}

function requiredEnum<T extends string>(
  value: unknown,
  values: readonly T[],
  field: string,
): T {
  if (typeof value !== "string" || !values.includes(value as T)) {
    throw new TypeError(`${field} is malformed.`);
  }
  return value as T;
}

function addressSuffix(value: unknown): string {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new TypeError("A diagnostic account address is malformed.");
  }
  return value.toLowerCase().slice(-6);
}

function redactedAddressSuffix(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{6}$/.test(value)) {
    throw new TypeError(`${field} is malformed.`);
  }
  return value;
}

function safeRedactedAccount(
  value: unknown,
): RedactedDiagnosticExport["account"] {
  const input = object(value);
  if (!input) return null;
  const generation = input.generation;
  if (
    generation !== null &&
    generation !== undefined &&
    (!Number.isSafeInteger(generation) || (generation as number) < 1)
  ) {
    throw new TypeError("The diagnostic registration generation is malformed.");
  }
  return {
    masterSuffix: redactedAddressSuffix(
      input.masterSuffix,
      "The diagnostic master suffix",
    ),
    targetSuffix: redactedAddressSuffix(
      input.targetSuffix,
      "The diagnostic target suffix",
    ),
    agentSuffix:
      input.agentSuffix === null || input.agentSuffix === undefined
        ? null
        : redactedAddressSuffix(
            input.agentSuffix,
            "The diagnostic agent suffix",
          ),
    generation: (generation as number | null | undefined) ?? null,
    registrationState: requiredEnum(
      input.registrationState,
      AGENT_REGISTRATION_STATES,
      "The diagnostic registration state",
    ),
  };
}

function safeAccount(value: unknown): RedactedDiagnosticExport["account"] {
  const input = object(value);
  if (!input) return null;
  const generation = input.generation;
  if (
    generation !== null &&
    generation !== undefined &&
    (!Number.isSafeInteger(generation) || (generation as number) < 1)
  ) {
    throw new TypeError("The diagnostic registration generation is malformed.");
  }
  return {
    masterSuffix: addressSuffix(input.masterAccount),
    targetSuffix: addressSuffix(input.targetAccount),
    agentSuffix:
      input.agentAddress === null || input.agentAddress === undefined
        ? null
        : addressSuffix(input.agentAddress),
    generation: (generation as number | null | undefined) ?? null,
    registrationState: requiredEnum(
      input.registrationState,
      AGENT_REGISTRATION_STATES,
      "The diagnostic registration state",
    ),
  };
}

function safeSession(value: unknown): RedactedDiagnosticExport["session"] {
  const input = object(value);
  if (!input) return null;
  const status = requiredEnum(
    input.status,
    SESSION_STATUSES,
    "The diagnostic session status",
  );
  const reason =
    input.reason === null || input.reason === undefined
      ? null
      : requiredEnum(
          input.reason,
          SESSION_REASONS,
          "The diagnostic session reason",
        );
  return {
    status,
    reason,
  };
}

function safeActions(value: unknown): RedactedDiagnosticExport["actions"] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).map((candidate) => {
    const input = object(candidate);
    if (!input)
      throw new TypeError("A diagnostic action summary is malformed.");
    const correlationId = input.correlationId;
    const actionType = requiredEnum(
      input.actionType,
      JOURNAL_ACTION_TYPES,
      "The diagnostic action type",
    );
    const state = requiredEnum(
      input.state,
      JOURNAL_STATES,
      "The diagnostic action state",
    );
    const intentDigest = boundedString(input.intentDigest, 66);
    if (
      typeof correlationId !== "string" ||
      !CORRELATION_ID_PATTERN.test(correlationId) ||
      !intentDigest ||
      !LOWERCASE_HASH_PATTERN.test(intentDigest)
    ) {
      throw new TypeError("A diagnostic action summary is malformed.");
    }
    return {
      correlationId,
      actionType,
      state,
      intentDigest,
      observedAtMs: requiredTime(input.observedAtMs, "action.observedAtMs"),
    };
  });
}

function safeNotification(
  value: unknown,
): RedactedDiagnosticExport["notification"] {
  const input = object(value);
  if (!input) return null;
  const tokenState = requiredEnum(
    input.tokenState,
    TOKEN_STATES,
    "The diagnostic notification state",
  );
  const tokenSuffix =
    input.tokenSuffix === null || input.tokenSuffix === undefined
      ? null
      : boundedString(input.tokenSuffix, 8);
  if (
    (input.tokenSuffix !== null &&
      input.tokenSuffix !== undefined &&
      tokenSuffix === null) ||
    (tokenSuffix !== null && !/^[A-Za-z0-9_-]{4,8}$/.test(tokenSuffix))
  ) {
    throw new TypeError("The push token suffix is malformed.");
  }
  return { tokenState, tokenSuffix };
}

export function buildRedactedDiagnosticExport(
  value: unknown,
): RedactedDiagnosticExport {
  const input = object(value);
  if (!input) throw new TypeError("The diagnostic input is malformed.");
  const network = input.network;
  if (network !== undefined && network !== "mainnet" && network !== "testnet") {
    throw new TypeError("The diagnostic network is malformed.");
  }
  return {
    schema: "hyper-trader-diagnostics/v1",
    generatedAtMs: requiredTime(input.generatedAtMs, "generatedAtMs"),
    appVersion: boundedString(input.appVersion, 32),
    buildVersion: boundedString(input.buildVersion, 32),
    network: network ?? null,
    account: safeAccount(input.account),
    session: safeSession(input.session),
    actions: safeActions(input.actions),
    notification: safeNotification(input.notification),
  };
}

export function diagnosticExportJson(bundle: RedactedDiagnosticExport): string {
  const input = object(bundle);
  if (input?.schema !== "hyper-trader-diagnostics/v1") {
    throw new TypeError("The redacted diagnostic bundle is malformed.");
  }
  const network = input.network;
  if (network !== null && network !== "mainnet" && network !== "testnet") {
    throw new TypeError("The diagnostic network is malformed.");
  }
  const allowlisted: RedactedDiagnosticExport = {
    schema: "hyper-trader-diagnostics/v1",
    generatedAtMs: requiredTime(input.generatedAtMs, "generatedAtMs"),
    appVersion: boundedString(input.appVersion, 32),
    buildVersion: boundedString(input.buildVersion, 32),
    network,
    account: safeRedactedAccount(input.account),
    session: safeSession(input.session),
    actions: safeActions(input.actions),
    notification: safeNotification(input.notification),
  };
  return JSON.stringify(allowlisted, null, 2);
}
