import type { NotificationNetwork } from "@hyper-trader/notifications";
import type {
  ExpoProviderErrorCode,
  ExpoPushClient,
  ExpoSendResult,
} from "../push/expo-push-client";
import { ExpoPushDeadlineError } from "../push/expo-push-client";
import type { RuntimeEgressFence } from "../worker-fence";

export interface DeliveryClaim {
  readonly permitId: string;
  readonly outboxId: string;
  readonly alertId: string;
  readonly category: "execution" | "risk" | "price" | "funding";
  readonly network: NotificationNetwork;
  readonly routeHint: string;
  readonly providerDeadlineAt: number;
}

export type DeliveryRejectionCode =
  | ExpoProviderErrorCode
  | "authorization_revoked"
  | "provider_deadline_expired"
  | "token_unavailable";

export interface NotificationDeliveryStore {
  recoverExpiredDispatches(limit: number): Promise<void>;
  claimNextDispatch(
    workerId: string,
    fence: RuntimeEgressFence,
  ): Promise<DeliveryClaim | null>;
  markProviderSubmissionStarted(permitId: string): Promise<void>;
  readDecryptedPushToken(permitId: string): Promise<string>;
  authorizeProviderFetch(
    permitId: string,
    fence: RuntimeEgressFence,
  ): Promise<{ readonly providerDeadlineAt: number }>;
  abandonUnstartedDispatch(permitId: string): Promise<void>;
  recordProviderAccepted(permitId: string, ticketId: string): Promise<void>;
  recordProviderRejected(
    permitId: string,
    errorCode: DeliveryRejectionCode,
  ): Promise<void>;
  recordProviderOutcomeUnknown(permitId: string): Promise<void>;
}

export class DeliveryAuthorizationError extends Error {
  constructor() {
    super("notification delivery authorization is no longer active");
    this.name = "DeliveryAuthorizationError";
  }
}

export class SimulatedProcessCrash extends Error {
  constructor() {
    super("simulated notification worker process crash");
    this.name = "SimulatedProcessCrash";
  }
}

interface DeliveryWorkerHooks {
  readonly afterClaim?: () => void | Promise<void>;
  readonly afterSubmissionStarted?: () => void | Promise<void>;
  readonly afterProviderResponse?: () => void | Promise<void>;
}

export type DeliveryWorkerEvent =
  | "attempt"
  | "accepted"
  | "rejected"
  | "unknown";

const DISPATCH_RECOVERY_INTERVAL_MS = 10_000;

export class NotificationDeliveryWorker {
  readonly #workerId: string;
  readonly #store: NotificationDeliveryStore;
  readonly #provider: Pick<ExpoPushClient, "send">;
  readonly #hooks?: DeliveryWorkerHooks;
  readonly #now: () => number;
  readonly #onEvent?: (event: DeliveryWorkerEvent) => void;
  #nextRecoveryAt = 0;

  constructor(input: {
    readonly workerId: string;
    readonly store: NotificationDeliveryStore;
    readonly provider: { readonly send: ExpoPushClient["send"] };
    readonly hooks?: DeliveryWorkerHooks;
    readonly now?: () => number;
    readonly onEvent?: (event: DeliveryWorkerEvent) => void;
  }) {
    if (!/^[a-z0-9:_-]{1,128}$/.test(input.workerId)) {
      throw new Error("notification delivery worker ID is invalid");
    }
    this.#workerId = input.workerId;
    this.#store = input.store;
    this.#provider = input.provider;
    this.#hooks = input.hooks;
    this.#now = input.now ?? Date.now;
    this.#onEvent = input.onEvent;
  }

  async runOnce(fence: RuntimeEgressFence): Promise<boolean> {
    await this.#recoverExpiredDispatchesIfDue();
    const claim = await this.#store.claimNextDispatch(this.#workerId, fence);
    if (!claim) return false;
    this.#report("attempt");
    let marked = false;
    let providerWritePossible = false;
    try {
      await this.#hooks?.afterClaim?.();
      await this.#store.markProviderSubmissionStarted(claim.permitId);
      marked = true;
      await this.#hooks?.afterSubmissionStarted?.();

      const pushToken = await this.#store.readDecryptedPushToken(
        claim.permitId,
      );
      const authorization = await this.#store.authorizeProviderFetch(
        claim.permitId,
        fence,
      );
      if (authorization.providerDeadlineAt <= this.#now()) {
        await this.#store.recordProviderRejected(
          claim.permitId,
          "provider_deadline_expired",
        );
        this.#report("rejected");
        return true;
      }
      providerWritePossible = true;
      const result: ExpoSendResult = await this.#provider.send({
        pushToken,
        alertId: claim.alertId,
        category: claim.category,
        network: claim.network,
        routeHint: claim.routeHint,
        providerDeadlineAt: authorization.providerDeadlineAt,
      });
      await this.#hooks?.afterProviderResponse?.();
      if (result.kind === "accepted") {
        await this.#store.recordProviderAccepted(
          claim.permitId,
          result.ticketId,
        );
        this.#report("accepted");
      } else {
        await this.#store.recordProviderRejected(
          claim.permitId,
          result.errorCode,
        );
        this.#report("rejected");
      }
      return true;
    } catch (error) {
      if (error instanceof SimulatedProcessCrash) throw error;
      if (!marked) {
        await this.#store.abandonUnstartedDispatch(claim.permitId);
        throw error;
      }
      if (error instanceof DeliveryAuthorizationError) {
        await this.#store.recordProviderRejected(
          claim.permitId,
          "authorization_revoked",
        );
        this.#report("rejected");
        return true;
      }
      if (error instanceof ExpoPushDeadlineError) {
        await this.#store.recordProviderRejected(
          claim.permitId,
          "provider_deadline_expired",
        );
        this.#report("rejected");
        return true;
      }
      if (!providerWritePossible) {
        await this.#store.recordProviderRejected(
          claim.permitId,
          "token_unavailable",
        );
        this.#report("rejected");
        return true;
      }
      await this.#store.recordProviderOutcomeUnknown(claim.permitId);
      this.#report("unknown");
      return true;
    }
  }

  requestRecovery(): void {
    this.#nextRecoveryAt = 0;
  }

  async #recoverExpiredDispatchesIfDue(): Promise<void> {
    const now = this.#now();
    if (now < this.#nextRecoveryAt) return;
    this.#nextRecoveryAt = now + DISPATCH_RECOVERY_INTERVAL_MS;
    await this.#store.recoverExpiredDispatches(100);
  }

  #report(event: DeliveryWorkerEvent): void {
    try {
      this.#onEvent?.(event);
    } catch {
      // Redacted metrics cannot affect durable delivery state.
    }
  }
}
