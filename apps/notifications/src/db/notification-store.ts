import { timingSafeEqual } from "node:crypto";
import {
  type AccountProofChallengeRecord,
  AccountProofError,
  type AccountProofPurpose,
  appendDeletionTombstone,
  CONTRACT_LIMITS,
  type CreateRuleRequest,
  createChallengeRecord,
  type DeletionLedgerPort,
  type DeletionScopeKind,
  decryptPushToken,
  encryptPushToken,
  hashInstallationCredential,
  type NotificationNetwork,
  operationDigest,
  type PushTokenKeyProvider,
  type RegisterInstallationRequest,
  reencryptPushToken,
  sha256Hex,
  type TombstoneKeyProvider,
  verifyAccountProof,
  verifyTombstoneReplay,
} from "@hyper-trader/notifications";
import type { SQL } from "bun";
import type { Hex } from "viem";
import type { DeliveryRejectionCode } from "../outbox/delivery-worker";
import { DeliveryAuthorizationError } from "../outbox/delivery-worker";
import {
  EXPO_RECEIPT_BATCH_SIZE,
  type ExpoReceiptResult,
} from "../push/expo-push-client";
import {
  NOTIFICATION_EGRESS_LEASE_KEY,
  type RuntimeEgressFence,
} from "../worker-fence";
import { assertNotificationMigrationIntegrity } from "./migrations";

export const ACCOUNT_RELATIONSHIP_TIMEOUT_MS = 1_000;

export interface NotificationStoreDependencies {
  readonly tokenKeyProvider: PushTokenKeyProvider;
  readonly tombstoneKeyProvider: TombstoneKeyProvider;
  readonly deletionLedger: DeletionLedgerPort;
  readonly tombstoneKeyVersion: string;
  readonly serviceOrigin: string;
}

export interface NotificationWorkerHealthSnapshot {
  readonly monitorLeases: number;
  readonly outboxPending: number;
  readonly receiptPending: number;
}

export interface AccountRelationshipResult {
  readonly supported: boolean;
  readonly relationshipResult: string;
}

export type AccountRelationshipVerifier = (input: {
  readonly network: NotificationNetwork;
  readonly masterAccount: string;
  readonly targetAccount: string;
  readonly signal: AbortSignal;
  readonly deadlineAtMs: number;
}) => Promise<AccountRelationshipResult>;

export class NotificationStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotificationStoreError";
  }
}

export class StoreConflictError extends NotificationStoreError {
  constructor(message = "notification record conflicts with existing state") {
    super(message);
    this.name = "StoreConflictError";
  }
}

export class StoreUnauthorizedError extends NotificationStoreError {
  constructor(message = "installation credential is not authorized") {
    super(message);
    this.name = "StoreUnauthorizedError";
  }
}

export class StoreNotReadyError extends NotificationStoreError {
  constructor(message = "notification storage is not ready for mutations") {
    super(message);
    this.name = "StoreNotReadyError";
  }
}

export class StoreDependencyUnavailableError extends NotificationStoreError {
  constructor(message = "notification dependency is unavailable") {
    super(message);
    this.name = "StoreDependencyUnavailableError";
  }
}

export class DrainPendingError extends NotificationStoreError {
  constructor() {
    super("provider submissions are still draining");
    this.name = "DrainPendingError";
  }
}

export class StoreRateLimitError extends NotificationStoreError {
  readonly retryAfterMs: number;

