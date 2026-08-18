import { LOWERCASE_HASH_PATTERN } from "../persistence/validation";

export const CONNECTOR_SESSION_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
export const AGENT_REGISTRATION_NAME_PATTERN =
  /^[\x21-\x7e](?:[\x20-\x7e]{0,14}[\x21-\x7e])?$/;

export function normalizeAgentRegistrationName(value: string): string {
  const normalized = value.trim();
  if (!AGENT_REGISTRATION_NAME_PATTERN.test(normalized)) {
    throw new TypeError(
      "The API-wallet registration name must contain 1 to 16 printable characters.",
    );
  }
  return normalized;
}

export function isSetupAttemptId(value: string): value is `0x${string}` {
  return LOWERCASE_HASH_PATTERN.test(value);
}

export function isConnectorSessionId(value: string): boolean {
  return CONNECTOR_SESSION_PATTERN.test(value);
}
