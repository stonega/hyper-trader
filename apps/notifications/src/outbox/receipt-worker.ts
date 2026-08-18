import {
  EXPO_RECEIPT_BATCH_SIZE,
  type ExpoPushClient,
  type ExpoReceiptResult,
} from "../push/expo-push-client";
import type { RuntimeEgressFence } from "../worker-fence";

export interface NotificationReceiptStore {
  recoverExpiredReceiptLeases(limit: number): Promise<void>;
  claimDueReceipts(
    workerId: string,
    limit: number,
    fence: RuntimeEgressFence,
  ): Promise<readonly string[]>;
  completeReceipt(
    ticketId: string,
    workerId: string,
    result: Exclude<ExpoReceiptResult, { readonly kind: "pending" }>,
  ): Promise<void>;
  deferReceipt(ticketId: string, workerId: string): Promise<void>;
}

export type ReceiptWorkerEvent = "pending" | "failed";

export class NotificationReceiptWorker {
  readonly #workerId: string;
  readonly #store: NotificationReceiptStore;
  readonly #provider: Pick<ExpoPushClient, "getReceipts">;
  readonly #batchSize: number;
  readonly #onEvent?: (event: ReceiptWorkerEvent) => void;

  constructor(input: {
    readonly workerId: string;
    readonly store: NotificationReceiptStore;
    readonly provider: { readonly getReceipts: ExpoPushClient["getReceipts"] };
    readonly batchSize?: number;
    readonly onEvent?: (event: ReceiptWorkerEvent) => void;
  }) {
    if (!/^[a-z0-9:_-]{1,128}$/.test(input.workerId)) {
      throw new Error("notification receipt worker ID is invalid");
    }
    const batchSize = input.batchSize ?? EXPO_RECEIPT_BATCH_SIZE;
    if (
      !Number.isSafeInteger(batchSize) ||
      batchSize < 1 ||
      batchSize > EXPO_RECEIPT_BATCH_SIZE
    ) {
      throw new Error("notification receipt batch size is invalid");
    }
    this.#workerId = input.workerId;
    this.#store = input.store;
    this.#provider = input.provider;
    this.#batchSize = batchSize;
    this.#onEvent = input.onEvent;
  }

  async runOnce(fence: RuntimeEgressFence): Promise<number> {
    await this.#store.recoverExpiredReceiptLeases(this.#batchSize);
    const tickets = await this.#store.claimDueReceipts(
      this.#workerId,
      this.#batchSize,
      fence,
    );
    if (tickets.length === 0) return 0;
    let results: Readonly<Record<string, ExpoReceiptResult>>;
    try {
      results = await this.#provider.getReceipts(tickets);
    } catch {
      await Promise.all(
        tickets.map((ticketId) =>
          this.#store
            .deferReceipt(ticketId, this.#workerId)
            .then(() => this.#report("pending")),
        ),
      );
      return tickets.length;
    }
    await Promise.all(
      tickets.map(async (ticketId) => {
        const result = results[ticketId] ?? { kind: "pending" as const };
        if (result.kind === "pending") {
          await this.#store.deferReceipt(ticketId, this.#workerId);
          this.#report("pending");
        } else {
          await this.#store.completeReceipt(ticketId, this.#workerId, result);
          if (result.kind === "failed") this.#report("failed");
        }
      }),
    );
    return tickets.length;
  }

  #report(event: ReceiptWorkerEvent): void {
    try {
      this.#onEvent?.(event);
    } catch {
      // Redacted metrics cannot affect receipt state.
    }
  }
}