  constructor(message: string, retryAfterMs: number) {
    super(message);
    this.name = "StoreRateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

interface ChallengeRow {
  readonly challenge_hash: string;
  readonly credential_hash: string;
  readonly installation_id: string;
  readonly network: "testnet" | "mainnet";
  readonly master_account: string;
  readonly target_account: string;
  readonly purpose: AccountProofPurpose;
  readonly operation_digest: string;
  readonly service_origin: string;
  readonly issued_at_ms: string | number;
  readonly expires_at_ms: string | number;
  readonly state: "pending" | "consumed";
}

export class PostgresNotificationStore {
  readonly #sql: SQL;
  readonly #dependencies: NotificationStoreDependencies;

  constructor(sql: SQL, dependencies: NotificationStoreDependencies) {
    this.#sql = sql;
    this.#dependencies = dependencies;
  }

  async registerInstallation(
    request: RegisterInstallationRequest,
    ip?: string,
  ): Promise<{
    readonly installationId: string;
    readonly state: "active";
  }> {
    const credentialHash = await hashInstallationCredential(request.credential);
    const installationScopeMac = await this.#scopeMac(
      "installation",
      request.installationId,
    );
    const encrypted = await encryptPushToken(
      {
        installationId: request.installationId,
        provider: request.provider,
        token: request.pushToken,
      },
      this.#dependencies.tokenKeyProvider,
    );
    const tokenId = randomHex(16);
    const tokenScopeMac = await this.#scopeMac(
      "push_token",
      encrypted.tokenFingerprint,
    );
    try {
      await this.#sql.begin(async (transaction) => {
        await assertMutable(transaction);
        await admitMutationInTransaction(transaction, {
          ip,
          kind: "token_change",
        });
        const insertedInstallation = await transaction<
          { installation_id: string }[]
        >`
          INSERT INTO notification_installations (
            installation_id, credential_hash, recovery_scope_mac, recovery_key_version
          ) VALUES (
            ${request.installationId}, decode(${credentialHash}, 'hex'),
            decode(${installationScopeMac}, 'hex'), ${this.#dependencies.tombstoneKeyVersion}
          ) ON CONFLICT DO NOTHING RETURNING installation_id
        `;
        if (insertedInstallation.length !== 1) throw new StoreConflictError();
        const insertedToken = await transaction<{ token_id: string }[]>`
          INSERT INTO notification_push_tokens (
            token_id, installation_id, provider, token_fingerprint, ciphertext,
            nonce, key_version, wrapped_dek, recovery_scope_mac, recovery_key_version
          ) VALUES (
            ${tokenId}, ${request.installationId}, ${request.provider},
            decode(${encrypted.tokenFingerprint}, 'hex'),
            decode(${Buffer.from(encrypted.ciphertext, "base64").toString("hex")}, 'hex'),
            decode(${encrypted.nonce}, 'hex'), ${encrypted.keyVersion},
            decode(${Buffer.from(encrypted.wrappedDek, "base64").toString("hex")}, 'hex'),
            decode(${tokenScopeMac}, 'hex'), ${this.#dependencies.tombstoneKeyVersion}
          ) ON CONFLICT DO NOTHING RETURNING token_id
        `;
        if (insertedToken.length !== 1) throw new StoreConflictError();
      });
    } catch (error) {
      if (
        error instanceof StoreConflictError ||
        postgresCode(error) === "23505"
      ) {
        throw new StoreConflictError();
      }
      throw error;
    }
    return { installationId: request.installationId, state: "active" };
  }

  async authenticateInstallation(
    installationId: string,
    credential: string,
  ): Promise<boolean> {
    const credentialHash = await safeCredentialHash(credential);
    if (!credentialHash) return false;
    const rows = await this.#sql<
      { credential_hash: string | null; state: string }[]
    >`
      SELECT encode(credential_hash, 'hex') AS credential_hash, state
      FROM notification_installations
      WHERE installation_id = ${installationId}
    `;
    const row = rows[0];
    if (!row?.credential_hash || row.state !== "active") return false;
    return safeHashEqual(credentialHash, row.credential_hash);
  }

  async rotateInstallationCredential(input: {
    readonly installationId: string;
    readonly credential: string;
    readonly newCredential: string;
    readonly ip?: string;
  }): Promise<{
    readonly installationId: string;
    readonly credentialGeneration: number;
    readonly state: "active";
  }> {
    const credentialHash = await hashInstallationCredential(input.credential);
    const newCredentialHash = await hashInstallationCredential(
      input.newCredential,
    );
    if (safeHashEqual(credentialHash, newCredentialHash)) {
      throw new StoreConflictError("new installation credential must differ");
    }
    try {
      return await this.#sql.begin(async (transaction) => {
        await assertMutable(transaction);
        await lockAuthenticatedInstallation(
          transaction,
          input.installationId,
          credentialHash,
        );
        await admitMutationInTransaction(transaction, {
          installationId: input.installationId,
          ip: input.ip,
        });
        const rows = await transaction<{ credential_generation: number }[]>`
          UPDATE notification_installations
          SET credential_hash = decode(${newCredentialHash}, 'hex'),
              credential_generation = credential_generation + 1,
              updated_at = clock_timestamp()
          WHERE installation_id = ${input.installationId}
            AND credential_hash = decode(${credentialHash}, 'hex')
            AND state = 'active'
          RETURNING credential_generation
        `;
        const generation = rows[0]?.credential_generation;
        if (!generation) throw new StoreUnauthorizedError();
        return {
          installationId: input.installationId,
          credentialGeneration: generation,
          state: "active" as const,
        };
      });
    } catch (error) {
      if (postgresCode(error) === "23505") {
        throw new StoreConflictError(
          "new installation credential is already active",
        );
      }
      throw error;
    }
  }

  async rebindPushToken(
    input: {
      readonly installationId: string;
      readonly credential: string;
      readonly accountLinkId: string;
      readonly provider: "expo";
      readonly pushToken: string;
      readonly proof: {
        readonly challenge: string;
        readonly message: string;
        readonly signature: Hex;
      };
      readonly ip?: string;
    },
    relationshipVerifier: AccountRelationshipVerifier,
  ): Promise<{
    readonly tokenFingerprint: string;
    readonly state: "active";
  }> {
    const credentialHash = await hashInstallationCredential(input.credential);
    const challengeHash = await sha256Hex(input.proof.challenge);
    const tokenFingerprint = await sha256Hex(input.pushToken);
    const expectedDigest = await operationDigest("push-token-rebind/v1", {
      installationId: input.installationId,
      accountLinkId: input.accountLinkId,
      provider: input.provider,
      tokenFingerprint,
    });
    return this.#withProofAttempt(input.ip, async () => {
      const prevalidated = await prevalidatePushTokenRebind(this.#sql, {
        installationId: input.installationId,
        accountLinkId: input.accountLinkId,
        credentialHash,
        challengeHash,
        expectedDigest,
        proof: input.proof,
      });
      const relationship = await verifyAccountRelationship(
        relationshipVerifier,
        {
          network: prevalidated.network,
          masterAccount: prevalidated.masterAccount,
          targetAccount: prevalidated.targetAccount,
        },
      );
      assertSupportedRelationship(relationship);
      const encrypted = await encryptPushToken(
        {
          installationId: input.installationId,
          provider: input.provider,
          token: input.pushToken,
        },
        this.#dependencies.tokenKeyProvider,
      );
      if (encrypted.tokenFingerprint !== tokenFingerprint) {
        throw new StoreConflictError(
          "push token fingerprint changed during encryption",
        );
      }
      try {
        return await this.#sql.begin(async (transaction) => {
          await transaction.unsafe(
            "SET TRANSACTION ISOLATION LEVEL SERIALIZABLE",
          );
          await assertMutable(transaction);
          await lockAuthenticatedInstallation(
            transaction,
            input.installationId,
            credentialHash,
          );
          await admitMutationInTransaction(transaction, {
            installationId: input.installationId,
            ip: input.ip,
            kind: "token_change",
          });
          const challenge = await loadChallengeForUpdate(
            transaction,
            challengeHash,
          );
          if (
            !challenge ||
            challenge.installation_id !== input.installationId
          ) {
            throw new StoreUnauthorizedError("challenge is unavailable");
          }
          const record = challengeRecordFromRow(challenge);
          if (!safeHashEqual(record.credentialHash, credentialHash)) {
            throw new StoreUnauthorizedError(
              "challenge credential binding is stale",
            );
          }
          if (record.purpose !== "notification-push-token-rebind") {
            throw new StoreUnauthorizedError("challenge purpose is invalid");
          }
          if (!safeHashEqual(record.operationDigest, expectedDigest)) {
            throw new StoreUnauthorizedError(
              "push-token operation digest is invalid",
            );
          }
          const links = await transaction<
            {
              network: "testnet" | "mainnet";
              master_account: string;
              target_account: string;
              state: string;
            }[]
          >`
            SELECT network, master_account, target_account, state
            FROM notification_account_links
            WHERE account_link_id = ${input.accountLinkId}
              AND installation_id = ${input.installationId}
            FOR UPDATE
          `;
          const link = links[0];
          if (
            link?.state !== "active" ||
            link.network !== record.network ||
            link.master_account !== record.masterAccount ||
            link.target_account !== record.targetAccount
          ) {
            throw new StoreUnauthorizedError(
              "push-token link binding is invalid",
            );
          }
          await verifyAccountProof({
            record,
            challenge: input.proof.challenge,
            message: input.proof.message,
            signature: input.proof.signature,
            now: await databaseNowMilliseconds(transaction),
          });
          const fingerprintOwner = await transaction<
            { installation_id: string }[]
          >`
            SELECT installation_id FROM notification_push_tokens
            WHERE token_fingerprint = decode(${tokenFingerprint}, 'hex')
              AND installation_id <> ${input.installationId}
            LIMIT 1
          `;
          if (fingerprintOwner.length > 0) {
            throw new StoreConflictError(
              "push token belongs to another installation",
            );
          }
          const consumed = await transaction<{ challenge_id: string }[]>`
            UPDATE notification_account_link_challenges
            SET state = 'consumed', consumed_at = clock_timestamp()
            WHERE challenge_hash = decode(${challengeHash}, 'hex')
              AND state = 'pending' AND expires_at > clock_timestamp()
            RETURNING challenge_id
          `;
          if (consumed.length !== 1) {
            throw new StoreUnauthorizedError("challenge is not pending");
          }
          const recoveryScopeMac = await this.#scopeMac(
            "push_token",
            tokenFingerprint,
          );
          const updated = await transaction<{ token_id: string }[]>`
            UPDATE notification_push_tokens
            SET token_fingerprint = decode(${tokenFingerprint}, 'hex'),
                ciphertext = decode(${Buffer.from(encrypted.ciphertext, "base64").toString("hex")}, 'hex'),
                nonce = decode(${encrypted.nonce}, 'hex'),
                key_version = ${encrypted.keyVersion},
                wrapped_dek = decode(${Buffer.from(encrypted.wrappedDek, "base64").toString("hex")}, 'hex'),
                recovery_scope_mac = decode(${recoveryScopeMac}, 'hex'),
                recovery_key_version = ${this.#dependencies.tombstoneKeyVersion},
                delivery_state = 'active', invalidated_at = NULL,
                updated_at = clock_timestamp()
            WHERE installation_id = ${input.installationId}
              AND provider = ${input.provider}
            RETURNING token_id
          `;
          if (updated.length !== 1) {
            throw new StoreConflictError("push token is unavailable");
          }
          return {
            tokenFingerprint,
            state: "active" as const,
          };
        });
      } catch (error) {
        if (postgresCode(error) === "23505") throw new StoreConflictError();
        throw error;
      }
    });
  }

  async installationIdForCredential(credential: string): Promise<string> {
    const credentialHash = await hashInstallationCredential(credential);
    const rows = await this.#sql<{ installation_id: string }[]>`
      SELECT installation_id FROM notification_installations
      WHERE credential_hash = decode(${credentialHash}, 'hex') AND state = 'active'
    `;
    const installationId = rows[0]?.installation_id;
    if (!installationId) throw new StoreUnauthorizedError();
    return installationId;
  }

  async installationIdForAccountLink(accountLinkId: string): Promise<string> {
    const rows = await this.#sql<{ installation_id: string }[]>`
      SELECT installation_id FROM notification_account_links
      WHERE account_link_id = ${accountLinkId} AND state = 'active'
    `;
    const installationId = rows[0]?.installation_id;
    if (!installationId)
      throw new StoreUnauthorizedError("account link is unavailable");
    return installationId;
  }

  async readDecryptedPushTokenForProvider(
    installationId: string,
  ): Promise<string> {
    const rows = await this.#sql<EncryptedTokenRow[]>`
      SELECT installation_id, provider,
             encode(token_fingerprint, 'hex') AS fingerprint,
             ciphertext, encode(nonce, 'hex') AS nonce, key_version, wrapped_dek
      FROM notification_push_tokens
      WHERE installation_id = ${installationId}
    `;
    const row = rows[0];
    if (!row) throw new StoreUnauthorizedError("push token is unavailable");
    return decryptPushToken(
      encryptedTokenFromRow(row),
      this.#dependencies.tokenKeyProvider,
    );
  }

  async rotatePushTokenKeys(batchSize: number): Promise<{
    readonly rotated: number;
    readonly remaining: number;
  }> {
    if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 100) {
      throw new StoreConflictError(
        "token rotation batch size must be between 1 and 100",
      );
    }
    const activeVersion =
      this.#dependencies.tokenKeyProvider.activeKeyVersion();
    return this.#sql.begin(async (transaction) => {
      await assertMutable(transaction);
      await transaction`
        UPDATE notification_service_state
        SET delivery_enabled = false, updated_at = clock_timestamp()
        WHERE singleton
      `;
      const rows = await transaction<
        {
          token_id: string;
          installation_id: string;
          provider: "expo";
          fingerprint: string;
          ciphertext: Uint8Array;
          nonce: string;
          key_version: string;
          wrapped_dek: Uint8Array;
        }[]
      >`
        SELECT token_id, installation_id, provider,
               encode(token_fingerprint, 'hex') AS fingerprint,
               ciphertext, encode(nonce, 'hex') AS nonce, key_version, wrapped_dek
        FROM notification_push_tokens
        WHERE key_version <> ${activeVersion}
        ORDER BY token_id LIMIT ${batchSize} FOR UPDATE SKIP LOCKED
      `;
      for (const row of rows) {
        const rotated = await reencryptPushToken(
          encryptedTokenFromRow(row),
          this.#dependencies.tokenKeyProvider,
        );
        await transaction`
          UPDATE notification_push_tokens
          SET ciphertext = decode(${Buffer.from(rotated.ciphertext, "base64").toString("hex")}, 'hex'),
              nonce = decode(${rotated.nonce}, 'hex'), key_version = ${rotated.keyVersion},
              wrapped_dek = decode(${Buffer.from(rotated.wrappedDek, "base64").toString("hex")}, 'hex'),
              updated_at = clock_timestamp()
          WHERE token_id = ${row.token_id}
        `;
      }
      const remaining = await transaction<{ count: number }[]>`
        SELECT count(*)::int AS count FROM notification_push_tokens
        WHERE key_version <> ${activeVersion}
      `;
      return { rotated: rows.length, remaining: remaining[0]?.count ?? 0 };
    });
  }

  async issueAccountLinkChallenge(input: {
    readonly installationId: string;
    readonly credential: string;
    readonly network: NotificationNetwork;
    readonly masterAccount: string;
    readonly targetAccount: string;
    readonly purpose: AccountProofPurpose;
    readonly operationDigest: string;
    readonly ip?: string;
  }): Promise<{
    readonly challenge: string;
    readonly record: AccountProofChallengeRecord;
  }> {
    const challenge = randomHex(32);
    const challengeId = randomHex(16);
    const credentialHash = await hashInstallationCredential(input.credential);
    return this.#sql.begin(async (transaction) => {
      await assertMutable(transaction);
      await lockAuthenticatedInstallation(
        transaction,
        input.installationId,
        credentialHash,
      );
      await admitMutationInTransaction(transaction, {
        installationId: input.installationId,
        ip: input.ip,
      });
      const counts = await transaction<{ count: number }[]>`
        SELECT count(*)::int AS count
        FROM notification_account_link_challenges
        WHERE installation_id = ${input.installationId}
          AND issued_at > clock_timestamp() - interval '1 hour'
      `;
      if ((counts[0]?.count ?? 0) >= CONTRACT_LIMITS.challengeIssuesPerHour) {
        throw new StoreRateLimitError(
          "challenge issue quota exhausted",
          60 * 60 * 1000,
        );
      }
      const issuedAt = await databaseNowMilliseconds(transaction);
      const record = await createChallengeRecord({
        challenge,
        credentialHash,
        installationId: input.installationId,
        network: input.network,
        masterAccount: input.masterAccount,
        targetAccount: input.targetAccount,
        purpose: input.purpose,
        operationDigest: input.operationDigest,
        serviceOrigin: this.#dependencies.serviceOrigin,
        issuedAt,
      });
      await transaction`
        INSERT INTO notification_account_link_challenges (
          challenge_id, challenge_hash, credential_hash, installation_id,
          network, master_account, target_account, purpose, operation_digest,
          service_origin, issued_at, expires_at
        ) VALUES (
          ${challengeId}, decode(${record.challengeHash}, 'hex'),
          decode(${credentialHash}, 'hex'), ${record.installationId}, ${record.network},
          ${record.masterAccount}, ${record.targetAccount}, ${record.purpose},
          decode(${record.operationDigest}, 'hex'), ${record.serviceOrigin},
          to_timestamp(${record.issuedAt} / 1000.0),
          to_timestamp(${record.expiresAt} / 1000.0)
        )
      `;
      return { challenge, record };
    });
  }

  async verifyAccountLinkProof(
    input: {
      readonly installationId: string;
      readonly credential: string;
      readonly accountLinkId: string;
      readonly challenge: string;
      readonly message: string;
      readonly signature: Hex;
      readonly ip?: string;
    },
    relationshipVerifier: AccountRelationshipVerifier,
  ): Promise<{ readonly accountLinkId: string; readonly state: "active" }> {
    const credentialHash = await hashInstallationCredential(input.credential);
    const challengeHash = await sha256Hex(input.challenge);
    return this.#withProofAttempt(input.ip, async () => {
      const prevalidated = await prevalidateChallengeProof(this.#sql, {
        installationId: input.installationId,
        credentialHash,
        challengeHash,
        purpose: "notification-account-link",
        proof: input,
      });
      const prevalidatedDigest = await operationDigest("account-link/v1", {
        installationId: input.installationId,
        network: prevalidated.network,
        masterAccount: prevalidated.masterAccount,
        targetAccount: prevalidated.targetAccount,
        accountLinkId: input.accountLinkId,
      });
      if (!safeHashEqual(prevalidated.operationDigest, prevalidatedDigest)) {
        throw new StoreUnauthorizedError(
          "account-link operation digest is invalid",
        );
      }
      const relationship = await verifyAccountRelationship(
        relationshipVerifier,
        {
          network: prevalidated.network,
          masterAccount: prevalidated.masterAccount,
          targetAccount: prevalidated.targetAccount,
        },
      );
      assertSupportedRelationship(relationship);
      try {
        return await this.#sql.begin(async (transaction) => {
          await transaction.unsafe(
            "SET TRANSACTION ISOLATION LEVEL SERIALIZABLE",
          );
          await assertMutable(transaction);
          await lockAuthenticatedInstallation(
            transaction,
            input.installationId,
            credentialHash,
          );
          await admitMutationInTransaction(transaction, {
            installationId: input.installationId,
            ip: input.ip,
          });
          const row = await loadChallengeForUpdate(transaction, challengeHash);
          if (!row || row.installation_id !== input.installationId) {
            throw new StoreUnauthorizedError("challenge is unavailable");
          }
          const record = challengeRecordFromRow(row);
          if (!safeHashEqual(record.credentialHash, credentialHash)) {
            throw new StoreUnauthorizedError(
              "challenge credential binding is stale",
            );
          }
          if (record.purpose !== "notification-account-link") {
            throw new StoreUnauthorizedError("challenge purpose is invalid");
          }
          const exactDigest = await operationDigest("account-link/v1", {
            installationId: input.installationId,
            network: record.network,
            masterAccount: record.masterAccount,
            targetAccount: record.targetAccount,
            accountLinkId: input.accountLinkId,
          });
          if (!safeHashEqual(record.operationDigest, exactDigest)) {
            throw new StoreUnauthorizedError(
              "account-link operation digest is invalid",
            );
          }
          const now = await databaseNowMilliseconds(transaction);
          await verifyAccountProof({
            record,
            challenge: input.challenge,
            message: input.message,
            signature: input.signature,
            now,
          });
          const counts = await transaction<{ count: number }[]>`
          SELECT count(*)::int AS count FROM notification_account_links
          WHERE installation_id = ${input.installationId} AND state <> 'inactive'
        `;
          if ((counts[0]?.count ?? 0) >= CONTRACT_LIMITS.maxLinkedAccounts) {
            throw new StoreConflictError("linked account quota exhausted");
          }
          const recoveryScopeMac = await this.#scopeMac(
            "account_link",
            input.accountLinkId,
          );
          const consumed = await transaction<{ challenge_id: string }[]>`
          UPDATE notification_account_link_challenges
          SET state = 'consumed', consumed_at = clock_timestamp()
          WHERE challenge_hash = decode(${challengeHash}, 'hex')
            AND state = 'pending' AND expires_at > clock_timestamp()
          RETURNING challenge_id
        `;
          if (consumed.length !== 1) {
            throw new StoreUnauthorizedError("challenge is not pending");
          }
          await transaction`
          INSERT INTO notification_account_links (
            account_link_id, installation_id, network, master_account,
            target_account, proof_version, relationship_result, verified_at,
            recovery_scope_mac, recovery_key_version
          ) VALUES (
            ${input.accountLinkId}, ${input.installationId}, ${record.network},
            ${record.masterAccount}, ${record.targetAccount}, 1,
            ${relationship.relationshipResult}, clock_timestamp(),
            decode(${recoveryScopeMac}, 'hex'), ${this.#dependencies.tombstoneKeyVersion}
          )
        `;
          return {
            accountLinkId: input.accountLinkId,
            state: "active" as const,
          };
        });
      } catch (error) {
        if (postgresCode(error) === "23505") throw new StoreConflictError();
        throw error;
      }
    });
  }

  async putPriceRule(
    rule: CreateRuleRequest,
    authority: {
      readonly installationId: string;
      readonly credential: string;
      readonly ip?: string;
    },
  ): Promise<{ readonly ruleId: string; readonly state: "active" }> {
    if (rule.scope !== "price") {
      throw new StoreUnauthorizedError("price rule authority is required");
    }
    const credentialHash = await hashInstallationCredential(
      authority.credential,
    );
    const identityDigest = await ruleIdentityDigest(rule);
    return this.#sql.begin(async (transaction) => {
      await assertMutable(transaction);
      await lockAuthenticatedInstallation(
        transaction,
        authority.installationId,
        credentialHash,
      );
      await admitMutationInTransaction(transaction, {
        installationId: authority.installationId,
        ip: authority.ip,
      });
      await assertRuleQuota(transaction, authority.installationId, rule.ruleId);
      const rows = await transaction<{ rule_id: string }[]>`
        INSERT INTO notification_rules (
          rule_id, installation_id, scope, network, market_id, event_type,
          threshold, identity_digest
        ) VALUES (
          ${rule.ruleId}, ${authority.installationId}, 'price', ${rule.network},
          ${rule.marketId}, ${rule.eventType}, ${rule.threshold},
          decode(${identityDigest}, 'hex')
        )
        ON CONFLICT (rule_id) DO UPDATE SET
          network = EXCLUDED.network,
          market_id = EXCLUDED.market_id,
          event_type = EXCLUDED.event_type,
          threshold = EXCLUDED.threshold,
          identity_digest = EXCLUDED.identity_digest,
          active = true,
          updated_at = clock_timestamp()
        WHERE notification_rules.installation_id = EXCLUDED.installation_id
          AND notification_rules.scope = 'price'
        RETURNING rule_id
      `;
      if (rows.length !== 1)
        throw new StoreConflictError("rule belongs to another scope");
      return { ruleId: rule.ruleId, state: "active" as const };
    });
  }

  async putAccountRule(
    rule: CreateRuleRequest,
    authority: {
      readonly installationId: string;
      readonly credential: string;
      readonly ip?: string;
    },
    proof?: {
      readonly challenge: string;
      readonly message: string;
      readonly signature: Hex;
    },
    relationshipVerifier?: AccountRelationshipVerifier,
  ): Promise<{ readonly ruleId: string; readonly state: "active" }> {
    if (rule.scope !== "account" || !rule.accountLinkId) {
      throw new StoreUnauthorizedError("account rule authority is required");
    }
    if (!proof || !relationshipVerifier) {
      throw new StoreUnauthorizedError(
        "fresh account proof is required for every account-rule mutation",
      );
    }
    const credentialHash = await hashInstallationCredential(
      authority.credential,
    );
    const challengeHash = await sha256Hex(proof.challenge);
    const expectedDigest = await operationDigest("account-rule/v1", rule);
    return this.#withProofAttempt(authority.ip, async () => {
      const prevalidated = await prevalidateChallengeProof(this.#sql, {
        installationId: authority.installationId,
        credentialHash,
        challengeHash,
        purpose: "notification-account-rule-mutation",
        proof,
      });
      if (!safeHashEqual(prevalidated.operationDigest, expectedDigest)) {
        throw new StoreUnauthorizedError(
          "account-rule operation digest is invalid",
        );
      }
      const relationship = await verifyAccountRelationship(
        relationshipVerifier,
        {
          network: prevalidated.network,
          masterAccount: prevalidated.masterAccount,
          targetAccount: prevalidated.targetAccount,
        },
      );
      assertSupportedRelationship(relationship);
      try {
        return await this.#sql.begin(async (transaction) => {
          await transaction.unsafe(
            "SET TRANSACTION ISOLATION LEVEL SERIALIZABLE",
          );
          await assertMutable(transaction);
          await lockAuthenticatedInstallation(
            transaction,
            authority.installationId,
            credentialHash,
          );
          await admitMutationInTransaction(transaction, {
            installationId: authority.installationId,
            ip: authority.ip,
          });
          const challenge = await loadChallengeForUpdate(
            transaction,
            challengeHash,
          );
          if (
            !challenge ||
            challenge.installation_id !== authority.installationId
          ) {
            throw new StoreUnauthorizedError("challenge is unavailable");
          }
          const record = challengeRecordFromRow(challenge);
          if (!safeHashEqual(record.credentialHash, credentialHash)) {
            throw new StoreUnauthorizedError(
              "challenge credential binding is stale",
            );
          }
          if (record.purpose !== "notification-account-rule-mutation") {
            throw new StoreUnauthorizedError("challenge purpose is invalid");
          }
          if (!safeHashEqual(record.operationDigest, expectedDigest)) {
            throw new StoreUnauthorizedError(
              "account-rule operation digest is invalid",
            );
          }
          const links = await transaction<
            {
              network: "testnet" | "mainnet";
              master_account: string;
              target_account: string;
              state: string;
            }[]
          >`
          SELECT network, master_account, target_account, state
          FROM notification_account_links
          WHERE account_link_id = ${rule.accountLinkId}
            AND installation_id = ${authority.installationId} FOR UPDATE
        `;
          const link = links[0];
          if (
            link?.state !== "active" ||
            link.network !== rule.network ||
            link.network !== record.network ||
            link.master_account !== record.masterAccount ||
            link.target_account !== record.targetAccount
          ) {
            throw new StoreUnauthorizedError(
              "account-rule link binding is invalid",
            );
          }
          await verifyAccountProof({
            record,
            challenge: proof.challenge,
            message: proof.message,
            signature: proof.signature,
            now: await databaseNowMilliseconds(transaction),
          });
          await assertRuleQuota(
            transaction,
            authority.installationId,
            rule.ruleId,
          );
          const consumed = await transaction<{ challenge_id: string }[]>`
          UPDATE notification_account_link_challenges
          SET state = 'consumed', consumed_at = clock_timestamp()
          WHERE challenge_hash = decode(${challengeHash}, 'hex')
            AND state = 'pending' AND expires_at > clock_timestamp()
          RETURNING challenge_id
        `;
          if (consumed.length !== 1) {
            throw new StoreUnauthorizedError("challenge is not pending");
          }
          const rows = await transaction<{ rule_id: string }[]>`
          INSERT INTO notification_rules (
            rule_id, installation_id, account_link_id, scope, network,
            market_id, event_type, threshold, identity_digest
          ) VALUES (
            ${rule.ruleId}, ${authority.installationId}, ${rule.accountLinkId},
            'account', ${rule.network}, ${rule.marketId}, ${rule.eventType},
            ${rule.threshold}, decode(${await ruleIdentityDigest(rule)}, 'hex')
          )
          ON CONFLICT (rule_id) DO UPDATE SET
            account_link_id = EXCLUDED.account_link_id,
            network = EXCLUDED.network,
            market_id = EXCLUDED.market_id,
            event_type = EXCLUDED.event_type,
            threshold = EXCLUDED.threshold,
            identity_digest = EXCLUDED.identity_digest,
            active = true,
            updated_at = clock_timestamp()
          WHERE notification_rules.installation_id = EXCLUDED.installation_id
            AND notification_rules.scope = 'account'
          RETURNING rule_id
        `;
          if (rows.length !== 1) {
            throw new StoreConflictError(
              "rule belongs to another authority scope",
            );
          }
          return { ruleId: rule.ruleId, state: "active" as const };
        });
      } catch (error) {
        if (postgresCode(error) === "23505") throw new StoreConflictError();
        throw error;
      }
    });
  }

  async acquireDispatchPermit(input: {
    readonly installationId: string;
    readonly accountLinkId?: string;
    readonly outboxId: string;
    readonly permitId: string;
  }): Promise<{
    readonly permitId: string;
    readonly revocationGeneration: number;
  }> {
    return this.#sql.begin(async (transaction) => {
      const installations = await transaction<
        { state: string; revocation_generation: number }[]
      >`
        SELECT state, revocation_generation FROM notification_installations
        WHERE installation_id = ${input.installationId} FOR UPDATE
      `;
      const installation = installations[0];
      if (installation?.state !== "active") {
        throw new StoreUnauthorizedError("installation is not active");
      }
      let accountLinkGeneration: number | null = null;
      if (input.accountLinkId) {
        const links = await transaction<
          { state: string; revocation_generation: number }[]
        >`
          SELECT state, revocation_generation FROM notification_account_links
          WHERE account_link_id = ${input.accountLinkId}
            AND installation_id = ${input.installationId} FOR UPDATE
        `;
        if (links[0]?.state !== "active") {
          throw new StoreUnauthorizedError("account link is not active");
        }
        accountLinkGeneration = links[0].revocation_generation;
      }
      const outbox = await transaction<
        {
          state: string;
          network: "testnet" | "mainnet";
          account_link_id: string | null;
        }[]
      >`
        SELECT state, network, account_link_id FROM notification_outbox
        WHERE outbox_id = ${input.outboxId}
          AND installation_id = ${input.installationId} FOR UPDATE
      `;
      if (outbox[0]?.state !== "pending") {
        throw new StoreConflictError("outbox row is not dispatchable");
      }
      if ((outbox[0].account_link_id ?? undefined) !== input.accountLinkId) {
        throw new StoreConflictError(
          "dispatch scope does not match outbox row",
        );
      }
      await transaction`
        INSERT INTO notification_dispatch_permits (
          permit_id, outbox_id, installation_id, account_link_id,
          account_link_scope_id, account_link_generation, network,
          revocation_generation, expires_at, provider_deadline_at
        ) VALUES (
          ${input.permitId}, ${input.outboxId}, ${input.installationId},
          ${input.accountLinkId ?? null}, ${input.accountLinkId ?? null},
          ${accountLinkGeneration}, ${outbox[0].network},
          ${installation.revocation_generation},
          clock_timestamp() + interval '30 seconds',
          clock_timestamp() + interval '10 seconds'
        )
      `;
      const leased = await transaction<{ outbox_id: string }[]>`
        UPDATE notification_outbox
        SET state = 'leased', account_link_scope_id = ${input.accountLinkId ?? null},
            account_link_generation = ${accountLinkGeneration},
            updated_at = clock_timestamp()
        WHERE outbox_id = ${input.outboxId} AND state = 'pending'
        RETURNING outbox_id
      `;
      if (leased.length !== 1) {
        throw new StoreConflictError("outbox lease changed concurrently");
      }
      return {
        permitId: input.permitId,
        revocationGeneration: installation.revocation_generation,
      };
    });
  }

  async markProviderSubmissionStarted(permitId: string): Promise<void> {
    validateHexId(permitId, "dispatch permit");
    await this.#sql.begin(async (transaction) => {
      const observed = await transaction<
        {
          installation_id: string;
          outbox_id: string;
          account_link_scope_id: string | null;
          account_link_generation: number | null;
          revocation_generation: number;
          state: string;
        }[]
      >`
        SELECT installation_id, outbox_id, account_link_scope_id,
               account_link_generation, revocation_generation, state
        FROM notification_dispatch_permits WHERE permit_id = ${permitId}
      `;
      const observedPermit = observed[0];
      if (observedPermit?.state !== "active") {
        throw new StoreConflictError("dispatch permit is not active");
      }
      const installation = await transaction<
        { state: string; revocation_generation: number }[]
      >`
        SELECT state, revocation_generation FROM notification_installations
        WHERE installation_id = ${observedPermit.installation_id} FOR UPDATE
      `;
      if (
        installation[0]?.state !== "active" ||
        installation[0].revocation_generation !==
          observedPermit.revocation_generation
      ) {
        throw new StoreUnauthorizedError("dispatch scope is no longer active");
      }
      const tokens = await transaction<{ token_id: string }[]>`
        SELECT token_id FROM notification_push_tokens
        WHERE installation_id = ${observedPermit.installation_id}
          AND provider = 'expo' AND delivery_state = 'active'
        FOR SHARE
      `;
      if (tokens.length !== 1) {
        throw new StoreUnauthorizedError("push token is no longer active");
      }
      if (observedPermit.account_link_scope_id) {
        const links = await transaction<
          { state: string; revocation_generation: number }[]
        >`
          SELECT state, revocation_generation FROM notification_account_links
          WHERE account_link_id = ${observedPermit.account_link_scope_id}
            AND installation_id = ${observedPermit.installation_id}
          FOR UPDATE
        `;
        if (
          links[0]?.state !== "active" ||
          links[0].revocation_generation !==
            observedPermit.account_link_generation
        ) {
          throw new StoreUnauthorizedError(
            "dispatch account-link scope is no longer active",
          );
        }
      }
      const outbox = await transaction<
        {
          state: string;
          account_link_scope_id: string | null;
          revocation_generation: number;
        }[]
      >`
        SELECT state, account_link_scope_id, revocation_generation
        FROM notification_outbox
        WHERE outbox_id = ${observedPermit.outbox_id}
          AND installation_id = ${observedPermit.installation_id}
        FOR UPDATE
      `;
      if (
        outbox[0]?.state !== "leased" ||
        outbox[0].account_link_scope_id !==
          observedPermit.account_link_scope_id ||
        outbox[0].revocation_generation !== observedPermit.revocation_generation
      ) {
        throw new StoreUnauthorizedError("dispatch outbox is no longer active");
      }
      const permits = await transaction<
        {
          installation_id: string;
          outbox_id: string;
          account_link_scope_id: string | null;
          account_link_generation: number | null;
          revocation_generation: number;
          state: string;
        }[]
      >`
        SELECT installation_id, outbox_id, account_link_scope_id,
               account_link_generation, revocation_generation, state
        FROM notification_dispatch_permits WHERE permit_id = ${permitId}
        FOR UPDATE
      `;
      const permit = permits[0];
      if (
        permit?.state !== "active" ||
        permit.installation_id !== observedPermit.installation_id ||
        permit.outbox_id !== observedPermit.outbox_id ||
        permit.account_link_scope_id !== observedPermit.account_link_scope_id ||
        permit.account_link_generation !==
          observedPermit.account_link_generation ||
        permit.revocation_generation !== observedPermit.revocation_generation
      ) {
        throw new StoreConflictError("dispatch permit changed concurrently");
      }
      const updated = await transaction<{ permit_id: string }[]>`
        UPDATE notification_dispatch_permits
        SET state = 'submission_started', submission_started_at = clock_timestamp()
        WHERE permit_id = ${permitId} AND state = 'active'
          AND expires_at > clock_timestamp()
          AND provider_deadline_at > clock_timestamp()
        RETURNING permit_id
      `;
      if (updated.length !== 1)
        throw new StoreConflictError("dispatch permit expired");
      const started = await transaction<{ outbox_id: string }[]>`
        UPDATE notification_outbox
        SET state = 'provider_submission_started', updated_at = clock_timestamp()
        WHERE outbox_id = ${permit.outbox_id} AND state = 'leased'
          AND revocation_generation = ${permit.revocation_generation}
          AND account_link_scope_id IS NOT DISTINCT FROM ${permit.account_link_scope_id}
        RETURNING outbox_id
      `;
      if (started.length !== 1) {
        throw new StoreConflictError("dispatch outbox changed concurrently");
      }
    });
  }

  async finishDispatchPermit(
    permitId: string,
    outcome:
      | "provider_accepted"
      | "provider_rejected"
      | "provider_outcome_unknown",
  ): Promise<void> {
    await this.#sql.begin(async (transaction) => {
      const permits = await transaction<{ outbox_id: string }[]>`
        UPDATE notification_dispatch_permits
        SET state = 'finished', finished_at = clock_timestamp()
        WHERE permit_id = ${permitId} AND state = 'submission_started'
        RETURNING outbox_id
      `;
      const permit = permits[0];
      if (!permit)
        throw new StoreConflictError("dispatch attempt is not in flight");
      const completed = await transaction<{ outbox_id: string }[]>`
        UPDATE notification_outbox SET state = ${outcome}, updated_at = clock_timestamp()
        WHERE outbox_id = ${permit.outbox_id}
          AND state = 'provider_submission_started'
        RETURNING outbox_id
      `;
      if (completed.length !== 1) {
        throw new StoreConflictError("dispatch outbox is not in flight");
      }
    });
  }

  async startInstallationDrain(input: {
    readonly installationId: string;
    readonly credential: string;
    readonly operationId: string;
  }): Promise<{ readonly operationId: string; readonly state: "draining" }> {
    const credentialHash = await hashInstallationCredential(input.credential);
    return this.#sql.begin(async (transaction) => {
      await assertMutable(transaction);
      const rows = await transaction<
        {
          credential_hash: string | null;
          state: string;
          revocation_generation: number;
        }[]
      >`
        SELECT encode(credential_hash, 'hex') AS credential_hash, state, revocation_generation
        FROM notification_installations WHERE installation_id = ${input.installationId}
        FOR UPDATE
      `;
      const installation = rows[0];
      if (
        !installation?.credential_hash ||
        !safeHashEqual(credentialHash, installation.credential_hash)
      ) {
        throw new StoreUnauthorizedError();
      }
      if (installation.state === "draining") {
        const existing = await transaction<{ operation_id: string }[]>`
          SELECT operation_id FROM notification_revocation_operations
          WHERE operation_id = ${input.operationId} AND scope_kind = 'installation'
            AND scope_id = ${input.installationId} AND state = 'draining'
        `;
        if (existing.length === 1) {
          return { operationId: input.operationId, state: "draining" as const };
        }
        throw new StoreConflictError("installation is already draining");
      }
      if (installation.state !== "active") {
        throw new StoreUnauthorizedError("installation is not active");
      }
      const nextGeneration = installation.revocation_generation + 1;
      const deletionId = `installation:${input.installationId}:${nextGeneration}`;
      await transaction`
        UPDATE notification_installations
        SET state = 'draining', updated_at = clock_timestamp()
        WHERE installation_id = ${input.installationId} AND state = 'active'
      `;
      await transaction`
        INSERT INTO notification_revocation_operations (
          operation_id, deletion_id, scope_kind, scope_id, state
        ) VALUES (
          ${input.operationId}, ${deletionId}, 'installation',
          ${input.installationId}, 'draining'
        )
      `;
      await fenceInstallationDispatchWork(
        transaction,
        input.installationId,
        deletionId,
        false,
      );
      return { operationId: input.operationId, state: "draining" as const };
    });
  }

  async startAccountLinkDrain(input: {
    readonly installationId: string;
    readonly credential: string;
    readonly accountLinkId: string;
    readonly operationId: string;
    readonly ip?: string;
  }): Promise<{ readonly operationId: string; readonly state: "draining" }> {
    const credentialHash = await hashInstallationCredential(input.credential);
    return this.#sql.begin(async (transaction) => {
      await assertMutable(transaction);
      await lockAuthenticatedInstallation(
        transaction,
        input.installationId,
        credentialHash,
      );
      await admitMutationInTransaction(transaction, {
        installationId: input.installationId,
        ip: input.ip,
      });
      const links = await transaction<
        { state: string; revocation_generation: number }[]
      >`
        SELECT state, revocation_generation FROM notification_account_links
        WHERE account_link_id = ${input.accountLinkId}
          AND installation_id = ${input.installationId} FOR UPDATE
      `;
      const link = links[0];
      if (!link)
        throw new StoreUnauthorizedError("account link is unavailable");
      if (link.state === "draining") {
        const existing = await transaction<{ operation_id: string }[]>`
          SELECT operation_id FROM notification_revocation_operations
          WHERE operation_id = ${input.operationId} AND scope_kind = 'account_link'
            AND scope_id = ${input.accountLinkId} AND state = 'draining'
        `;
        if (existing.length === 1) {
          return { operationId: input.operationId, state: "draining" as const };
        }
        throw new StoreConflictError("account link is already draining");
      }
      if (link.state !== "active") {
        throw new StoreUnauthorizedError("account link is not active");
      }
      const deletionId = `account_link:${input.accountLinkId}:${link.revocation_generation + 1}`;
      await transaction`
        UPDATE notification_account_links SET state = 'draining', updated_at = clock_timestamp()
        WHERE account_link_id = ${input.accountLinkId} AND state = 'active'
      `;
      await transaction`
        INSERT INTO notification_revocation_operations (
          operation_id, deletion_id, scope_kind, scope_id, state
        ) VALUES (
          ${input.operationId}, ${deletionId}, 'account_link',
          ${input.accountLinkId}, 'draining'
        )
      `;
      await fenceAccountLinkDispatchWork(
        transaction,
        input.accountLinkId,
        deletionId,
        false,
      );
      return { operationId: input.operationId, state: "draining" as const };
    });
  }

  async commitAccountLinkUnlink(operationId: string): Promise<{
    readonly operationId: string;
    readonly state: "inactive";
    readonly ledgerSequence: number;
  }> {
    const operations = await this.#sql<
      {
        deletion_id: string;
        scope_id: string;
        state: "draining" | "committed";
        ledger_sequence: string | number | null;
        revocation_generation: number | null;
        recovery_key_version: string | null;
      }[]
    >`
      SELECT o.deletion_id, o.scope_id, o.state, o.ledger_sequence,
             l.revocation_generation, l.recovery_key_version
      FROM notification_revocation_operations o
      LEFT JOIN notification_account_links l ON l.account_link_id = o.scope_id
      WHERE o.operation_id = ${operationId} AND o.scope_kind = 'account_link'
    `;
    const operation = operations[0];
    if (!operation)
      throw new StoreConflictError("unlink operation is unavailable");
    if (operation.state === "committed" && operation.ledger_sequence !== null) {
      return {
        operationId,
        state: "inactive",
        ledgerSequence: Number(operation.ledger_sequence),
      };
    }
    if (
      operation.revocation_generation === null ||
      !operation.recovery_key_version
    ) {
      throw new StoreConflictError("draining account link is unavailable");
    }
    const inFlight = await this.#sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM notification_dispatch_permits
      WHERE account_link_scope_id = ${operation.scope_id}
        AND state = 'submission_started' AND provider_deadline_at > clock_timestamp()
    `;
    if ((inFlight[0]?.count ?? 0) > 0) throw new DrainPendingError();
    const appended = await appendDeletionTombstone(
      this.#dependencies.deletionLedger,
      this.#dependencies.tombstoneKeyProvider,
      {
        deletionId: operation.deletion_id,
        scopeKind: "account_link",
        scopeIdentifier: operation.scope_id,
        deletionGeneration: operation.revocation_generation + 1,
        deletedAt: Date.now(),
      },
      operation.recovery_key_version,
    );
    const { item, receipt } = appended;
    if (!item || item.deletionId !== operation.deletion_id) {
      throw new StoreConflictError(
        "durable deletion ledger receipt is inconsistent",
      );
    }
    await this.#sql.begin(async (transaction) => {
      await transaction.unsafe("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
      const lockedOperation = await transaction<{ state: string }[]>`
        SELECT state FROM notification_revocation_operations
        WHERE operation_id = ${operationId} FOR UPDATE
      `;
      if (lockedOperation[0]?.state === "committed") return;
      const links = await transaction<{ state: string }[]>`
        SELECT state FROM notification_account_links
        WHERE account_link_id = ${operation.scope_id} FOR UPDATE
      `;
      if (links[0]?.state !== "draining") {
        throw new StoreConflictError("account link is not draining");
      }
      await fenceAccountLinkDispatchWork(
        transaction,
        operation.scope_id,
        operation.deletion_id,
        false,
      );
      const active = await transaction<{ count: number }[]>`
        SELECT count(*)::int AS count FROM notification_dispatch_permits
        WHERE account_link_scope_id = ${operation.scope_id}
          AND state = 'submission_started' AND provider_deadline_at > clock_timestamp()
      `;
      if ((active[0]?.count ?? 0) > 0) throw new DrainPendingError();
      await transaction`
        DELETE FROM notification_rules WHERE account_link_id = ${operation.scope_id}
      `;
      await transaction`
        DELETE FROM notification_account_links WHERE account_link_id = ${operation.scope_id}
      `;
      await recordDeletionTombstone(transaction, item, receipt);
      await transaction`
        UPDATE notification_revocation_operations
        SET state = 'committed', ledger_sequence = ${receipt.sequence},
            committed_at = clock_timestamp()
        WHERE operation_id = ${operationId}
      `;
    });
    return { operationId, state: "inactive", ledgerSequence: receipt.sequence };
  }

  async verifyLostInstallationRevokeProof(
    input: {
      readonly requestingInstallationId: string;
      readonly credential: string;
      readonly operationId: string;
      readonly network: "testnet" | "mainnet";
      readonly masterAccount: string;
      readonly targetAccount: string;
      readonly selectedInstallationIds: readonly string[];
      readonly challenge: string;
      readonly message: string;
      readonly signature: Hex;
      readonly ip?: string;
    },
    relationshipVerifier: AccountRelationshipVerifier,
  ): Promise<{
    readonly operationIds: readonly string[];
    readonly state: "draining";
  }> {
    if (
      input.selectedInstallationIds.length < 1 ||
      input.selectedInstallationIds.length >
        CONTRACT_LIMITS.maxLinkedAccounts ||
      input.selectedInstallationIds.some((installationId, index, selected) => {
        const previous = selected[index - 1];
        return (
          !/^[0-9a-f]{32}$/.test(installationId) ||
          (index > 0 && previous !== undefined && previous >= installationId)
        );
      })
    ) {
      throw new StoreUnauthorizedError(
        "selected installation set must be sorted and unique",
      );
    }
    const credentialHash = await hashInstallationCredential(input.credential);
    const challengeHash = await sha256Hex(input.challenge);
    const expectedDigest = await operationDigest(
      "lost-installation-revoke/v1",
      {
        requestingInstallationId: input.requestingInstallationId,
        operationId: input.operationId,
        network: input.network,
        masterAccount: input.masterAccount,
        targetAccount: input.targetAccount,
        selectedInstallationIds: input.selectedInstallationIds,
      },
    );
    return this.#withProofAttempt(input.ip, async () => {
      const prevalidated = await prevalidateChallengeProof(this.#sql, {
        installationId: input.requestingInstallationId,
        credentialHash,
        challengeHash,
        purpose: "notification-installation-revoke",
        proof: input,
      });
      if (
        prevalidated.network !== input.network ||
        prevalidated.masterAccount !== input.masterAccount ||
        prevalidated.targetAccount !== input.targetAccount ||
        !safeHashEqual(prevalidated.operationDigest, expectedDigest)
      ) {
        throw new StoreUnauthorizedError(
          "lost-installation proof binding is invalid",
        );
      }
      const relationship = await verifyAccountRelationship(
        relationshipVerifier,
        {
          network: input.network,
          masterAccount: input.masterAccount,
          targetAccount: input.targetAccount,
        },
      );
      assertSupportedRelationship(relationship);
      return this.#sql.begin(async (transaction) => {
        await transaction.unsafe(
          "SET TRANSACTION ISOLATION LEVEL SERIALIZABLE",
        );
        await assertMutable(transaction);
        await lockAuthenticatedInstallation(
          transaction,
          input.requestingInstallationId,
          credentialHash,
        );
        await admitMutationInTransaction(transaction, {
          installationId: input.requestingInstallationId,
          ip: input.ip,
        });
        const challenge = await loadChallengeForUpdate(
          transaction,
          challengeHash,
        );
        if (
          !challenge ||
          challenge.installation_id !== input.requestingInstallationId
        ) {
          throw new StoreUnauthorizedError("challenge is unavailable");
        }
        const record = challengeRecordFromRow(challenge);
        if (!safeHashEqual(record.credentialHash, credentialHash)) {
          throw new StoreUnauthorizedError(
            "challenge credential binding is stale",
          );
        }
        if (
          record.purpose !== "notification-installation-revoke" ||
          record.network !== input.network ||
          record.masterAccount !== input.masterAccount ||
          record.targetAccount !== input.targetAccount ||
          !safeHashEqual(record.operationDigest, expectedDigest)
        ) {
          throw new StoreUnauthorizedError(
            "lost-installation proof binding is invalid",
          );
        }
        await verifyAccountProof({
          record,
          challenge: input.challenge,
          message: input.message,
          signature: input.signature,
          now: await databaseNowMilliseconds(transaction),
        });
        const requestingLinks = await transaction<{ count: number }[]>`
        SELECT count(*)::int AS count FROM notification_account_links
        WHERE installation_id = ${input.requestingInstallationId}
          AND network = ${input.network} AND master_account = ${input.masterAccount}
          AND target_account = ${input.targetAccount} AND state = 'active'
      `;
        if (requestingLinks[0]?.count !== 1) {
          throw new StoreUnauthorizedError(
            "requesting installation lacks the proven link",
          );
        }
        const selected: {
          installation_id: string;
          revocation_generation: number;
        }[] = [];
        for (const installationId of input.selectedInstallationIds) {
          const rows = await transaction<
            { installation_id: string; revocation_generation: number }[]
          >`
          SELECT installation_id, revocation_generation
          FROM notification_installations
          WHERE installation_id = ${installationId} AND state = 'active'
          FOR UPDATE
        `;
          const row = rows[0];
          if (!row) {
            throw new StoreUnauthorizedError(
              "selected installation set exceeds proven authority",
            );
          }
          const selectedLinks = await transaction<{ count: number }[]>`
          SELECT count(*)::int AS count
          FROM notification_account_links
          WHERE installation_id = ${installationId} AND state = 'active'
            AND network = ${input.network} AND master_account = ${input.masterAccount}
            AND target_account = ${input.targetAccount}
        `;
          if ((selectedLinks[0]?.count ?? 0) < 1) {
            throw new StoreUnauthorizedError(
              "selected installation set exceeds proven authority",
            );
          }
          selected.push(row);
        }
        const consumed = await transaction<{ challenge_id: string }[]>`
        UPDATE notification_account_link_challenges
        SET state = 'consumed', consumed_at = clock_timestamp()
        WHERE challenge_hash = decode(${challengeHash}, 'hex')
          AND state = 'pending' AND expires_at > clock_timestamp()
        RETURNING challenge_id
      `;
        if (consumed.length !== 1) {
          throw new StoreUnauthorizedError("challenge is not pending");
        }
        const operationIds: string[] = [];
        for (const row of selected) {
          const derivedOperationId = (
            await sha256Hex(`${input.operationId}|${row.installation_id}`)
          ).slice(0, 32);
          operationIds.push(derivedOperationId);
          await transaction`
          UPDATE notification_installations SET state = 'draining', updated_at = clock_timestamp()
          WHERE installation_id = ${row.installation_id} AND state = 'active'
        `;
          await transaction`
          UPDATE notification_account_links SET state = 'draining', updated_at = clock_timestamp()
          WHERE installation_id = ${row.installation_id}
            AND network = ${input.network} AND master_account = ${input.masterAccount}
            AND target_account = ${input.targetAccount} AND state = 'active'
        `;
          await transaction`
          INSERT INTO notification_revocation_operations (
            operation_id, deletion_id, scope_kind, scope_id, state
          ) VALUES (
            ${derivedOperationId},
            ${`installation:${row.installation_id}:${row.revocation_generation + 1}`},
            'installation', ${row.installation_id}, 'draining'
          )
        `;
          await fenceInstallationDispatchWork(
            transaction,
            row.installation_id,
            `installation:${row.installation_id}:${row.revocation_generation + 1}`,
            false,
          );
        }
        return { operationIds, state: "draining" as const };
      });
    });
  }

  async commitInstallationRevocation(operationId: string): Promise<{
    readonly operationId: string;
    readonly state: "inactive";
    readonly ledgerSequence: number;
  }> {
    const operationRows = await this.#sql<
      {
        deletion_id: string;
        scope_id: string;
        state: "draining" | "committed";
        ledger_sequence: string | number | null;
        revocation_generation: number;
        recovery_key_version: string;
      }[]
    >`
      SELECT o.deletion_id, o.scope_id, o.state, o.ledger_sequence,
             i.revocation_generation, i.recovery_key_version
      FROM notification_revocation_operations o
      JOIN notification_installations i ON i.installation_id = o.scope_id
      WHERE o.operation_id = ${operationId} AND o.scope_kind = 'installation'
    `;
    const operation = operationRows[0];
    if (!operation)
      throw new StoreConflictError("revocation operation is unavailable");
    if (operation.state === "committed" && operation.ledger_sequence !== null) {
      return {
        operationId,
        state: "inactive",
        ledgerSequence: Number(operation.ledger_sequence),
      };
    }
    const inFlight = await this.#sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM notification_dispatch_permits
      WHERE installation_id = ${operation.scope_id}
        AND state = 'submission_started'
        AND provider_deadline_at > clock_timestamp()
    `;
    if ((inFlight[0]?.count ?? 0) > 0) throw new DrainPendingError();
    const nextGeneration = operation.revocation_generation + 1;
    const appended = await appendDeletionTombstone(
      this.#dependencies.deletionLedger,
      this.#dependencies.tombstoneKeyProvider,
      {
        deletionId: operation.deletion_id,
        scopeKind: "installation",
        scopeIdentifier: operation.scope_id,
        deletionGeneration: nextGeneration,
        deletedAt: Date.now(),
      },
      operation.recovery_key_version,
    );
    const { item: ledgerItem, receipt } = appended;
    if (!ledgerItem || ledgerItem.deletionId !== operation.deletion_id) {
      throw new StoreConflictError(
        "durable deletion ledger receipt is inconsistent",
      );
    }
    await this.#sql.begin(async (transaction) => {
      await transaction.unsafe("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
      const lockedOperations = await transaction<
        { state: string; scope_id: string }[]
      >`
        SELECT state, scope_id FROM notification_revocation_operations
        WHERE operation_id = ${operationId} FOR UPDATE
      `;
      if (lockedOperations[0]?.state === "committed") return;
      const installations = await transaction<
        { state: string; revocation_generation: number }[]
      >`
        SELECT state, revocation_generation FROM notification_installations
        WHERE installation_id = ${operation.scope_id} FOR UPDATE
      `;
      if (installations[0]?.state !== "draining") {
        throw new StoreConflictError("installation is not draining");
      }
      await fenceInstallationDispatchWork(
        transaction,
        operation.scope_id,
        operation.deletion_id,
        false,
      );
      const activeAttempts = await transaction<{ count: number }[]>`
        SELECT count(*)::int AS count FROM notification_dispatch_permits
        WHERE installation_id = ${operation.scope_id}
          AND state = 'submission_started'
          AND provider_deadline_at > clock_timestamp()
      `;
      if ((activeAttempts[0]?.count ?? 0) > 0) throw new DrainPendingError();
      await transaction`
        DELETE FROM notification_rules WHERE installation_id = ${operation.scope_id}
      `;
      await transaction`
        DELETE FROM notification_push_tokens WHERE installation_id = ${operation.scope_id}
      `;
      await transaction`
        DELETE FROM notification_account_links WHERE installation_id = ${operation.scope_id}
      `;
      await transaction`
        UPDATE notification_installations
        SET state = 'inactive', credential_hash = NULL,
            revocation_generation = revocation_generation + 1,
            revoked_at = clock_timestamp(), updated_at = clock_timestamp()
        WHERE installation_id = ${operation.scope_id}
      `;
      await recordDeletionTombstone(transaction, ledgerItem, receipt);
      await transaction`
        UPDATE notification_revocation_operations
        SET state = 'committed', ledger_sequence = ${receipt.sequence},
            committed_at = clock_timestamp()
        WHERE operation_id = ${operationId}
      `;
    });
    return {
      operationId,
      state: "inactive",
      ledgerSequence: receipt.sequence,
    };
  }

  async prepareRestore(backupWatermark: number): Promise<void> {
    if (!Number.isSafeInteger(backupWatermark) || backupWatermark < 0) {
      throw new StoreConflictError("backup watermark is invalid");
    }
    await assertNotificationMigrationIntegrity(this.#sql);
    await this.#sql`
      UPDATE notification_service_state
      SET restore_state = 'replaying', ledger_watermark = ${backupWatermark},
          ledger_head = ${backupWatermark}, mutations_enabled = false,
          monitors_enabled = false, delivery_enabled = false,
          updated_at = clock_timestamp()
      WHERE singleton AND schema_phase = 'contracted'
    `;
  }

  async replayRestore(): Promise<{ readonly appliedThrough: number }> {
    await assertNotificationMigrationIntegrity(this.#sql);
    const state = await this.#sql<
      {
        schema_phase: string;
        restore_state: string;
        ledger_watermark: string | number;
      }[]
    >`
      SELECT schema_phase, restore_state, ledger_watermark
      FROM notification_service_state WHERE singleton
    `;
    const current = state[0];
    if (
      current?.schema_phase !== "contracted" ||
      current.restore_state !== "replaying"
    ) {
      throw new StoreNotReadyError("restore replay was not prepared");
    }
    const replay = await verifyTombstoneReplay({
      ledger: this.#dependencies.deletionLedger,
      keyProvider: this.#dependencies.tombstoneKeyProvider,
      backupWatermark: Number(current.ledger_watermark),
    });
    await this.#sql.begin(async (transaction) => {
      const locked = await transaction<
        { restore_state: string; ledger_watermark: string | number }[]
      >`
        SELECT restore_state, ledger_watermark FROM notification_service_state
        WHERE singleton FOR UPDATE
      `;
      if (
        locked[0]?.restore_state !== "replaying" ||
        Number(locked[0].ledger_watermark) !== Number(current.ledger_watermark)
      ) {
        throw new StoreConflictError("restore state changed during replay");
      }
      for (const item of replay.items) {
        if (item.scopeKind === "installation") {
          const installations = await transaction<
            { installation_id: string }[]
          >`
            SELECT installation_id FROM notification_installations
            WHERE recovery_scope_mac = decode(${item.scopeMac}, 'hex') FOR UPDATE
          `;
          for (const installation of installations) {
            await fenceInstallationDispatchWork(
              transaction,
              installation.installation_id,
              item.deletionId,
              true,
            );
            await transaction`
              DELETE FROM notification_rules WHERE installation_id = ${installation.installation_id}
            `;
            await transaction`
              DELETE FROM notification_push_tokens WHERE installation_id = ${installation.installation_id}
            `;
            await transaction`
              DELETE FROM notification_account_links WHERE installation_id = ${installation.installation_id}
            `;
            await transaction`
              UPDATE notification_installations
              SET state = 'inactive', credential_hash = NULL,
                  revocation_generation = GREATEST(revocation_generation, ${item.deletionGeneration}),
                  revoked_at = COALESCE(revoked_at, clock_timestamp()),
                  updated_at = clock_timestamp()
              WHERE installation_id = ${installation.installation_id}
            `;
          }
        } else if (item.scopeKind === "account_link") {
          const links = await transaction<{ account_link_id: string }[]>`
            SELECT account_link_id FROM notification_account_links
            WHERE recovery_scope_mac = decode(${item.scopeMac}, 'hex')
            FOR UPDATE
          `;
          for (const link of links) {
            await fenceAccountLinkDispatchWork(
              transaction,
              link.account_link_id,
              item.deletionId,
              true,
            );
            await transaction`
              DELETE FROM notification_rules
              WHERE account_link_id = ${link.account_link_id}
            `;
            await transaction`
              DELETE FROM notification_account_links
              WHERE account_link_id = ${link.account_link_id}
            `;
          }
        } else {
          await transaction`
            DELETE FROM notification_push_tokens
            WHERE recovery_scope_mac = decode(${item.scopeMac}, 'hex')
          `;
        }
        await recordDeletionTombstone(transaction, item, {
          sequence: item.sequence,
          durableHead: replay.currentHead,
        });
      }
      await validateStoredPushTokens(
        transaction,
        this.#dependencies.tokenKeyProvider,
      );
      const confirmedHead =
        await this.#dependencies.deletionLedger.currentHead();
      if (confirmedHead !== replay.currentHead) {
        throw new StoreNotReadyError("deletion ledger advanced during restore");
      }
      await assertNotificationMigrationIntegrity(transaction);
      await transaction`
        UPDATE notification_service_state
        SET restore_state = 'ready', ledger_watermark = ${replay.currentHead},
            ledger_head = ${replay.currentHead}, mutations_enabled = true,
            monitors_enabled = false, delivery_enabled = false,
            updated_at = clock_timestamp()
        WHERE singleton AND schema_phase = 'contracted'
      `;
    });
    return { appliedThrough: replay.currentHead };
  }

  async activateWorkerGates(): Promise<void> {
    const version = await assertNotificationMigrationIntegrity(this.#sql);
    if (version < 4) {
      throw new StoreNotReadyError("notification worker schema is unavailable");
    }
    await validateStoredPushTokens(
      this.#sql,
      this.#dependencies.tokenKeyProvider,
    );
    await this.#sql.begin(async (transaction) => {
      const states = await transaction<
        {
          schema_phase: string;
          restore_state: string;
          mutations_enabled: boolean;
          ledger_watermark: string | number;
          ledger_head: string | number;
        }[]
      >`
        SELECT schema_phase, restore_state, mutations_enabled,
               ledger_watermark, ledger_head
        FROM notification_service_state WHERE singleton FOR UPDATE
      `;
      const state = states[0];
      if (
        state?.schema_phase !== "contracted" ||
        state.restore_state !== "ready" ||
        !state.mutations_enabled ||
        Number(state.ledger_head) !== Number(state.ledger_watermark)
      ) {
        throw new StoreNotReadyError("notification restore fence is not ready");
      }
      const invalid = await transaction<{ count: number }[]>`
        SELECT count(*)::int AS count
        FROM notification_rules r
        LEFT JOIN notification_installations i
          ON i.installation_id = r.installation_id AND i.state = 'active'
        LEFT JOIN notification_push_tokens t
          ON t.installation_id = r.installation_id
         AND t.provider = 'expo' AND t.delivery_state = 'active'
        LEFT JOIN notification_account_links l
          ON l.account_link_id = r.account_link_id
         AND l.installation_id = r.installation_id AND l.state = 'active'
        WHERE r.active AND (
          i.installation_id IS NULL OR t.token_id IS NULL OR
          (r.account_link_id IS NOT NULL AND l.account_link_id IS NULL)
        )
      `;
      const draining = await transaction<{ count: number }[]>`
        SELECT count(*)::int AS count FROM notification_revocation_operations
        WHERE state = 'draining'
      `;
      if ((invalid[0]?.count ?? 0) !== 0 || (draining[0]?.count ?? 0) !== 0) {
        throw new StoreNotReadyError(
          "notification authorization fence is not ready",
        );
      }
      await transaction`
        UPDATE notification_service_state
        SET monitors_enabled = true, delivery_enabled = true,
            updated_at = clock_timestamp()
        WHERE singleton
      `;
    });
  }

  async deactivateWorkerGates(): Promise<void> {
    await this.#sql`
      UPDATE notification_service_state
      SET monitors_enabled = false, delivery_enabled = false,
          updated_at = clock_timestamp()
      WHERE singleton
    `;
  }

  async acquireMonitorLease(input: {
    readonly leaseKey: string;
    readonly ownerId: string;
  }): Promise<
    | { readonly acquired: false }
    | { readonly acquired: true; readonly generation: number }
  > {
    validateLeaseIdentity(input.leaseKey, input.ownerId);
    return this.#sql.begin(async (transaction) => {
      await assertMonitorsEnabled(transaction);
      const rows = await transaction<{ lease_generation: number }[]>`
        INSERT INTO notification_monitor_leases (
          lease_key, owner_id, expires_at, renewed_at, lease_generation
        ) VALUES (
          ${input.leaseKey}, ${input.ownerId},
          clock_timestamp() + interval '30 seconds', clock_timestamp(), 1
        )
        ON CONFLICT (lease_key) DO UPDATE SET
          owner_id = EXCLUDED.owner_id,
          expires_at = EXCLUDED.expires_at,
          renewed_at = EXCLUDED.renewed_at,
          lease_generation = notification_monitor_leases.lease_generation + 1
        WHERE notification_monitor_leases.expires_at <= clock_timestamp()
        RETURNING lease_generation
      `;
      const generation = rows[0]?.lease_generation;
      return generation === undefined
        ? { acquired: false as const }
        : { acquired: true as const, generation };
    });
  }

  async renewMonitorLease(input: {
    readonly leaseKey: string;
    readonly ownerId: string;
    readonly generation: number;
  }): Promise<boolean> {
    validateLeaseIdentity(input.leaseKey, input.ownerId);
    if (!Number.isSafeInteger(input.generation) || input.generation < 1) {
      throw new StoreConflictError("monitor lease generation is invalid");
    }
    return this.#sql.begin(async (transaction) => {
      await assertMonitorsEnabled(transaction);
      const rows = await transaction<{ lease_key: string }[]>`
        UPDATE notification_monitor_leases
        SET expires_at = clock_timestamp() + interval '30 seconds',
            renewed_at = clock_timestamp()
        WHERE lease_key = ${input.leaseKey} AND owner_id = ${input.ownerId}
          AND lease_generation = ${input.generation}
          AND expires_at > clock_timestamp()
        RETURNING lease_key
      `;
      return rows.length === 1;
    });
  }

  async releaseMonitorLease(input: {
    readonly leaseKey: string;
    readonly ownerId: string;
    readonly generation: number;
  }): Promise<void> {
    validateLeaseIdentity(input.leaseKey, input.ownerId);
    if (!Number.isSafeInteger(input.generation) || input.generation < 1) return;
    await this.#sql`
      DELETE FROM notification_monitor_leases
      WHERE lease_key = ${input.leaseKey} AND owner_id = ${input.ownerId}
        AND lease_generation = ${input.generation}
    `;
  }

  async readWorkerHealthSnapshot(): Promise<NotificationWorkerHealthSnapshot> {
    await assertDeliveryEnabled(this.#sql);
    const rows = await this.#sql<
      {
        monitor_leases: number;
        outbox_pending: number;
        receipt_pending: number;
      }[]
    >`
      SELECT
        (SELECT count(*)::int FROM notification_monitor_leases
          WHERE lease_key <> ${NOTIFICATION_EGRESS_LEASE_KEY}
            AND expires_at > clock_timestamp()) AS monitor_leases,
        (SELECT count(*)::int FROM notification_outbox
          WHERE state IN ('pending', 'leased', 'provider_submission_started'))
          AS outbox_pending,
        (SELECT count(*)::int FROM notification_provider_tickets
          WHERE receipt_state = 'pending') AS receipt_pending
    `;
    return {
      monitorLeases: rows[0]?.monitor_leases ?? 0,
      outboxPending: rows[0]?.outbox_pending ?? 0,
      receiptPending: rows[0]?.receipt_pending ?? 0,
    };
  }

  async listActiveRules(
    limit = 1_000,
    afterRuleId = "",
  ): Promise<
    readonly {
      readonly ruleId: string;
      readonly identityDigest: string;
      readonly installationId: string;
      readonly accountLinkId?: string;
      readonly accountAddress?: string;
      readonly scope: "price" | "account";
      readonly network: "testnet" | "mainnet";
      readonly marketId: string;
      readonly eventType:
        | "fill"
        | "cancellation"
        | "rejection"
        | "margin_risk"
        | "liquidation_risk"
        | "price_above"
        | "price_below"
        | "funding_above"
        | "funding_below";
      readonly threshold: string;
    }[]
  > {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
      throw new StoreConflictError("notification rule read limit is invalid");
    }
    if (afterRuleId !== "" && !/^[0-9a-f]{32}$/.test(afterRuleId)) {
      throw new StoreConflictError("notification rule cursor is invalid");
    }
    await assertMonitorsEnabled(this.#sql);
    const rows = await this.#sql<
      {
        rule_id: string;
        identity_digest: string;
        installation_id: string;
        account_link_id: string | null;
        target_account: string | null;
        scope: "price" | "account";
        network: "testnet" | "mainnet";
        market_id: string;
        event_type:
          | "fill"
          | "cancellation"
          | "rejection"
          | "margin_risk"
          | "liquidation_risk"
          | "price_above"
          | "price_below"
          | "funding_above"
          | "funding_below";
        threshold: string;
      }[]
    >`
      SELECT r.rule_id, encode(r.identity_digest, 'hex') AS identity_digest,
             r.installation_id, r.account_link_id, l.target_account, r.scope,
             r.network, r.market_id, r.event_type, r.threshold
      FROM notification_rules r
      JOIN notification_installations i
        ON i.installation_id = r.installation_id AND i.state = 'active'
      JOIN notification_push_tokens t
        ON t.installation_id = r.installation_id
       AND t.provider = 'expo' AND t.delivery_state = 'active'
      LEFT JOIN notification_account_links l
        ON l.account_link_id = r.account_link_id
       AND l.installation_id = r.installation_id AND l.state = 'active'
      WHERE r.active AND r.rule_id > ${afterRuleId}
        AND (r.account_link_id IS NULL OR l.account_link_id IS NOT NULL)
      ORDER BY r.rule_id LIMIT ${limit}
    `;
    return rows.map((row) => ({
      ruleId: row.rule_id,
      identityDigest: row.identity_digest,
      installationId: row.installation_id,
      ...(row.account_link_id ? { accountLinkId: row.account_link_id } : {}),
      ...(row.target_account ? { accountAddress: row.target_account } : {}),
      scope: row.scope,
      network: row.network,
      marketId: row.market_id,
      eventType: row.event_type,
      threshold: row.threshold,
    }));
  }

  async createAlertForRuleMatch(input: {
    readonly ruleId: string;
    readonly eventKey: string;
    readonly category: "execution" | "risk" | "price" | "funding";
    readonly routeHint: "trade" | "portfolio";
  }): Promise<
    | { readonly created: false }
    | {
        readonly created: true;
        readonly alertId: string;
        readonly outboxId: string;
      }
  > {
    if (
      !/^[0-9a-f]{32}$/.test(input.ruleId) ||
      !/^[0-9a-f]{64}$/.test(input.eventKey) ||
      !["execution", "risk", "price", "funding"].includes(input.category) ||
      !["trade", "portfolio"].includes(input.routeHint)
    ) {
      throw new StoreConflictError("notification alert input is invalid");
    }
    return this.#sql.begin(async (transaction) => {
      await assertMonitorsEnabled(transaction);
      const rules = await transaction<
        {
          installation_id: string;
          account_link_id: string | null;
          network: "testnet" | "mainnet";
          installation_generation: number;
          account_link_generation: number | null;
        }[]
      >`
        SELECT r.installation_id, r.account_link_id, r.network,
               i.revocation_generation AS installation_generation,
               l.revocation_generation AS account_link_generation
        FROM notification_rules r
        JOIN notification_installations i
          ON i.installation_id = r.installation_id AND i.state = 'active'
        JOIN notification_push_tokens t
          ON t.installation_id = r.installation_id
         AND t.provider = 'expo' AND t.delivery_state = 'active'
        LEFT JOIN notification_account_links l
          ON l.account_link_id = r.account_link_id
         AND l.installation_id = r.installation_id AND l.state = 'active'
        WHERE r.rule_id = ${input.ruleId} AND r.active
          AND (r.account_link_id IS NULL OR l.account_link_id IS NOT NULL)
        FOR UPDATE OF r, i
      `;
      const rule = rules[0];
      if (!rule) {
        throw new StoreUnauthorizedError("notification rule is not active");
      }
      const claimed = await transaction<{ event_key: Uint8Array }[]>`
        INSERT INTO notification_event_dedupe_keys (
          event_key, created_at, expires_at
        )
        VALUES (
          decode(${input.eventKey}, 'hex'), statement_timestamp(),
          statement_timestamp() + interval '7 days'
        ) ON CONFLICT DO NOTHING RETURNING event_key
      `;
      if (claimed.length === 0) return { created: false as const };
      const alertId = randomHex(16);
      const outboxId = randomHex(16);
      await transaction`
        INSERT INTO notification_alerts (
          alert_id, installation_id, account_link_id, account_link_scope_id,
          rule_id, category, network, route_hint
        ) VALUES (
          ${alertId}, ${rule.installation_id}, ${rule.account_link_id},
          ${rule.account_link_id}, ${input.ruleId}, ${input.category},
          ${rule.network}, ${input.routeHint}
        )
      `;
      await transaction`
        INSERT INTO notification_outbox (
          outbox_id, alert_id, installation_id, account_link_id,
          account_link_scope_id, account_link_generation, network,
          revocation_generation
        ) VALUES (
          ${outboxId}, ${alertId}, ${rule.installation_id},
          ${rule.account_link_id}, ${rule.account_link_id},
          ${rule.account_link_generation}, ${rule.network},
          ${rule.installation_generation}
        )
      `;
      return { created: true as const, alertId, outboxId };
    });
  }

  async recoverExpiredDispatches(limit: number): Promise<void> {
    validateBoundedBatch(limit, "notification worker batch is invalid");
    await this.#sql.begin(async (transaction) => {
      await assertDeliveryEnabled(transaction);
      await transaction`
        UPDATE notification_dispatch_permits
        SET state = 'finished', finished_at = clock_timestamp()
        WHERE permit_id IN (
          SELECT permit_id FROM notification_dispatch_permits
          WHERE state = 'submission_started'
            AND provider_deadline_at <= clock_timestamp()
          ORDER BY provider_deadline_at LIMIT ${limit} FOR UPDATE SKIP LOCKED
        )
      `;
      await transaction`
        UPDATE notification_outbox o
        SET state = 'provider_outcome_unknown', lease_owner = NULL,
            lease_expires_at = NULL, updated_at = clock_timestamp()
        WHERE o.state = 'provider_submission_started' AND EXISTS (
          SELECT 1 FROM notification_dispatch_permits p
          WHERE p.outbox_id = o.outbox_id AND p.state = 'finished'
            AND p.provider_deadline_at <= clock_timestamp()
        )
      `;
      await transaction`
        UPDATE notification_dispatch_permits
        SET state = 'expired'
        WHERE permit_id IN (
          SELECT permit_id FROM notification_dispatch_permits
          WHERE state = 'active' AND expires_at <= clock_timestamp()
          ORDER BY expires_at LIMIT ${limit} FOR UPDATE SKIP LOCKED
        )
      `;
      await transaction`
        UPDATE notification_outbox o
        SET state = CASE WHEN claim_attempts < 8 THEN 'pending' ELSE 'cancelled' END,
            lease_owner = NULL, lease_expires_at = NULL,
            updated_at = clock_timestamp()
        WHERE o.state = 'leased' AND o.lease_expires_at <= clock_timestamp()
          AND NOT EXISTS (
            SELECT 1 FROM notification_dispatch_permits p
            WHERE p.outbox_id = o.outbox_id
              AND p.state IN ('active', 'submission_started')
          )
      `;
    });
  }

  async claimNextDispatch(
    workerId: string,
    fence: RuntimeEgressFence,
  ): Promise<{
    readonly permitId: string;
    readonly outboxId: string;
    readonly alertId: string;
    readonly category: "execution" | "risk" | "price" | "funding";
    readonly network: "testnet" | "mainnet";
    readonly routeHint: string;
    readonly providerDeadlineAt: number;
  } | null> {
    validateWorkerId(workerId);
    validateRuntimeEgressFence(fence);
    return this.#sql.begin(async (transaction) => {
      await assertDeliveryEnabled(transaction);
      await assertRuntimeEgressFence(transaction, fence);
      const rows = await transaction<
        {
          outbox_id: string;
          alert_id: string;
          installation_id: string;
          account_link_id: string | null;
          account_link_generation: number | null;
          network: "testnet" | "mainnet";
          revocation_generation: number;
          category: "execution" | "risk" | "price" | "funding";
          route_hint: string;
        }[]
      >`
        SELECT o.outbox_id, o.alert_id, o.installation_id, o.account_link_id,
               o.account_link_generation, o.network, o.revocation_generation,
               a.category, a.route_hint
        FROM notification_outbox o
        JOIN notification_alerts a ON a.alert_id = o.alert_id
        JOIN notification_installations i
          ON i.installation_id = o.installation_id AND i.state = 'active'
         AND i.revocation_generation = o.revocation_generation
        JOIN notification_push_tokens t
          ON t.installation_id = o.installation_id
         AND t.provider = 'expo' AND t.delivery_state = 'active'
        LEFT JOIN notification_account_links l
          ON l.account_link_id = o.account_link_scope_id
         AND l.installation_id = o.installation_id AND l.state = 'active'
         AND l.revocation_generation = o.account_link_generation
        WHERE o.state = 'pending' AND o.claim_attempts < 8
          AND (o.account_link_scope_id IS NULL OR l.account_link_id IS NOT NULL)
        ORDER BY o.created_at, o.outbox_id
        LIMIT 1 FOR UPDATE OF o SKIP LOCKED
      `;
      const row = rows[0];
      if (!row) return null;
      const permitId = randomHex(16);
      const deadlines = await transaction<
        { provider_deadline_at_ms: string | number }[]
      >`
        INSERT INTO notification_dispatch_permits (
          permit_id, outbox_id, installation_id, account_link_id,
          account_link_scope_id, account_link_generation, network,
          revocation_generation, created_at, expires_at, provider_deadline_at
        ) VALUES (
          ${permitId}, ${row.outbox_id}, ${row.installation_id},
          ${row.account_link_id}, ${row.account_link_id},
          ${row.account_link_generation}, ${row.network},
          ${row.revocation_generation}, statement_timestamp(),
          statement_timestamp() + interval '30 seconds',
          statement_timestamp() + interval '10 seconds'
        )
        RETURNING floor(extract(epoch FROM provider_deadline_at) * 1000)::bigint
          AS provider_deadline_at_ms
      `;
      await transaction`
        UPDATE notification_outbox
        SET state = 'leased', lease_owner = ${workerId},
            lease_expires_at = clock_timestamp() + interval '30 seconds',
            claim_attempts = claim_attempts + 1,
            updated_at = clock_timestamp()
        WHERE outbox_id = ${row.outbox_id} AND state = 'pending'
      `;
      return {
        permitId,
        outboxId: row.outbox_id,
        alertId: row.alert_id,
        category: row.category,
        network: row.network,
        routeHint: row.route_hint,
        providerDeadlineAt: Number(deadlines[0]?.provider_deadline_at_ms),
      };
    });
  }

  async abandonUnstartedDispatch(permitId: string): Promise<void> {
    validateHexId(permitId, "dispatch permit");
    await this.#sql.begin(async (transaction) => {
      const permits = await transaction<{ outbox_id: string }[]>`
        UPDATE notification_dispatch_permits SET state = 'expired'
        WHERE permit_id = ${permitId} AND state = 'active'
        RETURNING outbox_id
      `;
      if (permits[0]) {
        await transaction`
          UPDATE notification_outbox
          SET state = CASE WHEN claim_attempts < 8 THEN 'pending' ELSE 'cancelled' END,
              lease_owner = NULL, lease_expires_at = NULL,
              updated_at = clock_timestamp()
          WHERE outbox_id = ${permits[0].outbox_id} AND state = 'leased'
        `;
      }
    });
  }

  async readDecryptedPushToken(permitId: string): Promise<string> {
    validateHexId(permitId, "dispatch permit");
    const rows = await this.#authorizedProviderRows(permitId);
    const row = rows[0];
    if (!row) throw new DeliveryAuthorizationError();
    return decryptPushToken(
      encryptedTokenFromRow(row),
      this.#dependencies.tokenKeyProvider,
    );
  }

  async authorizeProviderFetch(
    permitId: string,
    fence: RuntimeEgressFence,
  ): Promise<{ readonly providerDeadlineAt: number }> {
    validateHexId(permitId, "dispatch permit");
    validateRuntimeEgressFence(fence);
    const rows = await this.#authorizedProviderRows(permitId, fence);
    const row = rows[0];
    if (!row) throw new DeliveryAuthorizationError();
    return { providerDeadlineAt: Number(row.provider_deadline_at_ms) };
  }

  async recordProviderAccepted(
    permitId: string,
    ticketId: string,
  ): Promise<void> {
    validateHexId(permitId, "dispatch permit");
    if (!/^[\x21-\x7e]{1,256}$/.test(ticketId)) {
      throw new StoreConflictError("provider ticket ID is invalid");
    }
    await this.#sql.begin(async (transaction) => {
      const rows = await transaction<{ outbox_id: string; token_id: string }[]>`
        SELECT p.outbox_id, t.token_id
        FROM notification_dispatch_permits p
        JOIN notification_outbox o ON o.outbox_id = p.outbox_id
        JOIN notification_push_tokens t
          ON t.installation_id = p.installation_id AND t.provider = 'expo'
        WHERE p.permit_id = ${permitId} AND p.state = 'submission_started'
          AND o.state = 'provider_submission_started'
        FOR UPDATE OF p, o
      `;
      const row = rows[0];
      if (!row)
        throw new StoreConflictError("dispatch attempt is not in flight");
      await transaction`
        INSERT INTO notification_provider_tickets (
          provider_ticket_id, outbox_id, provider, accepted_at, token_id,
          next_receipt_at
        ) VALUES (
          ${ticketId}, ${row.outbox_id}, 'expo', clock_timestamp(),
          ${row.token_id}, clock_timestamp() + interval '15 minutes'
        )
      `;
      await finishDispatchInTransaction(
        transaction,
        permitId,
        "provider_accepted",
      );
    });
  }

  async recordProviderRejected(
    permitId: string,
    errorCode: DeliveryRejectionCode,
  ): Promise<void> {
    validateHexId(permitId, "dispatch permit");
    validateProviderErrorCode(errorCode);
    await this.#sql.begin(async (transaction) => {
      const permits = await transaction<
        { installation_id: string; outbox_id: string }[]
      >`
        SELECT installation_id, outbox_id FROM notification_dispatch_permits
        WHERE permit_id = ${permitId} AND state = 'submission_started'
        FOR UPDATE
      `;
      const permit = permits[0];
      if (!permit)
        throw new StoreConflictError("dispatch attempt is not in flight");
      if (errorCode === "device_not_registered") {
        await transaction`
          UPDATE notification_push_tokens
          SET delivery_state = 'invalid', invalidated_at = clock_timestamp(),
              updated_at = clock_timestamp()
          WHERE installation_id = ${permit.installation_id}
            AND provider = 'expo' AND delivery_state = 'active'
        `;
      }
      await transaction`
        UPDATE notification_outbox SET provider_error_code = ${errorCode}
        WHERE outbox_id = ${permit.outbox_id}
      `;
      await finishDispatchInTransaction(
        transaction,
        permitId,
        "provider_rejected",
      );
    });
  }

  async recordProviderOutcomeUnknown(permitId: string): Promise<void> {
    validateHexId(permitId, "dispatch permit");
    await this.finishDispatchPermit(permitId, "provider_outcome_unknown");
  }

  async recoverExpiredReceiptLeases(limit: number): Promise<void> {
    validateBoundedBatch(limit, "notification receipt batch is invalid");
    await this.#sql`
      UPDATE notification_provider_tickets
      SET receipt_lease_owner = NULL, receipt_lease_expires_at = NULL
      WHERE provider_ticket_id IN (
        SELECT provider_ticket_id FROM notification_provider_tickets
        WHERE receipt_state = 'pending'
          AND receipt_lease_expires_at <= clock_timestamp()
        ORDER BY receipt_lease_expires_at LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
    `;
  }

  async claimDueReceipts(
    workerId: string,
    limit: number,
    fence: RuntimeEgressFence,
  ): Promise<readonly string[]> {
    validateWorkerId(workerId);
    validateBoundedBatch(limit, "notification receipt batch is invalid");
    validateRuntimeEgressFence(fence);
    return this.#sql.begin(async (transaction) => {
      await assertDeliveryEnabled(transaction);
      await assertRuntimeEgressFence(transaction, fence);
      const rows = await transaction<{ provider_ticket_id: string }[]>`
        WITH due AS (
          SELECT provider_ticket_id FROM notification_provider_tickets
          WHERE receipt_state = 'pending' AND receipt_attempts < 5
            AND next_receipt_at <= clock_timestamp()
            AND receipt_lease_owner IS NULL
          ORDER BY next_receipt_at, provider_ticket_id LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        )
        UPDATE notification_provider_tickets t
        SET receipt_lease_owner = ${workerId},
            receipt_lease_expires_at = clock_timestamp() + interval '30 seconds'
        FROM due WHERE t.provider_ticket_id = due.provider_ticket_id
        RETURNING t.provider_ticket_id
      `;
      return rows.map((row) => row.provider_ticket_id);
    });
  }

  async completeReceipt(
    ticketId: string,
    workerId: string,
    result: Exclude<ExpoReceiptResult, { readonly kind: "pending" }>,
  ): Promise<void> {
    validateWorkerId(workerId);
    const status = result.kind === "delivered" ? "delivered" : "failed";
    const errorCode = result.kind === "failed" ? result.errorCode : null;
    if (errorCode) validateProviderErrorCode(errorCode);
    await this.#sql.begin(async (transaction) => {
      const tickets = await transaction<{ token_id: string | null }[]>`
        UPDATE notification_provider_tickets
        SET receipt_state = ${status}, receipt_error_code = ${errorCode},
            receipt_lease_owner = NULL, receipt_lease_expires_at = NULL
        WHERE provider_ticket_id = ${ticketId} AND receipt_state = 'pending'
          AND receipt_lease_owner = ${workerId}
          AND receipt_lease_expires_at > clock_timestamp()
        RETURNING token_id
      `;
      const ticket = tickets[0];
      if (!ticket) throw new StoreConflictError("receipt lease is unavailable");
      await transaction`
        INSERT INTO notification_delivery_receipts (
          receipt_id, provider_ticket_id, status
        ) VALUES (${randomHex(16)}, ${ticketId}, ${status})
      `;
      if (errorCode === "device_not_registered" && ticket.token_id) {
        await transaction`
          UPDATE notification_push_tokens
          SET delivery_state = 'invalid', invalidated_at = clock_timestamp(),
              updated_at = clock_timestamp()
          WHERE token_id = ${ticket.token_id} AND delivery_state = 'active'
        `;
      }
    });
  }

  async deferReceipt(ticketId: string, workerId: string): Promise<void> {
    validateWorkerId(workerId);
    await this.#sql.begin(async (transaction) => {
      const rows = await transaction<{ receipt_attempts: number }[]>`
        SELECT receipt_attempts FROM notification_provider_tickets
        WHERE provider_ticket_id = ${ticketId} AND receipt_state = 'pending'
          AND receipt_lease_owner = ${workerId}
          AND receipt_lease_expires_at > clock_timestamp()
        FOR UPDATE
      `;
      const nextAttempt = (rows[0]?.receipt_attempts ?? -1) + 1;
      if (nextAttempt < 0) {
        throw new StoreConflictError("receipt lease is unavailable");
      }
      if (nextAttempt >= 5) {
        await transaction`
          UPDATE notification_provider_tickets
          SET receipt_state = 'unknown', receipt_attempts = 5,
              receipt_lease_owner = NULL, receipt_lease_expires_at = NULL
          WHERE provider_ticket_id = ${ticketId}
        `;
        await transaction`
          INSERT INTO notification_delivery_receipts (
            receipt_id, provider_ticket_id, status
          ) VALUES (${randomHex(16)}, ${ticketId}, 'unknown')
        `;
        return;
      }
      const delayMinutes = 15 * 2 ** nextAttempt;
      await transaction`
        UPDATE notification_provider_tickets
        SET receipt_attempts = ${nextAttempt},
            next_receipt_at = clock_timestamp() + ${`${delayMinutes} minutes`}::interval,
            receipt_lease_owner = NULL, receipt_lease_expires_at = NULL
        WHERE provider_ticket_id = ${ticketId}
      `;
    });
  }

  async #authorizedProviderRows(
    permitId: string,
    fence?: RuntimeEgressFence,
  ): Promise<
    (EncryptedTokenRow & {
      readonly provider_deadline_at_ms: string | number;
      readonly token_id: string;
    })[]
  > {
    return this.#sql<
      (EncryptedTokenRow & {
        readonly provider_deadline_at_ms: string | number;
        readonly token_id: string;
      })[]
    >`
      SELECT t.token_id, t.installation_id, t.provider,
             encode(t.token_fingerprint, 'hex') AS fingerprint,
             t.ciphertext, encode(t.nonce, 'hex') AS nonce,
             t.key_version, t.wrapped_dek,
             floor(extract(epoch FROM p.provider_deadline_at) * 1000)::bigint
               AS provider_deadline_at_ms
      FROM notification_dispatch_permits p
      JOIN notification_outbox o
        ON o.outbox_id = p.outbox_id
       AND o.installation_id = p.installation_id
       AND o.revocation_generation = p.revocation_generation
      JOIN notification_installations i
        ON i.installation_id = p.installation_id AND i.state = 'active'
       AND i.revocation_generation = p.revocation_generation
      JOIN notification_push_tokens t
        ON t.installation_id = p.installation_id
       AND t.provider = 'expo' AND t.delivery_state = 'active'
      LEFT JOIN notification_account_links l
        ON l.account_link_id = p.account_link_scope_id
       AND l.installation_id = p.installation_id AND l.state = 'active'
       AND l.revocation_generation = p.account_link_generation
      CROSS JOIN notification_service_state s
      WHERE p.permit_id = ${permitId} AND p.state = 'submission_started'
        AND p.provider_deadline_at > clock_timestamp()
        AND o.state = 'provider_submission_started'
        AND o.account_link_scope_id IS NOT DISTINCT FROM p.account_link_scope_id
        AND (p.account_link_scope_id IS NULL OR l.account_link_id IS NOT NULL)
        AND s.singleton AND s.delivery_enabled
        AND (${fence === undefined} OR EXISTS (
          SELECT 1 FROM notification_monitor_leases runtime_lease
          WHERE runtime_lease.lease_key = ${fence?.leaseKey ?? ""}
            AND runtime_lease.owner_id = ${fence?.ownerId ?? ""}
            AND runtime_lease.lease_generation = ${fence?.generation ?? 0}
            AND runtime_lease.expires_at > clock_timestamp()
        ))
    `;
  }

  async cleanupRetention(batchSize: number): Promise<{
    readonly challenges: number;
    readonly dedupeKeys: number;
    readonly deliveryRows: number;
  }> {
    if (
      !Number.isSafeInteger(batchSize) ||
      batchSize < 1 ||
      batchSize > 1_000
    ) {
      throw new StoreConflictError(
        "retention batch size must be between 1 and 1000",
      );
    }
    return this.#sql.begin(async (transaction) => {
      await assertMutable(transaction);
      const challenges = await transaction<{ challenge_id: string }[]>`
        DELETE FROM notification_account_link_challenges
        WHERE challenge_id IN (
          SELECT challenge_id FROM notification_account_link_challenges
          WHERE expires_at < clock_timestamp() - interval '24 hours'
          ORDER BY expires_at LIMIT ${batchSize} FOR UPDATE SKIP LOCKED
        ) RETURNING challenge_id
      `;
      const dedupe = await transaction<{ event_key: Uint8Array }[]>`
        DELETE FROM notification_event_dedupe_keys
        WHERE event_key IN (
          SELECT event_key FROM notification_event_dedupe_keys
          WHERE expires_at < clock_timestamp()
          ORDER BY expires_at LIMIT ${batchSize} FOR UPDATE SKIP LOCKED
        ) RETURNING event_key
      `;
      await transaction`
        DELETE FROM notification_admission_events
        WHERE event_id IN (
          SELECT event_id FROM notification_admission_events
          WHERE occurred_at < clock_timestamp() - interval '1 hour'
          ORDER BY occurred_at LIMIT ${batchSize} FOR UPDATE SKIP LOCKED
        )
      `;
      await transaction`
        DELETE FROM notification_delivery_receipts
        WHERE provider_ticket_id IN (
          SELECT provider_ticket_id FROM notification_provider_tickets
          WHERE created_at < clock_timestamp() - interval '30 days'
          ORDER BY created_at LIMIT ${batchSize}
        )
      `;
      await transaction`
        DELETE FROM notification_provider_tickets
        WHERE outbox_id IN (
          SELECT o.outbox_id FROM notification_outbox o
          JOIN notification_alerts a ON a.alert_id = o.alert_id
          WHERE a.created_at < clock_timestamp() - interval '30 days'
          ORDER BY a.created_at LIMIT ${batchSize}
        )
      `;
      await transaction`
        DELETE FROM notification_dispatch_permits
        WHERE outbox_id IN (
          SELECT o.outbox_id FROM notification_outbox o
          JOIN notification_alerts a ON a.alert_id = o.alert_id
          WHERE a.created_at < clock_timestamp() - interval '30 days'
          ORDER BY a.created_at LIMIT ${batchSize}
        )
      `;
      await transaction`
        DELETE FROM notification_outbox
        WHERE alert_id IN (
          SELECT alert_id FROM notification_alerts
          WHERE created_at < clock_timestamp() - interval '30 days'
          ORDER BY created_at LIMIT ${batchSize}
        )
      `;
      const delivery = await transaction<{ alert_id: string }[]>`
        DELETE FROM notification_alerts
        WHERE alert_id IN (
          SELECT alert_id FROM notification_alerts
          WHERE created_at < clock_timestamp() - interval '30 days'
          ORDER BY created_at LIMIT ${batchSize}
        ) RETURNING alert_id
      `;
      return {
        challenges: challenges.length,
        dedupeKeys: dedupe.length,
        deliveryRows: delivery.length,
      };
    });
  }

  async #withProofAttempt<T>(
    ip: string | undefined,
    work: () => Promise<T>,
  ): Promise<T> {
    if (!ip) return work();
    const attemptId = await this.#sql.begin(async (transaction) => {
      await transaction`
        SELECT pg_advisory_xact_lock(hashtextextended(${`proof:${ip}`}, 0))
      `;
      const counts = await transaction<{ count: number }[]>`
        SELECT count(*)::int AS count FROM notification_admission_events
        WHERE kind = 'failed_proof' AND ip_address = ${ip}::inet
          AND status IN ('pending', 'failed')
          AND occurred_at > clock_timestamp() - interval '1 hour'
      `;
      if ((counts[0]?.count ?? 0) >= CONTRACT_LIMITS.failedProofsPerIpHour) {
        throw new StoreRateLimitError(
          "failed proof limit exceeded",
          60 * 60 * 1000,
        );
      }
      const rows = await transaction<{ event_id: string | number }[]>`
        INSERT INTO notification_admission_events (kind, ip_address, status)
        VALUES ('failed_proof', ${ip}::inet, 'pending') RETURNING event_id
      `;
      const eventId = rows[0]?.event_id;
      if (eventId === undefined)
        throw new StoreConflictError("proof admission failed");
      return Number(eventId);
    });
    try {
      const result = await work();
      await this.#sql`
        DELETE FROM notification_admission_events
        WHERE event_id = ${attemptId} AND kind = 'failed_proof' AND status = 'pending'
      `;
      return result;
    } catch (error) {
      const isProofFailure =
        error instanceof StoreUnauthorizedError ||
        error instanceof AccountProofError;
      if (isProofFailure) {
        await this.#sql`
          UPDATE notification_admission_events SET status = 'failed'
          WHERE event_id = ${attemptId} AND kind = 'failed_proof' AND status = 'pending'
        `;
      } else {
        await this.#sql`
          DELETE FROM notification_admission_events
          WHERE event_id = ${attemptId} AND kind = 'failed_proof' AND status = 'pending'
        `;
      }
      if (error instanceof AccountProofError) {
        throw new StoreUnauthorizedError("account proof is invalid");
      }
      throw error;
    }
  }

  async #scopeMac(
    kind: DeletionScopeKind,
    identifier: string,
  ): Promise<string> {
    return this.#dependencies.tombstoneKeyProvider.mac(
      this.#dependencies.tombstoneKeyVersion,
      new TextEncoder().encode(`scope/v1|${kind}|${identifier}`),
    );
  }
}

async function assertMonitorsEnabled(sql: SQL): Promise<void> {
  const rows = await sql<
    {
      schema_phase: string;
      restore_state: string;
      monitors_enabled: boolean;
    }[]
  >`
    SELECT schema_phase, restore_state, monitors_enabled
    FROM notification_service_state WHERE singleton FOR SHARE
  `;
  const state = rows[0];
  if (
    state?.schema_phase !== "contracted" ||
    state.restore_state !== "ready" ||
    !state.monitors_enabled
  ) {
    throw new StoreNotReadyError("notification monitors are not ready");
  }
}

async function assertDeliveryEnabled(sql: SQL): Promise<void> {
  const rows = await sql<
    {
      schema_phase: string;
      restore_state: string;
      delivery_enabled: boolean;
    }[]
  >`
    SELECT schema_phase, restore_state, delivery_enabled
    FROM notification_service_state WHERE singleton FOR SHARE
  `;
  const state = rows[0];
  if (
    state?.schema_phase !== "contracted" ||
    state.restore_state !== "ready" ||
    !state.delivery_enabled
  ) {
    throw new StoreNotReadyError("notification delivery is not ready");
  }
}

function validateRuntimeEgressFence(fence: RuntimeEgressFence): void {
  if (
    fence.leaseKey !== NOTIFICATION_EGRESS_LEASE_KEY ||
    !/^[a-z0-9:_-]{1,128}$/.test(fence.ownerId) ||
    !Number.isSafeInteger(fence.generation) ||
    fence.generation < 1
  ) {
    throw new StoreConflictError("notification egress fence is invalid");
  }
}

async function assertRuntimeEgressFence(
  sql: SQL,
  fence: RuntimeEgressFence,
): Promise<void> {
  const rows = await sql<{ authorized: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM notification_monitor_leases
      WHERE lease_key = ${fence.leaseKey} AND owner_id = ${fence.ownerId}
        AND lease_generation = ${fence.generation}
        AND expires_at > clock_timestamp()
    ) AS authorized
  `;
  if (!rows[0]?.authorized) {
    throw new StoreNotReadyError(
      "notification egress ownership is unavailable",
    );
  }
}

async function finishDispatchInTransaction(
  sql: SQL,
  permitId: string,
  outcome:
    | "provider_accepted"
    | "provider_rejected"
    | "provider_outcome_unknown",
): Promise<void> {
  const permits = await sql<{ outbox_id: string }[]>`
    UPDATE notification_dispatch_permits
    SET state = 'finished', finished_at = clock_timestamp()
    WHERE permit_id = ${permitId} AND state = 'submission_started'
    RETURNING outbox_id
  `;
  const permit = permits[0];
  if (!permit)
    throw new StoreConflictError("dispatch attempt is not in flight");
  const rows = await sql<{ outbox_id: string }[]>`
    UPDATE notification_outbox
    SET state = ${outcome}, lease_owner = NULL, lease_expires_at = NULL,
        updated_at = clock_timestamp()
    WHERE outbox_id = ${permit.outbox_id}
      AND state = 'provider_submission_started'
    RETURNING outbox_id
  `;
  if (rows.length !== 1) {
    throw new StoreConflictError("dispatch outbox is not in flight");
  }
}

function validateLeaseIdentity(leaseKey: string, ownerId: string): void {
  if (
    !/^[\x21-\x7e]{1,256}$/.test(leaseKey) ||
    !/^[a-z0-9:_-]{1,128}$/.test(ownerId)
  ) {
    throw new StoreConflictError("monitor lease identity is invalid");
  }
}

function validateWorkerId(workerId: string): void {
  if (!/^[a-z0-9:_-]{1,128}$/.test(workerId)) {
    throw new StoreConflictError("notification worker ID is invalid");
  }
}

function validateHexId(value: string, label: string): void {
  if (!/^[0-9a-f]{32}$/.test(value)) {
    throw new StoreConflictError(`${label} ID is invalid`);
  }
}

function validateBoundedBatch(limit: number, errorMessage: string): void {
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > EXPO_RECEIPT_BATCH_SIZE
  ) {
    throw new StoreConflictError(errorMessage);
  }
}

