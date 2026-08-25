import {
  assertKnownActionNetwork,
  assertSignerAccessCapability,
  assertSignerBinding,
  type HyperliquidNetwork,
  normalizeSignerBinding,
  type SignerBinding,
} from "@hyper-trader/hyperliquid";
import { hexToBytes, keccak256, stringToHex, toHex } from "viem";
import type { ProtectedAgentSecret } from "../../core/session/manager";
import type { AgentCredentialVault } from "../../features/accounts/setup-coordinator";
import {
  LOWERCASE_ADDRESS_PATTERN,
  LOWERCASE_HASH_PATTERN,
} from "../persistence/validation";
import { AGENT_REGISTRATION_NAME_PATTERN } from "../wallet/setup-identifiers";
import { isValidSecp256k1Secret } from "./secret-material";

const SECRET_SERVICE = "hypertrader.api-wallet.v1";
const MANIFEST_SERVICE = "hypertrader.custody-manifest.v1";
const MANIFEST_KEY = "hypertrader.custody-manifest.v1";

export interface CustodyManifestRecord {
  readonly bindingId: `0x${string}`;
  readonly network: HyperliquidNetwork;
  readonly agentAddress: string;
  readonly generation: number;
  readonly recordVersion: 1;
}

export interface CustodyManifest {
  readonly version: 1;
  readonly installationEpoch: string;
  readonly records: readonly CustodyManifestRecord[];
}

export type CustodyInstallAssessment =
  | { readonly status: "clean" }
  | { readonly status: "quarantine"; readonly reason: "surviving_credentials" };

export class CredentialUnavailableError extends Error {
  readonly code:
    | "missing_or_invalidated"
    | "authentication_failed"
    | "malformed_record";

  constructor(code: CredentialUnavailableError["code"]) {
    super("The protected API-wallet credential is unavailable.");
    this.name = "CredentialUnavailableError";
    this.code = code;
  }
}

interface SecureStoreOptionsLike {
  readonly keychainService: string;
  readonly requireAuthentication?: boolean;
  readonly authenticationPrompt?: string;
  readonly keychainAccessible?: number;
}

export interface SecureStorePort {
  readonly whenPasscodeSetThisDeviceOnly?: number;
  setItem(
    key: string,
    value: string,
    options: SecureStoreOptionsLike,
  ): Promise<void>;
  getItem(key: string, options: SecureStoreOptionsLike): Promise<string | null>;
  deleteItem(key: string, options: SecureStoreOptionsLike): Promise<void>;
}

function decodeSecret(value: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new CredentialUnavailableError("malformed_record");
  }
  return hexToBytes(`0x${value}`);
}

export function custodyBindingId(bindingInput: SignerBinding): `0x${string}` {
  const binding = normalizeSignerBinding(bindingInput);
  return keccak256(
    stringToHex(
      [
        "hyper-trader-custody-binding/v1",
        binding.network,
        binding.masterAccount,
        binding.targetAccount,
        binding.agentAddress,
        String(binding.generation),
      ].join("\0"),
    ),
  );
}

function credentialKey(binding: SignerBinding): string {
  return `agent.${custodyBindingId(binding).slice(2)}`;
}

function protectedOptions(store: SecureStorePort): SecureStoreOptionsLike {
  return {
    keychainService: SECRET_SERVICE,
    requireAuthentication: true,
    authenticationPrompt: "Unlock your Hyper Trader signing session",
    ...(store.whenPasscodeSetThisDeviceOnly === undefined
      ? {}
      : { keychainAccessible: store.whenPasscodeSetThisDeviceOnly }),
  };
}

function manifestOptions(store: SecureStorePort): SecureStoreOptionsLike {
  return {
    keychainService: MANIFEST_SERVICE,
    ...(store.whenPasscodeSetThisDeviceOnly === undefined
      ? {}
      : { keychainAccessible: store.whenPasscodeSetThisDeviceOnly }),
  };
}

function validateManifest(value: unknown): CustodyManifest {
  if (typeof value !== "object" || value === null) {
    throw new CredentialUnavailableError("malformed_record");
  }
  const record = value as Partial<CustodyManifest>;
  if (
    record.version !== 1 ||
    typeof record.installationEpoch !== "string" ||
    !/^[A-Za-z0-9_-]{16,128}$/.test(record.installationEpoch) ||
    !Array.isArray(record.records)
  ) {
    throw new CredentialUnavailableError("malformed_record");
  }
  for (const entry of record.records) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      (entry.network !== "testnet" && entry.network !== "mainnet") ||
      entry.recordVersion !== 1 ||
      !LOWERCASE_HASH_PATTERN.test(entry.bindingId) ||
      !LOWERCASE_ADDRESS_PATTERN.test(entry.agentAddress) ||
      !Number.isSafeInteger(entry.generation) ||
      entry.generation < 1
    ) {
      throw new CredentialUnavailableError("malformed_record");
    }
  }
  return record as CustodyManifest;
}

async function readManifest(
  store: SecureStorePort,
): Promise<CustodyManifest | null> {
  const serialized = await store.getItem(MANIFEST_KEY, manifestOptions(store));
  if (serialized === null) return null;
  try {
    return validateManifest(JSON.parse(serialized));
  } catch (error) {
    if (error instanceof CredentialUnavailableError) throw error;
    throw new CredentialUnavailableError("malformed_record");
  }
}

function material(
  binding: SignerBinding,
  bytes: Uint8Array,
): ProtectedAgentSecret {
  let disposed = false;
  return {
    binding,
    bytes,
    dispose() {
      if (disposed) return;
      disposed = true;
      bytes.fill(0);
    },
  };
}

