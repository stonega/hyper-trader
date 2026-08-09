import { LOWERCASE_HASH_PATTERN } from "../persistence/validation";

export const CONNECTOR_SESSION_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
export const AGENT_REGISTRATION_NAME_PATTERN = /^ht-[0-9a-f]{13}$/;

export function isSetupAttemptId(value: string): value is `0x${string}` {
  return LOWERCASE_HASH_PATTERN.test(value);
}

export function isConnectorSessionId(value: string): boolean {
  return CONNECTOR_SESSION_PATTERN.test(value);
}
