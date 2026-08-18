import {
  assertTestnetSigningCapability,
  buildApproveAgentTypedData,
  type NetworkTypedData,
  normalizeSignerBinding,
  type SignerBinding,
} from "@hyper-trader/hyperliquid";
import { getAddress, toHex } from "viem";

import { isValidSecp256k1Secret } from "../../platform/security/secret-material";
import {
  isConnectorSessionId,
  normalizeAgentRegistrationName,
} from "../../platform/wallet/setup-identifiers";

export const AGENT_AUTHORIZATION_DURATION_MS = 30 * 24 * 60 * 60 * 1_000;
export const SETUP_ATTEMPT_DURATION_MS = 24 * 60 * 60 * 1_000;
const AUTHORITY_TIME_TOLERANCE_MS = 5_000;

export interface SecretMaterial {
  readonly bytes: Uint8Array;
  dispose(): void;
}

export interface SetupAttempt {
  readonly id: `0x${string}`;
  readonly network: "testnet";
  readonly connectorSessionId: string;
  readonly masterAccount: string;
  readonly targetAccount: string;
  readonly agentAddress: string;
  readonly registrationName: string;
  readonly registrationGeneration: number;
  readonly approvalNonce: number;
  readonly requestedExpiry: number;
  readonly createdAt: number;
  readonly expiresAt: number;
}

export interface SetupRepository {
  nextGeneration(input: {
    readonly network: "testnet";
    readonly masterAccount: string;
    readonly targetAccount: string;
  }): number;
  createAttempt(attempt: SetupAttempt): void;
  getPendingAttempt(id: string): SetupAttempt | null;
  getPendingAttemptForTarget(input: {
    readonly network: "testnet";
    readonly masterAccount: string;
    readonly targetAccount: string;
  }): SetupAttempt | null;
  consumeAndActivate(input: {
    readonly attemptId: string;
    readonly expected: SetupAttempt;
    readonly effectiveExpiry: number;
    readonly now: number;
  }): boolean;
  cancelAttempt(id: string, reason?: string): void;
}

export interface AgentCredentialVault {
  stage(input: {
    readonly binding: SignerBinding;
    readonly registrationName: string;
    readonly requestedExpiry: number;
    readonly secret: SecretMaterial;
  }): Promise<void>;
  delete(binding: SignerBinding): Promise<void>;
}

export interface NamedAgentRegistration {
  readonly agentAddress: string;
  readonly registrationName: string;
  readonly validUntil: number | null;
}

export interface AgentRegistrationAuthority {
  inspect(input: {
    readonly network: "testnet";
    readonly masterAccount: string;
    readonly targetAccount: string;
  }): Promise<{
    readonly authoritativeTime: number;
    readonly targetAuthorized: boolean;
    readonly targetKind: "master" | "subaccount" | "vault";
    readonly namedAgentLimit: number;
    readonly namedAgents: readonly NamedAgentRegistration[];
  }>;
  verify(input: {
    readonly network: "testnet";
    readonly masterAccount: string;
    readonly targetAccount: string;
    readonly agentAddress: string;
  }): Promise<{
    readonly authoritativeTime: number;
    readonly targetAuthorized: boolean;
    readonly registration: NamedAgentRegistration | null;
  }>;
}

export interface MasterWalletApprovalAdapter {
  requestApproval(input: {
    readonly attempt: SetupAttempt;
    readonly typedData: NetworkTypedData;
  }): Promise<
    | { readonly status: "returned" }
    | { readonly status: "cancelled" }
    | { readonly status: "unavailable"; readonly reason: string }
  >;
}

export interface WalletReturnInput {
  readonly attemptId: string;
  readonly connectorSessionId: string;
}

export type SetupVerificationResult =
  | {
      readonly status: "activated";
      readonly binding: SignerBinding;
      readonly effectiveExpiry: number;
    }
  | {
      readonly status: "expiry_confirmation_required";
      readonly attemptId: string;
      readonly requestedExpiry: number;
      readonly effectiveExpiry: number;
    }
  | {
      readonly status: "inert";
      readonly reason:
        | "not_pending"
        | "binding_mismatch"
        | "expired"
        | "registration_unverified"
        | "activation_lost";
    };

