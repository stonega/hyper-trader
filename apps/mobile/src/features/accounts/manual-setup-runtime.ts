import {
  assertSignerAccessCapability,
  type ContextEpochAuthority,
  type HyperliquidNetwork,
  type SignerBinding,
} from "@hyper-trader/hyperliquid";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { openDatabaseSync } from "expo-sqlite";
import { Platform } from "react-native";
import { toHex } from "viem";
import type { TradingContextIdentity } from "../../core/context/supervisor";
import {
  createSignerSessionManager,
  type SignerSessionManager,
} from "../../core/session/manager";
import {
  expoSqliteSyncConnection,
  initializeActionPersistence,
} from "../../platform/persistence/action-journal";
import { SqliteNonceAndJournalRepository } from "../../platform/persistence/nonce-repository";
import {
  createAgentSigner,
  deriveAgentAddress,
  expoCryptographicRandomBytes,
} from "../../platform/security/agent-signer";
import {
  assessCustodyInstall,
  createCredentialVault,
  createExpoSecureStorePort,
} from "../../platform/security/credential-vault";
import {
  createExpoDeviceAuthenticationPort,
  prepareProtectedCredentialCreation,
} from "../../platform/security/device-auth";
import { createManualAgentRegistrationAuthority } from "../../platform/wallet/manual-authority";
import { normalizeAgentRegistrationName } from "../../platform/wallet/setup-identifiers";
import { normalizeSavedAccount, type SavedAccount } from "./account-scope";
import {
  reconcileSavedAccountAuthorization,
  restoredTradingContextForSavedAccount,
} from "./active-account-context";
import {
  createManualSetupProgressRepository,
  type ManualSetupProgressRepository,
} from "./manual-setup-progress";
import {
  createApiWalletSetupCoordinator,
  normalizeSetupAddress,
  type SetupAttempt,
  type SetupVerificationResult,
} from "./setup-coordinator";
import {
  type ActivatedSetupRecord,
  SqliteSetupRepository,
} from "./setup-repository";

const INSTALL_SENTINEL_KEY = "@hyper-trader/install-sentinel:v1";
const DATABASE_NAME = "hyper-trader.db";

interface InstallSentinel {
  readonly version: 1;
  readonly installationEpoch: string;
}

export type ManualSetupHydration =
  | { readonly status: "empty" }
  | {
      readonly status: "identity";
      readonly network: HyperliquidNetwork;
      readonly masterAccount: string;
      readonly registrationName: string;
    }
  | {
      readonly status: "protection";
      readonly network: HyperliquidNetwork;
      readonly masterAccount: string;
      readonly registrationName: string;
    }
  | { readonly status: "authorization"; readonly attempt: SetupAttempt }
  | {
      readonly status: "finalizing";
      readonly attempt: SetupAttempt;
      readonly activation: ActivatedSetupRecord;
    };

export interface ManualSetupRuntime {
  load(): Promise<ManualSetupHydration>;
  saveMasterAccount(
    network: HyperliquidNetwork,
    masterAccount: string,
    registrationName: string,
  ): Promise<{
    readonly masterAccount: string;
    readonly registrationName: string;
  }>;
  prepare(
    network: HyperliquidNetwork,
    masterAccount: string,
    registrationName: string,
  ): Promise<SetupAttempt>;
  verify(attempt: SetupAttempt): Promise<SetupVerificationResult>;
  activationFor(attempt: SetupAttempt): ActivatedSetupRecord | null;
  reconcileSavedAccount(account: SavedAccount): Promise<SavedAccount>;
  restoreTradingContext(account: SavedAccount): Promise<TradingContextIdentity>;
  createSignerSessionManager(input: {
    readonly isActiveAndFocused: () => boolean;
    readonly waitUntilActiveAndFocused: () => Promise<boolean>;
  }): SignerSessionManager;
  createActionRepository(
    authority: ContextEpochAuthority,
  ): SqliteNonceAndJournalRepository;
  registerActionSignerScope(
    actionRepository: SqliteNonceAndJournalRepository,
    binding: SignerBinding,
    nowMs: number,
  ): void;
  finish(): Promise<void>;
  cancel(attempt: SetupAttempt): Promise<void>;
}

function parseSentinel(serialized: string): InstallSentinel {
  const value = JSON.parse(serialized) as unknown;
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== 2 ||
    (value as Partial<InstallSentinel>).version !== 1 ||
    typeof (value as Partial<InstallSentinel>).installationEpoch !== "string" ||
    !/^[A-Za-z0-9_-]{16,128}$/.test(
      (value as InstallSentinel).installationEpoch,
    )
  ) {
    throw new Error("The local installation checkpoint is malformed.");
  }
  return value as InstallSentinel;
}

