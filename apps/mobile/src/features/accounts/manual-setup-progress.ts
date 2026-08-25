import type { HyperliquidNetwork } from "@hyper-trader/hyperliquid";

import { LOWERCASE_HASH_PATTERN } from "../../platform/persistence/validation";
import {
  AGENT_REGISTRATION_NAME_PATTERN,
  CONNECTOR_SESSION_PATTERN,
  normalizeAgentRegistrationName,
} from "../../platform/wallet/setup-identifiers";
import {
  AGENT_AUTHORIZATION_DURATION_MS,
  bindingFromAttempt,
  normalizeSetupAddress,
  SETUP_ATTEMPT_DURATION_MS,
  type SetupAttempt,
} from "./setup-coordinator";

export const MANUAL_SETUP_PROGRESS_KEY =
  "@hyper-trader/manual-api-wallet-setup:v1";

export type ManualSetupProgress =
  | {
      readonly version: 2;
      readonly phase: "protection";
      readonly network: HyperliquidNetwork;
      readonly masterAccount: string;
      readonly registrationName: string;
      readonly updatedAt: number;
    }
  | {
      readonly version: 2;
      readonly phase: "authorization";
      readonly attempt: SetupAttempt;
      readonly updatedAt: number;
    };

export interface ManualSetupProgressStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface ManualSetupProgressRepository {
  load(): Promise<ManualSetupProgress | null>;
  saveProtection(
    network: HyperliquidNetwork,
    masterAccount: string,
    registrationName: string,
    now: number,
  ): Promise<void>;
  saveAuthorization(attempt: SetupAttempt, now: number): Promise<void>;
  clear(): Promise<void>;
}

function exactObject(
  value: unknown,
  keys: readonly string[],
  field: string,
): Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new Error(`${field} is malformed.`);
  }
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record);
  if (
    actual.length !== keys.length ||
    actual.some((key) => !keys.includes(key))
  ) {
    throw new Error(`${field} is malformed.`);
  }
  return record;
}

function positiveTime(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} is malformed.`);
  }
  return value;
}

function parseAttempt(value: unknown): SetupAttempt {
  const input = exactObject(
    value,
    [
      "id",
      "network",
      "connectorSessionId",
      "masterAccount",
      "targetAccount",
      "agentAddress",
      "registrationName",
      "registrationGeneration",
      "approvalNonce",
      "requestedExpiry",
      "createdAt",
      "expiresAt",
    ],
    "The saved API-wallet attempt",
  );
  const attempt = input as unknown as SetupAttempt;
  bindingFromAttempt(attempt);
  if (
    (attempt.network !== "testnet" && attempt.network !== "mainnet") ||
    !LOWERCASE_HASH_PATTERN.test(attempt.id) ||
    !CONNECTOR_SESSION_PATTERN.test(attempt.connectorSessionId) ||
    attempt.masterAccount !== normalizeSetupAddress(attempt.masterAccount) ||
    attempt.targetAccount !== attempt.masterAccount ||
    attempt.agentAddress !== normalizeSetupAddress(attempt.agentAddress) ||
    !AGENT_REGISTRATION_NAME_PATTERN.test(attempt.registrationName) ||
    !Number.isSafeInteger(attempt.registrationGeneration) ||
    attempt.registrationGeneration < 1 ||
    positiveTime(attempt.approvalNonce, "approvalNonce") !==
      positiveTime(attempt.createdAt, "createdAt") ||
    positiveTime(attempt.expiresAt, "expiresAt") - attempt.createdAt !==
      SETUP_ATTEMPT_DURATION_MS ||
    positiveTime(attempt.requestedExpiry, "requestedExpiry") -
      attempt.approvalNonce !==
      AGENT_AUTHORIZATION_DURATION_MS
  ) {
    throw new Error("The saved API-wallet attempt is malformed.");
  }
  return attempt;
}

export function parseManualSetupProgress(
  serialized: string | null,
): ManualSetupProgress | null {
  if (serialized === null) return null;
  if (serialized.length > 8 * 1024) {
    throw new Error("The saved setup progress is too large.");
  }
  const input = JSON.parse(serialized) as unknown;
  const phase = (input as { phase?: unknown })?.phase;
  const hasRegistrationName =
    typeof input === "object" &&
    input !== null &&
    Object.hasOwn(input, "registrationName");
  const version = (input as { version?: unknown })?.version;
  const base = exactObject(
    input,
    phase === "authorization"
      ? ["version", "phase", "attempt", "updatedAt"]
      : hasRegistrationName
        ? version === 2
          ? [
              "version",
              "phase",
              "network",
              "masterAccount",
              "registrationName",
              "updatedAt",
            ]
          : [
              "version",
              "phase",
              "masterAccount",
              "registrationName",
              "updatedAt",
            ]
        : ["version", "phase", "masterAccount", "updatedAt"],
    "The saved setup progress",
  );
  if (base.version !== 1 && base.version !== 2) {
    throw new Error("The saved setup progress version is unsupported.");
  }
  const updatedAt = positiveTime(base.updatedAt, "updatedAt");
  if (base.phase === "protection") {
    if (typeof base.masterAccount !== "string") {
      throw new Error("The saved master account is malformed.");
    }
    return {
      version: 2,
      phase: "protection",
      network:
        base.version === 1
          ? "testnet"
          : base.network === "mainnet" || base.network === "testnet"
            ? base.network
            : (() => {
                throw new Error("The saved setup network is malformed.");
              })(),
      masterAccount: normalizeSetupAddress(base.masterAccount),
      registrationName:
        typeof base.registrationName === "string"
          ? normalizeAgentRegistrationName(base.registrationName)
          : "",
      updatedAt,
    };
  }
  if (base.phase === "authorization") {
    const attempt = parseAttempt(base.attempt);
    if (base.version === 1 && attempt.network !== "testnet") {
      throw new Error("Legacy setup progress must use testnet.");
    }
    return {
      version: 2,
      phase: "authorization",
      attempt,
      updatedAt,
    };
  }
  throw new Error("The saved setup phase is unsupported.");
}

export function createManualSetupProgressRepository(
  storage: ManualSetupProgressStorage,
): ManualSetupProgressRepository {
  const save = async (progress: ManualSetupProgress) => {
    await storage.setItem(MANUAL_SETUP_PROGRESS_KEY, JSON.stringify(progress));
  };
  return {
    async load() {
      return parseManualSetupProgress(
        await storage.getItem(MANUAL_SETUP_PROGRESS_KEY),
      );
    },
    saveProtection(network, masterAccount, registrationName, now) {
      if (network !== "mainnet" && network !== "testnet") {
        throw new Error("The setup network is malformed.");
      }
      return save({
        version: 2,
        phase: "protection",
        network,
        masterAccount: normalizeSetupAddress(masterAccount),
        registrationName: normalizeAgentRegistrationName(registrationName),
        updatedAt: positiveTime(now, "updatedAt"),
      });
    },
    saveAuthorization(attempt, now) {
      return save({
        version: 2,
        phase: "authorization",
        attempt: parseAttempt(attempt),
        updatedAt: positiveTime(now, "updatedAt"),
      });
    },
    clear: () => storage.removeItem(MANUAL_SETUP_PROGRESS_KEY),
  };
}