function validateProviderErrorCode(errorCode: string): void {
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(errorCode)) {
    throw new StoreConflictError("provider error code is invalid");
  }
}

async function fenceAccountLinkDispatchWork(
  sql: SQL,
  accountLinkId: string,
  deletionId: string,
  forceUnknown: boolean,
): Promise<void> {
  await sql`
    UPDATE notification_outbox o
    SET account_link_scope_id = COALESCE(o.account_link_scope_id, ${accountLinkId}),
        deletion_id = ${deletionId},
        state = CASE
          WHEN o.state = 'provider_submission_started' AND (
            ${forceUnknown} OR EXISTS (
              SELECT 1 FROM notification_dispatch_permits p
              WHERE p.outbox_id = o.outbox_id
                AND p.state = 'submission_started'
                AND p.provider_deadline_at <= clock_timestamp()
            )
          ) THEN 'provider_outcome_unknown'
          WHEN o.state IN ('pending', 'leased') THEN 'cancelled'
          ELSE o.state
        END,
        updated_at = clock_timestamp()
    WHERE o.account_link_id = ${accountLinkId}
       OR o.account_link_scope_id = ${accountLinkId}
  `;
  await sql`
    UPDATE notification_dispatch_permits
    SET account_link_scope_id = COALESCE(account_link_scope_id, ${accountLinkId}),
        deletion_id = ${deletionId},
        state = CASE
          WHEN state = 'active' THEN 'expired'
          WHEN state = 'submission_started'
            AND (${forceUnknown} OR provider_deadline_at <= clock_timestamp())
            THEN 'finished'
          ELSE state
        END,
        finished_at = CASE
          WHEN state = 'submission_started'
            AND (${forceUnknown} OR provider_deadline_at <= clock_timestamp())
            THEN clock_timestamp()
          ELSE finished_at
        END
    WHERE account_link_id = ${accountLinkId}
       OR account_link_scope_id = ${accountLinkId}
  `;
  await sql`
    UPDATE notification_alerts
    SET account_link_scope_id = COALESCE(account_link_scope_id, ${accountLinkId}),
        deletion_id = ${deletionId}
    WHERE account_link_id = ${accountLinkId}
       OR account_link_scope_id = ${accountLinkId}
  `;
}

