import type {
  IssueChallengeRequest,
  LostInstallationRevokeRequest,
  PushTokenRebindRequest,
  PutRuleRequest,
  RegisterInstallationRequest,
  RevokeInstallationRequest,
  RotateInstallationCredentialRequest,
  UnlinkAccountRequest,
  VerifyAccountLinkRequest,
} from "@hyper-trader/notifications";

import {
  type AccountLinkResponse,
  ApplicationError,
  type AuthenticatedApplicationContext,
  type ChallengeResponse,
  type CredentialRotationResponse,
  type DrainResponse,
  type InstallationResponse,
  type LostRevokeResponse,
  type NotificationApplication,
  type NotificationApplicationContext,
  type PushTokenResponse,
  type RuleResponse,
} from "./application";
import {
  type AccountRelationshipVerifier,
  DrainPendingError,
  type PostgresNotificationStore,
  StoreConflictError,
  StoreDependencyUnavailableError,
  StoreNotReadyError,
  StoreRateLimitError,
  StoreUnauthorizedError,
} from "./db/notification-store";

export class PostgresNotificationApplication
  implements NotificationApplication
{
  readonly #store: PostgresNotificationStore;
  readonly #relationshipVerifier: AccountRelationshipVerifier;

  constructor(input: {
    readonly store: PostgresNotificationStore;
    readonly relationshipVerifier: AccountRelationshipVerifier;
  }) {
    this.#store = input.store;
    this.#relationshipVerifier = input.relationshipVerifier;
  }

  async registerInstallation(
    request: RegisterInstallationRequest,
    context: NotificationApplicationContext,
  ): Promise<InstallationResponse> {
    return this.#mapErrors(async () => {
      return this.#store.registerInstallation(request, context.ip);
    });
  }

  async issueChallenge(
    request: IssueChallengeRequest,
    context: AuthenticatedApplicationContext,
  ): Promise<ChallengeResponse> {
    return this.#mapErrors(async () => {
      const issued = await this.#store.issueAccountLinkChallenge({
        ...request,
        credential: context.credential,
        ip: context.ip,
      });
      return {
        challenge: issued.challenge,
        issuedAt: issued.record.issuedAt,
        expiresAt: issued.record.expiresAt,
        operationDigest: issued.record.operationDigest,
        proofVersion: 1,
      };
    });
  }

  async verifyAccountLink(
    request: VerifyAccountLinkRequest,
    context: AuthenticatedApplicationContext,
  ): Promise<AccountLinkResponse> {
    return this.#mapErrors(async () => {
      return this.#store.verifyAccountLinkProof(
        { ...request, credential: context.credential, ip: context.ip },
        this.#relationshipVerifier,
      );
    });
  }

  async putRule(
    request: PutRuleRequest,
    context: AuthenticatedApplicationContext,
  ): Promise<RuleResponse> {
    return this.#mapErrors(async () => {
      const installationId = await this.#store.installationIdForCredential(
        context.credential,
      );
      if (request.rule.scope === "price") {
        return this.#store.putPriceRule(request.rule, {
          installationId,
          credential: context.credential,
          ip: context.ip,
        });
      }
      return this.#store.putAccountRule(
        request.rule,
        { installationId, credential: context.credential, ip: context.ip },
        request.proof,
        this.#relationshipVerifier,
      );
    });
  }

  async revokeInstallation(
    request: RevokeInstallationRequest,
    context: AuthenticatedApplicationContext,
  ): Promise<DrainResponse> {
    return this.#mapErrors(async () => {
      const operation = await this.#store.startInstallationDrain({
        ...request,
        credential: context.credential,
      });
      try {
        return await this.#store.commitInstallationRevocation(
          operation.operationId,
        );
      } catch (error) {
        if (error instanceof DrainPendingError) return operation;
        throw error;
      }
    });
  }

  async unlinkAccount(
    request: UnlinkAccountRequest,
    context: AuthenticatedApplicationContext,
  ): Promise<DrainResponse> {
    return this.#mapErrors(async () => {
      const operation = await this.#store.startAccountLinkDrain({
        ...request,
        credential: context.credential,
        ip: context.ip,
      });
      try {
        return await this.#store.commitAccountLinkUnlink(operation.operationId);
      } catch (error) {
        if (error instanceof DrainPendingError) return operation;
        throw error;
      }
    });
  }

  async revokeLostInstallations(
    request: LostInstallationRevokeRequest,
    context: AuthenticatedApplicationContext,
  ): Promise<LostRevokeResponse> {
    return this.#mapErrors(async () => {
      const draining = await this.#store.verifyLostInstallationRevokeProof(
        {
          ...request,
          credential: context.credential,
          ip: context.ip,
        },
        this.#relationshipVerifier,
      );
      const results: DrainResponse[] = [];
      for (const operationId of draining.operationIds) {
        try {
          results.push(
            await this.#store.commitInstallationRevocation(operationId),
          );
        } catch (error) {
          if (error instanceof DrainPendingError) {
            results.push({ operationId, state: "draining" });
          } else {
            throw error;
          }
        }
      }
      return { state: "accepted", operations: results };
    });
  }

  async rotateInstallationCredential(
    request: RotateInstallationCredentialRequest,
    context: AuthenticatedApplicationContext,
  ): Promise<CredentialRotationResponse> {
    return this.#mapErrors(async () => {
      return this.#store.rotateInstallationCredential({
        ...request,
        credential: context.credential,
        ip: context.ip,
      });
    });
  }

  async rebindPushToken(
    request: PushTokenRebindRequest,
    context: AuthenticatedApplicationContext,
  ): Promise<PushTokenResponse> {
    return this.#mapErrors(async () => {
      return this.#store.rebindPushToken(
        {
          ...request,
          credential: context.credential,
          ip: context.ip,
        },
        this.#relationshipVerifier,
      );
    });
  }

  async #mapErrors<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      if (error instanceof StoreUnauthorizedError) {
        throw new ApplicationError(401, "notification authority rejected");
      }
      if (error instanceof StoreRateLimitError) {
        throw new ApplicationError(
          429,
          "notification admission rejected",
          error.retryAfterMs,
        );
      }
      if (
        error instanceof StoreConflictError ||
        error instanceof DrainPendingError
      ) {
        throw new ApplicationError(409, "notification state conflict");
      }
      if (error instanceof StoreNotReadyError) {
        throw new ApplicationError(503, "notification storage is not ready");
      }
      if (error instanceof StoreDependencyUnavailableError) {
        throw new ApplicationError(
          503,
          "notification dependency is unavailable",
        );
      }
      throw error;
    }
  }
}