export interface CredentialVault extends AgentCredentialVault {
  read(binding: SignerBinding): Promise<ProtectedAgentSecret>;
  readManifest(): Promise<CustodyManifest | null>;
}

export function createCredentialVault(options: {
  readonly store: SecureStorePort;
  readonly installationEpoch: string;
}): CredentialVault {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(options.installationEpoch)) {
    throw new TypeError("The installation epoch is malformed.");
  }
  const store = options.store;
  return {
    async stage(input) {
      const binding = normalizeSignerBinding(input.binding);
      assertSignerAccessCapability(binding.network);
      const key = credentialKey(binding);
      if (
        !AGENT_REGISTRATION_NAME_PATTERN.test(input.registrationName) ||
        !Number.isSafeInteger(input.requestedExpiry) ||
        input.requestedExpiry <= 0 ||
        !isValidSecp256k1Secret(input.secret.bytes)
      ) {
        throw new TypeError("The protected credential metadata is malformed.");
      }
      const secretHex = toHex(input.secret.bytes).slice(2);
      const serialized = JSON.stringify({
        version: 1,
        binding,
        registrationName: input.registrationName,
        requestedExpiry: input.requestedExpiry,
        secretHex,
      });
      const existing = await readManifest(store);
      if (
        existing !== null &&
        existing.installationEpoch !== options.installationEpoch
      ) {
        throw new CredentialUnavailableError("malformed_record");
      }
      const entry: CustodyManifestRecord = {
        bindingId: custodyBindingId(binding),
        network: binding.network,
        agentAddress: binding.agentAddress,
        generation: binding.generation,
        recordVersion: 1,
      };
      const records = [...(existing?.records ?? [])];
      if (!records.some((record) => record.bindingId === entry.bindingId)) {
        records.push(entry);
      }
      const nextManifest = JSON.stringify({
        version: 1,
        installationEpoch: options.installationEpoch,
        records,
      } satisfies CustodyManifest);
      await store.setItem(MANIFEST_KEY, nextManifest, manifestOptions(store));
      try {
        await store.setItem(key, serialized, protectedOptions(store));
      } catch (error) {
        // A manifest-first checkpoint makes interruption detectable. If the
        // protected write reports failure, restore the exact prior manifest.
        if (existing === null) {
          await store.deleteItem(MANIFEST_KEY, manifestOptions(store));
        } else {
          await store.setItem(
            MANIFEST_KEY,
            JSON.stringify(existing),
            manifestOptions(store),
          );
        }
        throw error;
      }
    },
    async read(bindingInput) {
      assertSignerAccessCapability(bindingInput.network);
      const binding = normalizeSignerBinding(bindingInput);
      let serialized: string | null;
      try {
        serialized = await store.getItem(
          credentialKey(binding),
          protectedOptions(store),
        );
      } catch {
        throw new CredentialUnavailableError("authentication_failed");
      }
      if (serialized === null) {
        throw new CredentialUnavailableError("missing_or_invalidated");
      }
      try {
        const parsed = JSON.parse(serialized) as {
          readonly version?: unknown;
          readonly binding?: SignerBinding;
          readonly registrationName?: unknown;
          readonly requestedExpiry?: unknown;
          readonly secretHex?: unknown;
        };
        if (
          parsed.version !== 1 ||
          !parsed.binding ||
          typeof parsed.registrationName !== "string" ||
          !AGENT_REGISTRATION_NAME_PATTERN.test(parsed.registrationName) ||
          !Number.isSafeInteger(parsed.requestedExpiry) ||
          (parsed.requestedExpiry as number) <= 0 ||
          typeof parsed.secretHex !== "string"
        ) {
          throw new CredentialUnavailableError("malformed_record");
        }
        assertSignerBinding(binding, parsed.binding);
        const bytes = decodeSecret(parsed.secretHex);
        if (!isValidSecp256k1Secret(bytes)) {
          bytes.fill(0);
          throw new CredentialUnavailableError("malformed_record");
        }
        return material(binding, bytes);
      } catch (error) {
        if (error instanceof CredentialUnavailableError) throw error;
        throw new CredentialUnavailableError("malformed_record");
      }
    },
    async delete(bindingInput) {
      assertKnownActionNetwork(bindingInput.network);
      const binding = normalizeSignerBinding(bindingInput);
      await store.deleteItem(credentialKey(binding), protectedOptions(store));
      const existing = await readManifest(store);
      if (existing === null) return;
      const bindingId = custodyBindingId(binding);
      await store.setItem(
        MANIFEST_KEY,
        JSON.stringify({
          ...existing,
          records: existing.records.filter(
            (record) => record.bindingId !== bindingId,
          ),
        } satisfies CustodyManifest),
        manifestOptions(store),
      );
    },
    readManifest: () => readManifest(store),
  };
}

export function assessCustodyInstall(input: {
  readonly installSentinelPresent: boolean;
  readonly manifest: CustodyManifest | null;
}): CustodyInstallAssessment {
  return !input.installSentinelPresent &&
    (input.manifest?.records.length ?? 0) > 0
    ? { status: "quarantine", reason: "surviving_credentials" }
    : { status: "clean" };
}

export async function createExpoSecureStorePort(): Promise<SecureStorePort> {
  const store = await import("expo-secure-store");
  return {
    whenPasscodeSetThisDeviceOnly: store.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
    setItem: (key, value, secureOptions) =>
      store.setItemAsync(key, value, secureOptions),
    getItem: (key, secureOptions) => store.getItemAsync(key, secureOptions),
    deleteItem: (key, secureOptions) =>
      store.deleteItemAsync(key, secureOptions),
  };
}