async function fenceInstallationDispatchWork(
  sql: SQL,
  installationId: string,
  deletionId: string,
  forceUnknown: boolean,
): Promise<void> {
  await sql`
    UPDATE notification_outbox o
    SET deletion_id = ${deletionId},
        account_link_scope_id = COALESCE(o.account_link_scope_id, o.account_link_id),
        state = CASE
          WHEN o.state = 'provider_submission_started' AND (
            ${forceUnknown} OR EXISTS (
              SELECT 1 FROM notification_dispatch_permits p
              WHERE p.outbox_id = o.outbox_id
                AND p.state = 'submission_started'
                AND p.provider_deadline_at <= clock_timestamp()
            )
          ) THEN 'provider_outcome_unknown'
          WHEN o.state IN ('pending', 'leased') THEN 'cancelled'
          ELSE o.state
        END,
        updated_at = clock_timestamp()
    WHERE o.installation_id = ${installationId}
  `;
  await sql`
    UPDATE notification_dispatch_permits
    SET deletion_id = ${deletionId},
        account_link_scope_id = COALESCE(account_link_scope_id, account_link_id),
        state = CASE
          WHEN state = 'active' THEN 'expired'
          WHEN state = 'submission_started'
            AND (${forceUnknown} OR provider_deadline_at <= clock_timestamp())
            THEN 'finished'
          ELSE state
        END,
        finished_at = CASE
          WHEN state = 'submission_started'
            AND (${forceUnknown} OR provider_deadline_at <= clock_timestamp())
            THEN clock_timestamp()
          ELSE finished_at
        END
    WHERE installation_id = ${installationId}
  `;
  await sql`
    UPDATE notification_alerts
    SET deletion_id = ${deletionId},
        account_link_scope_id = COALESCE(account_link_scope_id, account_link_id)
    WHERE installation_id = ${installationId}
  `;
}

