import { HyperliquidValidationError } from "../errors";
import {
  HYPERLIQUID_NETWORK_ORIGINS,
  type HyperliquidNetwork,
} from "../network";
import { assertTestnetSigningCapability } from "../signing/boundary";
import type { Eip712Signature } from "../signing/types";
import { encodeL1Action } from "./codec";
import { MAX_BULK_CANCELS } from "./constants";
import type { ExchangeAction } from "./types";

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const MAX_REQUEST_TIMEOUT_MS = 60_000;
const MAX_RESPONSE_BYTES = 64 * 1024;

export interface SignedExchangeRequest {
  readonly action: ExchangeAction;
  readonly nonce: number;
  readonly signature: Eip712Signature;
  readonly vaultAddress?: `0x${string}` | null;
  readonly expiresAfter: number;
}

export type ExchangeSubmissionResult =
  | { readonly kind: "accepted"; readonly providerOrderIds: readonly number[] }
  | { readonly kind: "rejected"; readonly reason: "provider_rejected" }
  | { readonly kind: "expired"; readonly reason: "provider_expired" }
  | {
      readonly kind: "unresolved";
      readonly reason: "malformed_response" | "transport_uncertain";
    };

export interface ExchangeClient {
  readonly network: HyperliquidNetwork;
  readonly endpoint: string;
  submit(request: SignedExchangeRequest): Promise<ExchangeSubmissionResult>;
}

function objectAt(value: unknown): Record<string, unknown> | null {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
    ? (value as Record<string, unknown>)
    : null;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  return (
    Object.keys(value).length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  );
}

const KNOWN_EXPIRED_ERRORS: ReadonlySet<string> = new Set([
  "Order has expired",
  "Action has expired",
  "expiresAfter timestamp has passed",
]);

function classifyError(error: unknown): ExchangeSubmissionResult {
  if (typeof error !== "string" || error.length === 0 || error.length > 2_048) {
    return { kind: "unresolved", reason: "malformed_response" };
  }
  return KNOWN_EXPIRED_ERRORS.has(error)
    ? { kind: "expired", reason: "provider_expired" }
    : { kind: "rejected", reason: "provider_rejected" };
}

function classifyOrderStatuses(value: unknown): ExchangeSubmissionResult {
  const data = objectAt(value);
  if (
    data === null ||
    !exactKeys(data, ["statuses"]) ||
    !Array.isArray(data.statuses)
  ) {
    return { kind: "unresolved", reason: "malformed_response" };
  }
  if (data.statuses.length !== 1) {
    return { kind: "unresolved", reason: "malformed_response" };
  }
  const status = objectAt(data.statuses[0]);
  if (status === null || Object.keys(status).length !== 1) {
    return { kind: "unresolved", reason: "malformed_response" };
  }
  if ("error" in status) return classifyError(status.error);
  if ("resting" in status) {
    const resting = objectAt(status.resting);
    if (
      resting !== null &&
      exactKeys(resting, ["oid"]) &&
      Number.isSafeInteger(resting.oid) &&
      (resting.oid as number) >= 0
    ) {
      return { kind: "accepted", providerOrderIds: [resting.oid as number] };
    }
    return { kind: "unresolved", reason: "malformed_response" };
  }
  if ("filled" in status) {
    const filled = objectAt(status.filled);
    if (
      filled !== null &&
      exactKeys(filled, ["totalSz", "avgPx", "oid"]) &&
      typeof filled.totalSz === "string" &&
      typeof filled.avgPx === "string" &&
      Number.isSafeInteger(filled.oid) &&
      (filled.oid as number) >= 0
    ) {
      return { kind: "accepted", providerOrderIds: [filled.oid as number] };
    }
  }
  return { kind: "unresolved", reason: "malformed_response" };
}

function classifyCancelStatuses(value: unknown): ExchangeSubmissionResult {
  const data = objectAt(value);
  if (
    data === null ||
    !exactKeys(data, ["statuses"]) ||
    !Array.isArray(data.statuses)
  ) {
    return { kind: "unresolved", reason: "malformed_response" };
  }
  if (data.statuses.length === 0 || data.statuses.length > MAX_BULK_CANCELS) {
    return { kind: "unresolved", reason: "malformed_response" };
  }
  let sawError = false;
  for (const raw of data.statuses) {
    if (raw === "success") continue;
    const status = objectAt(raw);
    if (status !== null && exactKeys(status, ["error"])) {
      const classified = classifyError(status.error);
      if (classified.kind === "expired") return classified;
      if (classified.kind === "rejected") {
        sawError = true;
        continue;
      }
    }
    return { kind: "unresolved", reason: "malformed_response" };
  }
  return sawError
    ? { kind: "rejected", reason: "provider_rejected" }
    : { kind: "accepted", providerOrderIds: [] };
}

/**
 * Parses only the documented `/exchange` response shapes. Unknown fields or
 * status variants remain unresolved so callers must reconcile authoritatively.
 */
