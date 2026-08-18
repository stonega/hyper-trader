import type { NotificationNetwork } from "@hyper-trader/notifications";

export const EXPO_PUSH_SEND_URL = "https://exp.host/--/api/v2/push/send";
export const EXPO_PUSH_RECEIPTS_URL =
  "https://exp.host/--/api/v2/push/getReceipts";
export const EXPO_PROVIDER_DEADLINE_MS = 10_000;
export const EXPO_RECEIPT_BATCH_SIZE = 100;

const TOKEN = /^ExponentPushToken\[[\x21-\x7e]{1,480}\]$/;
const OPAQUE_ID = /^[0-9a-f]{32}$/;
const TICKET_ID = /^[\x21-\x7e]{1,256}$/;
const ROUTE_HINTS = new Set(["trade", "portfolio", "settings"]);

export type ExpoProviderErrorCode =
  | "device_not_registered"
  | "message_too_big"
  | "message_rate_exceeded"
  | "mismatch_sender_id"
  | "invalid_credentials"
  | "provider_rate_limited"
  | "provider_unauthorized"
  | "provider_invalid_request"
  | "provider_unavailable"
  | "provider_protocol_error";

export type ExpoSendResult =
  | { readonly kind: "accepted"; readonly ticketId: string }
  | { readonly kind: "rejected"; readonly errorCode: ExpoProviderErrorCode };

export type ExpoReceiptResult =
  | { readonly kind: "delivered" }
  | { readonly kind: "failed"; readonly errorCode: ExpoProviderErrorCode }
  | { readonly kind: "pending" };

export class ExpoPushUncertainError extends Error {
  constructor() {
    super("Expo provider outcome is uncertain");
    this.name = "ExpoPushUncertainError";
  }
}

export class ExpoPushDeadlineError extends Error {
  constructor() {
    super("Expo provider deadline expired before transport");
    this.name = "ExpoPushDeadlineError";
  }
}

export type ScheduleExpoAbort = (
  callback: () => void,
  milliseconds: number,
) => () => void;

export class ExpoPushClient {
  readonly #fetch: typeof globalThis.fetch;
  readonly #accessToken?: string;
  readonly #now: () => number;
  readonly #scheduleAbort: ScheduleExpoAbort;

  constructor(
    input: {
      readonly fetch?: typeof globalThis.fetch;
      readonly accessToken?: string;
      readonly now?: () => number;
      readonly scheduleAbort?: ScheduleExpoAbort;
    } = {},
  ) {
    if (
      input.accessToken !== undefined &&
      (input.accessToken.length < 1 ||
        input.accessToken.length > 2_048 ||
        Array.from(input.accessToken).some((character) => {
          const codePoint = character.codePointAt(0) ?? 0;
          return codePoint <= 31 || codePoint === 127;
        }))
    ) {
      throw new Error("Expo access token is invalid");
    }
    this.#fetch = input.fetch ?? globalThis.fetch;
    this.#accessToken = input.accessToken;
    this.#now = input.now ?? Date.now;
    this.#scheduleAbort = input.scheduleAbort ?? scheduleExpoAbort;
  }

  async send(input: {
    readonly pushToken: string;
    readonly alertId: string;
    readonly category: "execution" | "risk" | "price" | "funding";
    readonly network: NotificationNetwork;
    readonly routeHint: string;
    readonly providerDeadlineAt: number;
  }): Promise<ExpoSendResult> {
    validateMessage(input);
    const response = await this.#request(
      EXPO_PUSH_SEND_URL,
      {
        to: input.pushToken,
        title: "Trading alert available",
        body: "Open Hyper Trader to view current details.",
        data: {
          alertId: input.alertId,
          category: input.category,
          network: input.network,
          routeHint: input.routeHint,
        },
      },
      input.providerDeadlineAt,
    );
    const body = await boundedJson(response);
    if (!response.ok) {
      return {
        kind: "rejected",
        errorCode: requestError(response.status, body),
      };
    }
    const record = exactRecord(body, ["data"], ["errors"]);
    const ticket = Array.isArray(record.data) ? record.data[0] : record.data;
    return parseTicket(ticket);
  }

  async getReceipts(
    ticketIds: readonly string[],
  ): Promise<Readonly<Record<string, ExpoReceiptResult>>> {
    if (
      ticketIds.length < 1 ||
      ticketIds.length > EXPO_RECEIPT_BATCH_SIZE ||
      ticketIds.some((id) => !TICKET_ID.test(id)) ||
      new Set(ticketIds).size !== ticketIds.length
    ) {
      throw new Error("Expo receipt batch is invalid");
    }
    const response = await this.#request(EXPO_PUSH_RECEIPTS_URL, {
      ids: ticketIds,
    });
    const body = await boundedJson(response);
    if (!response.ok) {
      throw new ExpoPushUncertainError();
    }
    const record = exactRecord(body, ["data"], ["errors"]);
    if (!isRecord(record.data)) throw new Error("Expo receipt data is invalid");
    const results: Record<string, ExpoReceiptResult> = {};
    for (const ticketId of ticketIds) {
      const receipt = record.data[ticketId];
      results[ticketId] =
        receipt === undefined ? { kind: "pending" } : parseReceipt(receipt);
    }
    return results;
  }

  async #request(
    url: string,
    body: unknown,
    providerDeadlineAt?: number,
  ): Promise<Response> {
    const remaining = Math.min(
      EXPO_PROVIDER_DEADLINE_MS,
      (providerDeadlineAt ?? this.#now() + EXPO_PROVIDER_DEADLINE_MS) -
        this.#now(),
    );
    if (!Number.isSafeInteger(remaining) || remaining <= 0) {
      throw new ExpoPushDeadlineError();
    }
    const controller = new AbortController();
    const cancelAbort = this.#scheduleAbort(
      () => controller.abort(new ExpoPushUncertainError()),
      remaining,
    );
    try {
      return await this.#fetch(url, {
        method: "POST",
        redirect: "error",
        signal: controller.signal,
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          ...(this.#accessToken === undefined
            ? {}
            : { authorization: `Bearer ${this.#accessToken}` }),
        },
        body: JSON.stringify(body),
      });
    } catch {
      throw new ExpoPushUncertainError();
    } finally {
      cancelAbort();
    }
  }
}