async function recordDeletionTombstone(
  sql: SQL,
  item: {
    readonly deletionId: string;
    readonly scopeKind: DeletionScopeKind;
    readonly scopeMac: string;
    readonly deletionGeneration: number;
    readonly keyVersion: string;
  },
  receipt: {
    readonly sequence: number;
    readonly durableHead: number;
  },
): Promise<void> {
  const recorded = await sql<{ deletion_id: string }[]>`
    INSERT INTO notification_deletion_tombstones (
      tombstone_id, deletion_id, scope_kind, scope_mac, deletion_generation,
      ledger_sequence, ledger_durable_head, key_version
    ) VALUES (
      ${randomHex(16)}, ${item.deletionId}, ${item.scopeKind},
      decode(${item.scopeMac}, 'hex'), ${item.deletionGeneration},
      ${receipt.sequence}, ${receipt.durableHead}, ${item.keyVersion}
    )
    ON CONFLICT (deletion_id) DO UPDATE
      SET ledger_durable_head = GREATEST(
        notification_deletion_tombstones.ledger_durable_head,
        EXCLUDED.ledger_durable_head
      )
    WHERE notification_deletion_tombstones.scope_kind = EXCLUDED.scope_kind
      AND notification_deletion_tombstones.scope_mac = EXCLUDED.scope_mac
      AND notification_deletion_tombstones.deletion_generation = EXCLUDED.deletion_generation
      AND notification_deletion_tombstones.ledger_sequence = EXCLUDED.ledger_sequence
      AND notification_deletion_tombstones.key_version = EXCLUDED.key_version
    RETURNING deletion_id
  `;
  if (recorded.length !== 1) {
    throw new StoreConflictError("local deletion tombstone conflicts");
  }
}