export function classifyExchangeResponse(
  value: unknown,
): ExchangeSubmissionResult {
  const root = objectAt(value);
  if (root === null || !exactKeys(root, ["status", "response"])) {
    return { kind: "unresolved", reason: "malformed_response" };
  }
  if (root.status === "err") return classifyError(root.response);
  if (root.status !== "ok") {
    return { kind: "unresolved", reason: "malformed_response" };
  }
  const response = objectAt(root.response);
  if (response === null || typeof response.type !== "string") {
    return { kind: "unresolved", reason: "malformed_response" };
  }
  if (response.type === "default" && exactKeys(response, ["type"])) {
    return { kind: "accepted", providerOrderIds: [] };
  }
  if (!exactKeys(response, ["type", "data"])) {
    return { kind: "unresolved", reason: "malformed_response" };
  }
  if (response.type === "order") return classifyOrderStatuses(response.data);
  if (response.type === "cancel") return classifyCancelStatuses(response.data);
  return { kind: "unresolved", reason: "malformed_response" };
}

function assertSignedRequest(request: SignedExchangeRequest): void {
  const raw = objectAt(request);
  if (
    raw === null ||
    !exactKeys(
      raw,
      request.vaultAddress === undefined
        ? ["action", "nonce", "signature", "expiresAfter"]
        : ["action", "nonce", "signature", "vaultAddress", "expiresAfter"],
    )
  ) {
    throw new HyperliquidValidationError(
      "exchange.request",
      "unexpected signed request fields",
    );
  }
  if (
    !Number.isSafeInteger(request.nonce) ||
    request.nonce < 0 ||
    !Number.isSafeInteger(request.expiresAfter) ||
    request.expiresAfter <= request.nonce
  ) {
    throw new HyperliquidValidationError(
      "exchange.request",
      "nonce and expiry are invalid",
    );
  }
  if (request.action === null || typeof request.action !== "object") {
    throw new HyperliquidValidationError(
      "exchange.action",
      "action is missing",
    );
  }
  const signature = objectAt(request.signature);
  if (
    signature === null ||
    !exactKeys(signature, ["r", "s", "v"]) ||
    typeof signature.r !== "string" ||
    !/^0x[0-9a-f]{64}$/.test(signature.r) ||
    typeof signature.s !== "string" ||
    !/^0x[0-9a-f]{64}$/.test(signature.s) ||
    (signature.v !== 27 && signature.v !== 28)
  ) {
    throw new HyperliquidValidationError(
      "exchange.signature",
      "expected canonical signature components",
    );
  }
  encodeL1Action({
    action: request.action,
    nonce: request.nonce,
    vaultAddress: request.vaultAddress,
    expiresAfter: request.expiresAfter,
  });
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength !== null &&
    (!/^\d+$/.test(declaredLength) ||
      Number(declaredLength) > MAX_RESPONSE_BYTES)
  ) {
    throw new Error("exchange response exceeds the byte limit");
  }
  const reader = response.body?.getReader();
  if (reader === undefined) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
      throw new Error("exchange response exceeds the byte limit");
    }
    return JSON.parse(text) as unknown;
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("exchange response exceeds the byte limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(body)) as unknown;
}

/**
 * Transport is injected so the shared package never owns native networking or
 * automatic retries. Mobile wiring remains release-gated; deterministic tests
 * provide an in-memory transport.
 */
export function createExchangeClient(options: {
  readonly network: HyperliquidNetwork;
  readonly fetch?: typeof globalThis.fetch;
  readonly timeoutMs?: number;
}): ExchangeClient {
  const endpoint = HYPERLIQUID_NETWORK_ORIGINS[options.network].exchange;
  const fetchRequest = options.fetch ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > MAX_REQUEST_TIMEOUT_MS
  ) {
    throw new HyperliquidValidationError(
      "exchange.timeoutMs",
      `expected whole milliseconds between 1 and ${MAX_REQUEST_TIMEOUT_MS}`,
    );
  }
  const client: ExchangeClient = {
    network: options.network,
    endpoint,
    async submit(
      request: SignedExchangeRequest,
    ): Promise<ExchangeSubmissionResult> {
      assertTestnetSigningCapability(options.network);
      assertSignedRequest(request);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const body = {
          action: request.action,
          nonce: request.nonce,
          signature: request.signature,
          expiresAfter: request.expiresAfter,
          ...(request.vaultAddress == null
            ? {}
            : { vaultAddress: request.vaultAddress }),
        };
        const response = await fetchRequest(endpoint, {
          method: "POST",
          redirect: "error",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (!response.ok) {
          return { kind: "unresolved", reason: "transport_uncertain" };
        }
        try {
          return classifyExchangeResponse(await readBoundedJson(response));
        } catch {
          return {
            kind: "unresolved",
            reason: controller.signal.aborted
              ? "transport_uncertain"
              : "malformed_response",
          };
        }
      } catch {
        return { kind: "unresolved", reason: "transport_uncertain" } as const;
      } finally {
        clearTimeout(timeout);
      }
    },
  };
  return Object.freeze(client);
}