function validateMessage(input: {
  readonly pushToken: string;
  readonly alertId: string;
  readonly category: string;
  readonly network: string;
  readonly routeHint: string;
  readonly providerDeadlineAt: number;
}): void {
  if (
    !TOKEN.test(input.pushToken) ||
    !OPAQUE_ID.test(input.alertId) ||
    !["execution", "risk", "price", "funding"].includes(input.category) ||
    !["testnet", "mainnet"].includes(input.network) ||
    !ROUTE_HINTS.has(input.routeHint) ||
    !Number.isSafeInteger(input.providerDeadlineAt) ||
    input.providerDeadlineAt < 0
  ) {
    throw new Error("Expo push message is invalid");
  }
}

function scheduleExpoAbort(
  callback: () => void,
  milliseconds: number,
): () => void {
  const timer = setTimeout(callback, milliseconds);
  return () => clearTimeout(timer);
}

async function boundedJson(response: Response): Promise<unknown> {
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > 64 * 1024) {
    throw new Error("Expo response exceeds the bounded parser limit");
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("Expo response is not valid UTF-8");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("Expo response is not valid JSON");
  }
}

function parseTicket(value: unknown): ExpoSendResult {
  if (!isRecord(value) || (value.status !== "ok" && value.status !== "error")) {
    throw new Error("Expo push ticket is invalid");
  }
  if (value.status === "ok") {
    const ticket = exactRecord(value, ["status", "id"]);
    if (!TICKET_ID.test(String(ticket.id))) {
      throw new Error("Expo push ticket ID is invalid");
    }
    return { kind: "accepted", ticketId: String(ticket.id) };
  }
  const ticket = exactRecord(value, ["status"], ["message", "details"]);
  return {
    kind: "rejected",
    errorCode: individualError(ticket.details),
  };
}

function parseReceipt(value: unknown): ExpoReceiptResult {
  if (!isRecord(value) || (value.status !== "ok" && value.status !== "error")) {
    throw new Error("Expo push receipt is invalid");
  }
  if (value.status === "ok") {
    exactRecord(value, ["status"]);
    return { kind: "delivered" };
  }
  const receipt = exactRecord(value, ["status"], ["message", "details"]);
  return { kind: "failed", errorCode: individualError(receipt.details) };
}

function individualError(details: unknown): ExpoProviderErrorCode {
  const error = isRecord(details) ? details.error : undefined;
  if (error === "DeviceNotRegistered") return "device_not_registered";
  if (error === "MessageTooBig") return "message_too_big";
  if (error === "MessageRateExceeded") return "message_rate_exceeded";
  if (error === "MismatchSenderId") return "mismatch_sender_id";
  if (error === "InvalidCredentials") return "invalid_credentials";
  return "provider_protocol_error";
}

function requestError(status: number, body: unknown): ExpoProviderErrorCode {
  const errors =
    isRecord(body) && Array.isArray(body.errors) ? body.errors : [];
  const first = errors[0];
  const code = isRecord(first) ? first.code : undefined;
  if (status === 429 || code === "TOO_MANY_REQUESTS") {
    return "provider_rate_limited";
  }
  if (status === 401 || status === 403 || code === "UNAUTHORIZED") {
    return "provider_unauthorized";
  }
  if (status >= 500) return "provider_unavailable";
  if (status >= 400) return "provider_invalid_request";
  return "provider_protocol_error";
}

function exactRecord(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  if (!isRecord(value)) throw new Error("Expo response object is invalid");
  const allowed = new Set([...required, ...optional]);
  if (
    required.some((key) => !(key in value)) ||
    Object.keys(value).some((key) => !allowed.has(key))
  ) {
    throw new Error("Expo response object is invalid");
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