async function admitMutationInTransaction(
  sql: SQL,
  input: {
    readonly installationId?: string;
    readonly ip?: string;
    readonly kind?: "mutation" | "token_change";
  },
): Promise<void> {
  if (!input.ip) return;
  const kind = input.kind ?? "mutation";
  const actorKeys = [
    `ip:${input.ip}`,
    ...(input.installationId ? [`installation:${input.installationId}`] : []),
  ].sort();
  for (const actorKey of actorKeys) {
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${actorKey}, 0))`;
  }
  const counts = await sql<
    { ip_count: number; installation_count: number; token_count: number }[]
  >`
    SELECT
      count(*) FILTER (
        WHERE ip_address = ${input.ip}::inet
          AND kind IN ('mutation', 'token_change')
          AND occurred_at > clock_timestamp() - interval '1 minute'
      )::int AS ip_count,
      count(*) FILTER (
        WHERE installation_id = ${input.installationId ?? null}
          AND kind IN ('mutation', 'token_change')
          AND occurred_at > clock_timestamp() - interval '1 minute'
      )::int AS installation_count,
      count(*) FILTER (
        WHERE installation_id = ${input.installationId ?? null}
          AND kind = 'token_change'
          AND occurred_at > clock_timestamp() - interval '1 hour'
      )::int AS token_count
    FROM notification_admission_events
    WHERE occurred_at > clock_timestamp() - interval '1 hour'
      AND (
        ip_address = ${input.ip}::inet OR
        installation_id = ${input.installationId ?? null}
      )
  `;
  const count = counts[0];
  if ((count?.ip_count ?? 0) >= CONTRACT_LIMITS.ipMutationsPerMinute) {
    throw new StoreRateLimitError("IP mutation limit exceeded", 60_000);
  }
  if (
    input.installationId &&
    (count?.installation_count ?? 0) >=
      CONTRACT_LIMITS.installationMutationsPerMinute
  ) {
    throw new StoreRateLimitError(
      "installation mutation limit exceeded",
      60_000,
    );
  }
  if (
    kind === "token_change" &&
    input.installationId &&
    (count?.token_count ?? 0) >= CONTRACT_LIMITS.tokenChangesPerHour
  ) {
    throw new StoreRateLimitError(
      "token change limit exceeded",
      60 * 60 * 1000,
    );
  }
  await sql`
    INSERT INTO notification_admission_events (
      kind, installation_id, ip_address, status
    ) VALUES (
      ${kind}, ${input.installationId ?? null}, ${input.ip}::inet, 'committed'
    )
  `;
}

async function verifyAccountRelationship(
  verifier: AccountRelationshipVerifier,
  input: {
    readonly network: NotificationNetwork;
    readonly masterAccount: string;
    readonly targetAccount: string;
  },
): Promise<AccountRelationshipResult> {
  const controller = new AbortController();
  const deadlineAtMs = Date.now() + ACCOUNT_RELATIONSHIP_TIMEOUT_MS;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(() =>
        verifier({
          ...input,
          signal: controller.signal,
          deadlineAtMs,
        }),
      ),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          controller.abort(
            new StoreDependencyUnavailableError(
              "account relationship verification timed out",
            ),
          );
          reject(controller.signal.reason);
        }, ACCOUNT_RELATIONSHIP_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    if (error instanceof StoreDependencyUnavailableError) throw error;
    throw new StoreDependencyUnavailableError(
      "account relationship verification failed",
    );
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function assertSupportedRelationship(
  relationship: AccountRelationshipResult,
): void {
  if (
    !relationship.supported ||
    !/^[a-z0-9_-]{1,64}$/.test(relationship.relationshipResult)
  ) {
    throw new StoreUnauthorizedError("target relationship is not supported");
  }
}

function randomHex(bytes: number): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString(
    "hex",
  );
}

interface EncryptedTokenRow {
  readonly installation_id: string;
  readonly provider: "expo";
  readonly fingerprint: string;
  readonly ciphertext: Uint8Array;
  readonly nonce: string;
  readonly key_version: string;
  readonly wrapped_dek: Uint8Array;
}

function encryptedTokenFromRow(row: EncryptedTokenRow) {
  return {
    installationId: row.installation_id,
    provider: row.provider,
    tokenFingerprint: row.fingerprint,
    ciphertext: Buffer.from(row.ciphertext).toString("base64"),
    nonce: row.nonce,
    keyVersion: row.key_version,
    wrappedDek: Buffer.from(row.wrapped_dek).toString("base64"),
  } as const;
}

async function validateStoredPushTokens(
  sql: SQL,
  keyProvider: PushTokenKeyProvider,
): Promise<void> {
  let afterTokenId = "";
  while (true) {
    const rows = await sql<
      (EncryptedTokenRow & { readonly token_id: string })[]
    >`
      SELECT token_id, installation_id, provider,
             encode(token_fingerprint, 'hex') AS fingerprint,
             ciphertext, encode(nonce, 'hex') AS nonce, key_version, wrapped_dek
      FROM notification_push_tokens
      WHERE token_id > ${afterTokenId}
      ORDER BY token_id LIMIT 100
    `;
    for (const row of rows) {
      await decryptPushToken(encryptedTokenFromRow(row), keyProvider);
    }
    if (rows.length < 100) return;
    afterTokenId = rows.at(-1)?.token_id ?? afterTokenId;
  }
}

async function assertMutable(sql: SQL): Promise<void> {
  const states = await sql<
    {
      schema_phase: string;
      restore_state: string;
      mutations_enabled: boolean;
    }[]
  >`
    SELECT schema_phase, restore_state, mutations_enabled
    FROM notification_service_state WHERE singleton FOR SHARE
  `;
  const state = states[0];
  if (
    state?.schema_phase !== "contracted" ||
    state.restore_state !== "ready" ||
    !state.mutations_enabled
  ) {
    throw new StoreNotReadyError();
  }
}

async function lockAuthenticatedInstallation(
  sql: SQL,
  installationId: string,
  credentialHash: string,
): Promise<{ readonly revocation_generation: number }> {
  const rows = await sql<
    {
      credential_hash: string | null;
      state: string;
      revocation_generation: number;
    }[]
  >`
    SELECT encode(credential_hash, 'hex') AS credential_hash, state, revocation_generation
    FROM notification_installations
    WHERE installation_id = ${installationId} FOR UPDATE
  `;
  const row = rows[0];
  if (
    !row?.credential_hash ||
    row.state !== "active" ||
    !safeHashEqual(credentialHash, row.credential_hash)
  ) {
    throw new StoreUnauthorizedError();
  }
  return { revocation_generation: row.revocation_generation };
}

async function loadChallengeForUpdate(
  sql: SQL,
  challengeHash: string,
): Promise<ChallengeRow | undefined> {
  const rows = await sql<ChallengeRow[]>`
    SELECT encode(challenge_hash, 'hex') AS challenge_hash,
           encode(credential_hash, 'hex') AS credential_hash,
           installation_id, network, master_account, target_account, purpose,
           encode(operation_digest, 'hex') AS operation_digest,
           service_origin,
           floor(extract(epoch FROM issued_at) * 1000)::bigint AS issued_at_ms,
           floor(extract(epoch FROM expires_at) * 1000)::bigint AS expires_at_ms,
           state
    FROM notification_account_link_challenges
    WHERE challenge_hash = decode(${challengeHash}, 'hex') FOR UPDATE
  `;
  return rows[0];
}

async function prevalidatePushTokenRebind(
  sql: SQL,
  input: {
    readonly installationId: string;
    readonly accountLinkId: string;
    readonly credentialHash: string;
    readonly challengeHash: string;
    readonly expectedDigest: string;
    readonly proof: {
      readonly challenge: string;
      readonly message: string;
      readonly signature: Hex;
    };
  },
): Promise<AccountProofChallengeRecord> {
  const installations = await sql<
    { credential_hash: string | null; state: string }[]
  >`
    SELECT encode(credential_hash, 'hex') AS credential_hash, state
    FROM notification_installations WHERE installation_id = ${input.installationId}
  `;
  const installation = installations[0];
  if (
    installation?.state !== "active" ||
    !installation.credential_hash ||
    !safeHashEqual(input.credentialHash, installation.credential_hash)
  ) {
    throw new StoreUnauthorizedError();
  }
  const challenges = await sql<ChallengeRow[]>`
    SELECT encode(challenge_hash, 'hex') AS challenge_hash,
           encode(credential_hash, 'hex') AS credential_hash,
           installation_id, network, master_account, target_account, purpose,
           encode(operation_digest, 'hex') AS operation_digest,
           service_origin,
           floor(extract(epoch FROM issued_at) * 1000)::bigint AS issued_at_ms,
           floor(extract(epoch FROM expires_at) * 1000)::bigint AS expires_at_ms,
           state
    FROM notification_account_link_challenges
    WHERE challenge_hash = decode(${input.challengeHash}, 'hex')
  `;
  const challenge = challenges[0];
  if (!challenge || challenge.installation_id !== input.installationId) {
    throw new StoreUnauthorizedError("challenge is unavailable");
  }
  const record = challengeRecordFromRow(challenge);
  if (!safeHashEqual(record.credentialHash, input.credentialHash)) {
    throw new StoreUnauthorizedError("challenge credential binding is stale");
  }
  if (record.purpose !== "notification-push-token-rebind") {
    throw new StoreUnauthorizedError("challenge purpose is invalid");
  }
  if (!safeHashEqual(record.operationDigest, input.expectedDigest)) {
    throw new StoreUnauthorizedError("push-token operation digest is invalid");
  }
  const links = await sql<
    {
      network: NotificationNetwork;
      master_account: string;
      target_account: string;
    }[]
  >`
    SELECT network, master_account, target_account
    FROM notification_account_links
    WHERE account_link_id = ${input.accountLinkId}
      AND installation_id = ${input.installationId} AND state = 'active'
  `;
  const link = links[0];
  if (
    link?.network !== record.network ||
    link.master_account !== record.masterAccount ||
    link.target_account !== record.targetAccount
  ) {
    throw new StoreUnauthorizedError("push-token link binding is invalid");
  }
  await verifyAccountProof({
    record,
    challenge: input.proof.challenge,
    message: input.proof.message,
    signature: input.proof.signature,
    now: await databaseNowMilliseconds(sql),
  });
  return record;
}

async function prevalidateChallengeProof(
  sql: SQL,
  input: {
    readonly installationId: string;
    readonly credentialHash: string;
    readonly challengeHash: string;
    readonly purpose: AccountProofPurpose;
    readonly proof: {
      readonly challenge: string;
      readonly message: string;
      readonly signature: Hex;
    };
  },
): Promise<AccountProofChallengeRecord> {
  const installations = await sql<
    { credential_hash: string | null; state: string }[]
  >`
    SELECT encode(credential_hash, 'hex') AS credential_hash, state
    FROM notification_installations
    WHERE installation_id = ${input.installationId}
  `;
  const installation = installations[0];
  if (
    installation?.state !== "active" ||
    !installation.credential_hash ||
    !safeHashEqual(input.credentialHash, installation.credential_hash)
  ) {
    throw new StoreUnauthorizedError();
  }
  const challenges = await sql<ChallengeRow[]>`
    SELECT encode(challenge_hash, 'hex') AS challenge_hash,
           encode(credential_hash, 'hex') AS credential_hash,
           installation_id, network, master_account, target_account, purpose,
           encode(operation_digest, 'hex') AS operation_digest,
           service_origin,
           floor(extract(epoch FROM issued_at) * 1000)::bigint AS issued_at_ms,
           floor(extract(epoch FROM expires_at) * 1000)::bigint AS expires_at_ms,
           state
    FROM notification_account_link_challenges
    WHERE challenge_hash = decode(${input.challengeHash}, 'hex')
  `;
  const challenge = challenges[0];
  if (!challenge || challenge.installation_id !== input.installationId) {
    throw new StoreUnauthorizedError("challenge is unavailable");
  }
  const record = challengeRecordFromRow(challenge);
  if (!safeHashEqual(record.credentialHash, input.credentialHash)) {
    throw new StoreUnauthorizedError("challenge credential binding is stale");
  }
  if (record.purpose !== input.purpose) {
    throw new StoreUnauthorizedError("challenge purpose is invalid");
  }
  await verifyAccountProof({
    record,
    challenge: input.proof.challenge,
    message: input.proof.message,
    signature: input.proof.signature,
    now: await databaseNowMilliseconds(sql),
  });
  return record;
}

function challengeRecordFromRow(
  row: ChallengeRow,
): AccountProofChallengeRecord {
  return {
    challengeHash: row.challenge_hash,
    credentialHash: row.credential_hash,
    installationId: row.installation_id,
    network: row.network,
    masterAccount: row.master_account,
    targetAccount: row.target_account,
    purpose: row.purpose,
    operationDigest: row.operation_digest,
    serviceOrigin: row.service_origin,
    issuedAt: Number(row.issued_at_ms),
    expiresAt: Number(row.expires_at_ms),
    state: row.state,
  };
}

async function databaseNowMilliseconds(sql: SQL): Promise<number> {
  const rows = await sql<{ now_ms: string | number }[]>`
    SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS now_ms
  `;
  return Number(rows[0]?.now_ms);
}

async function assertRuleQuota(
  sql: SQL,
  installationId: string,
  ruleId: string,
): Promise<void> {
  const counts = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count FROM notification_rules
    WHERE installation_id = ${installationId} AND active AND rule_id <> ${ruleId}
  `;
  if ((counts[0]?.count ?? 0) >= CONTRACT_LIMITS.maxActiveRules) {
    throw new StoreConflictError("active rule quota exhausted");
  }
}

async function ruleIdentityDigest(rule: CreateRuleRequest): Promise<string> {
  return operationDigest("rule-identity/v1", {
    scope: rule.scope,
    network: rule.network,
    marketId: rule.marketId,
    eventType: rule.eventType,
    threshold: rule.threshold,
    accountLinkId: rule.accountLinkId ?? null,
  });
}

async function safeCredentialHash(credential: string): Promise<string | null> {
  try {
    return await hashInstallationCredential(credential);
  } catch {
    return null;
  }
}

function safeHashEqual(left: string, right: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(left) || !/^[0-9a-f]{64}$/.test(right))
    return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function postgresCode(error: unknown): string | undefined {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}