async function loadInstallSentinel(): Promise<{
  readonly sentinel: InstallSentinel;
  readonly previouslyPresent: boolean;
}> {
  const stored = await AsyncStorage.getItem(INSTALL_SENTINEL_KEY);
  if (stored !== null) {
    return { sentinel: parseSentinel(stored), previouslyPresent: true };
  }
  const bytes = await expoCryptographicRandomBytes(24);
  try {
    return {
      sentinel: {
        version: 1,
        installationEpoch: `install_${toHex(bytes).slice(2)}`,
      },
      previouslyPresent: false,
    };
  } finally {
    bytes.fill(0);
  }
}

function sameAttempt(left: SetupAttempt, right: SetupAttempt): boolean {
  return (
    left.id === right.id &&
    left.network === right.network &&
    left.connectorSessionId === right.connectorSessionId &&
    left.masterAccount === right.masterAccount &&
    left.targetAccount === right.targetAccount &&
    left.agentAddress === right.agentAddress &&
    left.registrationName === right.registrationName &&
    left.registrationGeneration === right.registrationGeneration &&
    left.approvalNonce === right.approvalNonce &&
    left.requestedExpiry === right.requestedExpiry &&
    left.createdAt === right.createdAt &&
    left.expiresAt === right.expiresAt
  );
}

function activationMatches(
  attempt: SetupAttempt,
  activation: ActivatedSetupRecord,
): boolean {
  return (
    activation.attemptId === attempt.id &&
    activation.binding.network === attempt.network &&
    activation.binding.masterAccount === attempt.masterAccount &&
    activation.binding.targetAccount === attempt.targetAccount &&
    activation.binding.agentAddress === attempt.agentAddress &&
    activation.binding.generation === attempt.registrationGeneration &&
    activation.registrationName === attempt.registrationName &&
    activation.requestedExpiry === attempt.requestedExpiry
  );
}