export interface ApiWalletSetupCoordinator {
  prepare(input: {
    readonly network: "mainnet" | "testnet";
    readonly connectorSessionId: string;
    readonly connectedMasterAccount: string;
    readonly targetAccount: string;
    readonly registrationName: string;
    readonly replaceExisting?: boolean;
  }): Promise<SetupAttempt>;
  requestApproval(
    attemptId: string,
  ): Promise<
    Awaited<ReturnType<MasterWalletApprovalAdapter["requestApproval"]>>
  >;
  verifyExternalReturn(
    input: WalletReturnInput,
  ): Promise<SetupVerificationResult>;
  confirmShorterExpiry(
    input: WalletReturnInput & {
      readonly acceptedExpiry: number;
    },
  ): Promise<SetupVerificationResult>;
  cancel(attemptId: string): Promise<void>;
}

function assertSafeTime(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${field} must be a positive millisecond timestamp.`);
  }
}

export function maximumAgentRegistrationExpiry(
  attempt: Pick<SetupAttempt, "expiresAt">,
): number {
  const maximum = attempt.expiresAt + AGENT_AUTHORIZATION_DURATION_MS;
  assertSafeTime(maximum, "maximum agent registration expiry");
  return maximum;
}

export function normalizeSetupAddress(value: string): string {
  try {
    return getAddress(value).toLowerCase();
  } catch {
    throw new TypeError("Setup requires valid master and target addresses.");
  }
}

export function normalizeSetupTarget(input: {
  readonly network: "testnet";
  readonly masterAccount: string;
  readonly targetAccount: string;
}): {
  readonly network: "testnet";
  readonly masterAccount: string;
  readonly targetAccount: string;
} {
  assertTestnetSigningCapability(input.network);
  return {
    network: "testnet",
    masterAccount: normalizeSetupAddress(input.masterAccount),
    targetAccount: normalizeSetupAddress(input.targetAccount),
  };
}

function createSecretMaterial(bytes: Uint8Array): SecretMaterial {
  let disposed = false;
  return {
    bytes,
    dispose() {
      if (disposed) return;
      disposed = true;
      bytes.fill(0);
    },
  };
}

async function generateSecret(
  randomBytes: (length: number) => Promise<Uint8Array>,
): Promise<SecretMaterial> {
  for (let attempt = 0; attempt < 128; attempt += 1) {
    const bytes = await randomBytes(32);
    if (isValidSecp256k1Secret(bytes)) return createSecretMaterial(bytes);
    bytes.fill(0);
  }
  throw new Error("Unable to generate a valid device credential.");
}

async function generateAttemptId(
  randomBytes: (length: number) => Promise<Uint8Array>,
): Promise<`0x${string}`> {
  for (let attempt = 0; attempt < 128; attempt += 1) {
    const bytes = await randomBytes(32);
    const usable = bytes.length === 32 && bytes.some((value) => value !== 0);
    if (usable) {
      const id = toHex(bytes);
      bytes.fill(0);
      return id;
    }
    bytes.fill(0);
  }
  throw new Error("Unable to generate a setup attempt identifier.");
}

export function bindingFromAttempt(attempt: SetupAttempt): SignerBinding {
  return normalizeSignerBinding({
    network: attempt.network,
    masterAccount: attempt.masterAccount,
    targetAccount: attempt.targetAccount,
    agentAddress: attempt.agentAddress,
    generation: attempt.registrationGeneration,
  });
}

function exactRegistration(
  attempt: SetupAttempt,
  registration: NamedAgentRegistration | null,
): registration is NamedAgentRegistration {
  if (!registration) return false;
  try {
    return (
      normalizeSetupAddress(registration.agentAddress) === attempt.agentAddress
    );
  } catch {
    return false;
  }
}

export function createApiWalletSetupCoordinator(options: {
  readonly authority: AgentRegistrationAuthority;
  readonly repository: SetupRepository;
  readonly vault: AgentCredentialVault;
  readonly wallet: MasterWalletApprovalAdapter;
  readonly clock: { now(): number };
  readonly randomBytes: (length: number) => Promise<Uint8Array>;
  readonly deriveAgentAddress: (secret: Uint8Array) => Promise<string>;
}): ApiWalletSetupCoordinator {
  const removePendingAttempt = async (
    attempt: SetupAttempt,
    reason: string,
  ): Promise<void> => {
    await options.vault.delete(bindingFromAttempt(attempt));
    options.repository.cancelAttempt(attempt.id, reason);
  };

  const verify = async (
    input: WalletReturnInput,
    acceptedExpiry?: number,
  ): Promise<SetupVerificationResult> => {
    const attempt = options.repository.getPendingAttempt(input.attemptId);
    if (!attempt) return { status: "inert", reason: "not_pending" };
    if (attempt.connectorSessionId !== input.connectorSessionId) {
      return { status: "inert", reason: "binding_mismatch" };
    }
    const now = options.clock.now();
    if (now >= attempt.expiresAt) {
      await removePendingAttempt(attempt, "expired");
      return { status: "inert", reason: "expired" };
    }
    const proof = await options.authority.verify({
      network: attempt.network,
      masterAccount: attempt.masterAccount,
      targetAccount: attempt.targetAccount,
      agentAddress: attempt.agentAddress,
    });
    assertSafeTime(proof.authoritativeTime, "authoritativeTime");
    if (proof.authoritativeTime >= attempt.expiresAt) {
      await removePendingAttempt(attempt, "expired");
      return { status: "inert", reason: "expired" };
    }
    const registration = proof.registration;
    const validUntil = registration?.validUntil;
    const maximumExpiry = maximumAgentRegistrationExpiry(attempt);
    const maximumRemainingExpiry =
      proof.authoritativeTime +
      AGENT_AUTHORIZATION_DURATION_MS +
      AUTHORITY_TIME_TOLERANCE_MS;
    if (
      !proof.targetAuthorized ||
      !exactRegistration(attempt, registration) ||
      validUntil === null ||
      validUntil === undefined ||
      !Number.isSafeInteger(validUntil) ||
      validUntil <= proof.authoritativeTime ||
      validUntil > maximumExpiry ||
      validUntil > maximumRemainingExpiry
    ) {
      return { status: "inert", reason: "registration_unverified" };
    }
    if (validUntil < attempt.requestedExpiry && acceptedExpiry !== validUntil) {
      return {
        status: "expiry_confirmation_required",
        attemptId: attempt.id,
        requestedExpiry: attempt.requestedExpiry,
        effectiveExpiry: validUntil,
      };
    }
    const activated = options.repository.consumeAndActivate({
      attemptId: attempt.id,
      expected: attempt,
      effectiveExpiry: validUntil,
      now,
    });
    return activated
      ? {
          status: "activated",
          binding: bindingFromAttempt(attempt),
          effectiveExpiry: validUntil,
        }
      : { status: "inert", reason: "activation_lost" };
  };

  return {
    async prepare(input) {
      assertTestnetSigningCapability(input.network);
      if (!isConnectorSessionId(input.connectorSessionId)) {
        throw new TypeError("The connector session identifier is malformed.");
      }
      const { network, masterAccount, targetAccount } = normalizeSetupTarget({
        network: "testnet",
        masterAccount: input.connectedMasterAccount,
        targetAccount: input.targetAccount,
      });
      const registrationName = normalizeAgentRegistrationName(
        input.registrationName,
      );
      const inspection = await options.authority.inspect({
        network,
        masterAccount,
        targetAccount,
      });
      assertSafeTime(inspection.authoritativeTime, "authoritativeTime");
      if (!inspection.targetAuthorized) {
        throw new Error(
          "The selected target is not authoritatively linked to this master account.",
        );
      }
      if (
        !Number.isSafeInteger(inspection.namedAgentLimit) ||
        inspection.namedAgentLimit < 1 ||
        inspection.namedAgentLimit > 3 ||
        !Array.isArray(inspection.namedAgents)
      ) {
        throw new Error("Authoritative named-agent slot state is malformed.");
      }
      for (const namedAgent of inspection.namedAgents) {
        normalizeSetupAddress(namedAgent.agentAddress);
        if (
          !/^[\x20-\x7e]{1,16}$/.test(namedAgent.registrationName) ||
          (namedAgent.validUntil !== null &&
            (!Number.isSafeInteger(namedAgent.validUntil) ||
              namedAgent.validUntil <= 0))
        ) {
          throw new Error("Authoritative named-agent slot state is malformed.");
        }
      }
      const pending = options.repository.getPendingAttemptForTarget({
        network,
        masterAccount,
        targetAccount,
      });
      if (pending) {
        if (inspection.authoritativeTime < pending.expiresAt) {
          throw new Error(
            "A setup attempt for this target is already pending.",
          );
        }
        await removePendingAttempt(pending, "expired");
      }
      const sameName = inspection.namedAgents.find(
        (agent) => agent.registrationName === registrationName,
      );
      if (sameName && !input.replaceExisting) {
        throw new Error("Replacing the existing named agent requires review.");
      }
      if (
        !sameName &&
        inspection.namedAgents.length >= inspection.namedAgentLimit
      ) {
        throw new Error("No reviewed named-agent slot is available.");
      }
      const generation = options.repository.nextGeneration({
        network,
        masterAccount,
        targetAccount,
      });
      const secret = await generateSecret(options.randomBytes);
      try {
        const agentAddress = normalizeSetupAddress(
          await options.deriveAgentAddress(secret.bytes),
        );
        const binding = normalizeSignerBinding({
          network,
          masterAccount,
          targetAccount,
          agentAddress,
          generation,
        });
        const id = await generateAttemptId(options.randomBytes);
        const requestedExpiry =
          inspection.authoritativeTime + AGENT_AUTHORIZATION_DURATION_MS;
        const attempt: SetupAttempt = {
          id,
          network,
          connectorSessionId: input.connectorSessionId,
          masterAccount: binding.masterAccount,
          targetAccount: binding.targetAccount,
          agentAddress: binding.agentAddress,
          registrationName,
          registrationGeneration: binding.generation,
          approvalNonce: inspection.authoritativeTime,
          requestedExpiry,
          createdAt: inspection.authoritativeTime,
          expiresAt: inspection.authoritativeTime + SETUP_ATTEMPT_DURATION_MS,
        };
        await options.vault.stage({
          binding,
          registrationName,
          requestedExpiry,
          secret,
        });
        try {
          options.repository.createAttempt(attempt);
        } catch (error) {
          await options.vault.delete(binding);
          throw error;
        }
        return attempt;
      } finally {
        secret.dispose();
      }
    },
    async requestApproval(attemptId) {
      const attempt = options.repository.getPendingAttempt(attemptId);
      if (!attempt) throw new Error("The setup attempt is no longer pending.");
      if (options.clock.now() >= attempt.expiresAt) {
        await removePendingAttempt(attempt, "expired");
        throw new Error("The setup attempt expired before wallet approval.");
      }
      const typedData = buildApproveAgentTypedData({
        network: attempt.network,
        agentAddress: attempt.agentAddress,
        agentBaseName: attempt.registrationName,
        validUntil: attempt.requestedExpiry,
        nonce: attempt.approvalNonce,
      });
      return options.wallet.requestApproval({ attempt, typedData });
    },
    verifyExternalReturn: (input) => verify(input),
    confirmShorterExpiry: (input) => verify(input, input.acceptedExpiry),
    async cancel(attemptId) {
      const attempt = options.repository.getPendingAttempt(attemptId);
      if (!attempt) return;
      await removePendingAttempt(attempt, "user_cancelled");
    },
  };
}