async function createRuntime(): Promise<ManualSetupRuntime> {
  const { sentinel, previouslyPresent } = await loadInstallSentinel();
  const store = await createExpoSecureStorePort();
  const vault = createCredentialVault({
    store,
    installationEpoch: sentinel.installationEpoch,
  });
  const installAssessment = assessCustodyInstall({
    installSentinelPresent: previouslyPresent,
    manifest: await vault.readManifest(),
  });
  if (installAssessment.status === "quarantine") {
    throw new Error(
      "Protected credentials survived without their installation checkpoint and require recovery review.",
    );
  }
  if (!previouslyPresent) {
    await AsyncStorage.setItem(INSTALL_SENTINEL_KEY, JSON.stringify(sentinel));
  }

  const database = openDatabaseSync(DATABASE_NAME);
  const connection = expoSqliteSyncConnection(database);
  const repository = new SqliteSetupRepository(connection);
  const progress: ManualSetupProgressRepository =
    createManualSetupProgressRepository(AsyncStorage);
  const deviceAuthentication = await createExpoDeviceAuthenticationPort();
  const coordinator = createApiWalletSetupCoordinator({
    authority: createManualAgentRegistrationAuthority({
      fetch: globalThis.fetch,
    }),
    repository,
    vault,
    wallet: {
      async requestApproval() {
        return { status: "unavailable", reason: "manual_authorization" };
      },
    },
    clock: { now: Date.now },
    randomBytes: expoCryptographicRandomBytes,
    deriveAgentAddress,
  });

  const activationFor = (attempt: SetupAttempt) => {
    const activation = repository.getActivatedAttempt(attempt.id);
    if (activation !== null && !activationMatches(attempt, activation)) {
      throw new Error("The activated setup checkpoint does not match.");
    }
    return activation;
  };
  const accountRestorationEvidence = async (accountInput: SavedAccount) => {
    const account = normalizeSavedAccount(accountInput);
    const activeBinding = repository.getActiveBindingForTarget({
      network: account.network,
      masterAccount: account.masterAccount,
      targetAccount: account.target.address,
    });
    const manifest = await vault.readManifest();
    const nowMs = Date.now();
    return {
      account: reconcileSavedAccountAuthorization({
        account,
        activeBinding,
        manifest,
        nowMs,
      }),
      activeBinding,
      manifest,
      nowMs,
    };
  };

  return {
    async load() {
      const saved = await progress.load();
      if (saved === null) {
        const pending = repository.getLatestPendingAttempt();
        if (pending === null) return { status: "empty" };
        await progress.saveAuthorization(pending, Date.now());
        return { status: "authorization", attempt: pending };
      }
      if (saved.phase === "protection") {
        if (saved.registrationName.length === 0) {
          return {
            status: "identity",
            network: saved.network,
            masterAccount: saved.masterAccount,
            registrationName: "",
          };
        }
        return {
          status: "protection",
          network: saved.network,
          masterAccount: saved.masterAccount,
          registrationName: saved.registrationName,
        };
      }
      const pending = repository.getPendingAttempt(saved.attempt.id);
      if (pending !== null) {
        if (!sameAttempt(saved.attempt, pending)) {
          throw new Error("The saved setup checkpoint does not match SQLite.");
        }
        return { status: "authorization", attempt: pending };
      }
      const activation = activationFor(saved.attempt);
      if (activation !== null) {
        return {
          status: "finalizing",
          attempt: saved.attempt,
          activation,
        };
      }
      throw new Error("The saved setup checkpoint is no longer recoverable.");
    },
    async saveMasterAccount(network, masterAccount, registrationName) {
      assertSignerAccessCapability(network);
      const normalized = normalizeSetupAddress(masterAccount.trim());
      const normalizedName = normalizeAgentRegistrationName(registrationName);
      await progress.saveProtection(
        network,
        normalized,
        normalizedName,
        Date.now(),
      );
      return {
        masterAccount: normalized,
        registrationName: normalizedName,
      };
    },
    async prepare(network, masterAccount, registrationName) {
      assertSignerAccessCapability(network);
      const normalized = normalizeSetupAddress(masterAccount.trim());
      const normalizedName = normalizeAgentRegistrationName(registrationName);
      await progress.saveProtection(
        network,
        normalized,
        normalizedName,
        Date.now(),
      );
      if (Platform.OS !== "android" && Platform.OS !== "ios") {
        throw new Error(
          "Protected API-wallet creation requires iOS or Android.",
        );
      }
      await prepareProtectedCredentialCreation(
        deviceAuthentication,
        Platform.OS,
      );
      const sessionBytes = await expoCryptographicRandomBytes(16);
      let connectorSessionId: string;
      try {
        connectorSessionId = `manual:${toHex(sessionBytes).slice(2)}`;
      } finally {
        sessionBytes.fill(0);
      }
      const attempt = await coordinator.prepare({
        network,
        connectorSessionId,
        connectedMasterAccount: normalized,
        targetAccount: normalized,
        registrationName: normalizedName,
      });
      try {
        await progress.saveAuthorization(attempt, Date.now());
      } catch (error) {
        await coordinator.cancel(attempt.id);
        throw error;
      }
      return attempt;
    },
    verify: (attempt) =>
      coordinator.verifyExternalReturn({
        attemptId: attempt.id,
        connectorSessionId: attempt.connectorSessionId,
      }),
    activationFor,
    async reconcileSavedAccount(accountInput) {
      return (await accountRestorationEvidence(accountInput)).account;
    },
    async restoreTradingContext(accountInput) {
      const evidence = await accountRestorationEvidence(accountInput);
      return restoredTradingContextForSavedAccount({
        account: evidence.account,
        activeBinding: evidence.activeBinding,
        manifest: evidence.manifest,
        nowMs: evidence.nowMs,
      });
    },
    createSignerSessionManager({
      isActiveAndFocused,
      waitUntilActiveAndFocused,
    }) {
      return createSignerSessionManager({
        timer: {
          now: Date.now,
          schedule: (durationMs, callback) => setTimeout(callback, durationMs),
          cancel: (handle) =>
            clearTimeout(handle as ReturnType<typeof setTimeout>),
        },
        deviceAuth: deviceAuthentication,
        vault,
        signerFactory: createAgentSigner,
        isActiveAndFocused,
        waitUntilActiveAndFocused,
      });
    },
    createActionRepository(authority) {
      initializeActionPersistence(connection);
      return new SqliteNonceAndJournalRepository(connection, authority);
    },
    registerActionSignerScope(actionRepository, binding, nowMs) {
      const active = repository.getActiveBindingForTarget({
        network: binding.network,
        masterAccount: binding.masterAccount,
        targetAccount: binding.targetAccount,
      });
      if (active === null) {
        throw new Error("The active API-wallet registration is unavailable.");
      }
      if (
        active.binding.agentAddress !== binding.agentAddress ||
        active.binding.generation !== binding.generation
      ) {
        throw new Error("The active API-wallet registration changed.");
      }
      if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
        throw new TypeError("The current time is invalid.");
      }
      if (active.effectiveExpiry <= nowMs) {
        throw new Error("The active API-wallet registration expired.");
      }
      actionRepository.registerActiveSignerScope({
        binding: active.binding,
        activatedAt: active.activatedAt,
      });
    },
    finish: () => progress.clear(),
    async cancel(attempt) {
      await coordinator.cancel(attempt.id);
      await progress.clear();
    },
  };
}

let runtimePromise: Promise<ManualSetupRuntime> | null = null;

export function getManualSetupRuntime(): Promise<ManualSetupRuntime> {
  runtimePromise ??= createRuntime().catch((error) => {
    runtimePromise = null;
    throw error;
  });
  return runtimePromise;
}
