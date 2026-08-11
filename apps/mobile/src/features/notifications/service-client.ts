import {
  CONTRACT_LIMITS,
  type DeletePriceRuleRequest,
  type MobileAlertResponse,
  type MobileInstallationSnapshotResponse,
  type PushTokenRebindRequest,
  type PutRuleRequest,
  parseDeletePriceRuleRequest,
  parseMobileAlertResponse,
  parseMobileInstallationSnapshotResponse,
  parsePushTokenRebindRequest,
  parsePutRuleRequest,
  parseRegisterInstallationRequest,
  parseRevokeInstallationRequest,
  type RegisterInstallationRequest,
  type RevokeInstallationRequest,
} from "@hyper-trader/notifications/mobile";

export type NotificationServiceErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "not_ready"
  | "network"
  | "invalid_response";

export class NotificationServiceError extends Error {
  readonly code: NotificationServiceErrorCode;
  readonly retryAfterMs?: number;

  constructor(code: NotificationServiceErrorCode, retryAfterMs?: number) {
    super(`notification service ${code.replaceAll("_", " ")}`);
    this.name = "NotificationServiceError";
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

export interface NotificationServiceClient {
  registerInstallation(
    request: RegisterInstallationRequest,
    signal?: AbortSignal,
  ): Promise<{ readonly installationId: string; readonly state: "active" }>;
  readSnapshot(
    installationId: string,
    credential: string,
    signal?: AbortSignal,
  ): Promise<MobileInstallationSnapshotResponse>;
  readAlert(
    alertId: string,
    credential: string,
    signal?: AbortSignal,
  ): Promise<MobileAlertResponse>;
  deletePriceRule(
    request: DeletePriceRuleRequest,
    credential: string,
    signal?: AbortSignal,
  ): Promise<{ readonly ruleId: string; readonly state: "deleted" }>;
  rebindPushToken(
    request: PushTokenRebindRequest,
    credential: string,
    signal?: AbortSignal,
  ): Promise<{ readonly tokenFingerprint: string; readonly state: "active" }>;
  putRule(
    request: PutRuleRequest,
    credential: string,
    signal?: AbortSignal,
  ): Promise<{ readonly ruleId: string; readonly state: "active" }>;
  revokeInstallation(
    request: RevokeInstallationRequest,
    credential: string,
    signal?: AbortSignal,
  ): Promise<
    | { readonly operationId: string; readonly state: "draining" }
    | {
        readonly operationId: string;
        readonly state: "inactive";
        readonly ledgerSequence: number;
      }
  >;
}

export function createNotificationServiceClient(options: {
  readonly origin: string;
  readonly fetch: (request: Request) => Promise<Response>;
}): NotificationServiceClient {
  const origin = exactHttpsOrigin(options.origin);

  async function call(
    path: string,
    init: RequestInit,
    credential: string | null,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (credential !== null && !/^[0-9a-f]{64}$/.test(credential)) {
      throw new NotificationServiceError("unauthorized");
    }
    const request = new Request(`${origin}${path}`, {
      ...init,
      headers: {
        accept: "application/json",
        ...(credential === null
          ? {}
          : { authorization: `Bearer ${credential}` }),
        ...(init.body === undefined
          ? {}
          : { "content-type": "application/json" }),
      },
      redirect: "error",
      signal,
    });
    let response: Response;
    try {
      response = await options.fetch(request);
    } catch {
      throw new NotificationServiceError("network");
    }
    if (!response.ok) {
      throw new NotificationServiceError(
        responseCode(response.status),
        retryAfterMilliseconds(response),
      );
    }
    return readBoundedJson(response);
  }

  return {
    async registerInstallation(request, signal) {
      const parsed = parseRegisterInstallationRequest(request);
      const response = await call(
        "/v1/installations",
        { method: "POST", body: JSON.stringify(parsed) },
        null,
        signal,
      );
      return exactInstallationResponse(response, parsed.installationId);
    },
    async readSnapshot(installationId, credential, signal) {
      exactId(installationId);
      return parseResponse(
        await call(
          `/v1/installations/${installationId}/snapshot`,
          { method: "GET" },
          credential,
          signal,
        ),
        parseMobileInstallationSnapshotResponse,
      );
    },
    async readAlert(alertId, credential, signal) {
      exactId(alertId);
      return parseResponse(
        await call(
          `/v1/alerts/${alertId}`,
          { method: "GET" },
          credential,
          signal,
        ),
        parseMobileAlertResponse,
      );
    },
    async deletePriceRule(request, credential, signal) {
      const parsed = parseDeletePriceRuleRequest(request);
      const response = await call(
        `/v1/rules/${parsed.ruleId}`,
        { method: "DELETE", body: JSON.stringify(parsed) },
        credential,
        signal,
      );
      return exactStateResponse(response, parsed.ruleId, "deleted");
    },
    async rebindPushToken(request, credential, signal) {
      const parsed = parsePushTokenRebindRequest(request);
      const response = await call(
        `/v1/installations/${parsed.installationId}/push-token`,
        { method: "PUT", body: JSON.stringify(parsed) },
        credential,
        signal,
      );
      if (!isRecord(response) || Object.keys(response).length !== 2) {
        throw new NotificationServiceError("invalid_response");
      }
      const fingerprint = response.tokenFingerprint;
      if (
        typeof fingerprint !== "string" ||
        !/^[0-9a-f]{64}$/.test(fingerprint) ||
        response.state !== "active"
      ) {
        throw new NotificationServiceError("invalid_response");
      }
      return { tokenFingerprint: fingerprint, state: "active" };
    },
    async putRule(request, credential, signal) {
      const parsed = parsePutRuleRequest(request);
      const response = await call(
        `/v1/rules/${parsed.rule.ruleId}`,
        { method: "PUT", body: JSON.stringify(parsed) },
        credential,
        signal,
      );
      return exactStateResponse(response, parsed.rule.ruleId, "active");
    },
    async revokeInstallation(request, credential, signal) {
      const parsed = parseRevokeInstallationRequest(request);
      return exactDrainResponse(
        await call(
          "/v1/installations/revoke",
          { method: "POST", body: JSON.stringify(parsed) },
          credential,
          signal,
        ),
        parsed.operationId,
      );
    },
  };
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    const declaredBytes = Number(declared);
    if (
      !Number.isSafeInteger(declaredBytes) ||
      declaredBytes < 0 ||
      declaredBytes > CONTRACT_LIMITS.maxResponseBytes
    ) {
      throw new NotificationServiceError("invalid_response");
    }
  }
  if (response.body === null) {
    throw new NotificationServiceError("invalid_response");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      byteLength += next.value.byteLength;
      if (byteLength > CONTRACT_LIMITS.maxResponseBytes) {
        try {
          await reader.cancel();
        } catch {
          // The response is already rejected; cancellation is best effort.
        }
        throw new NotificationServiceError("invalid_response");
      }
      chunks.push(next.value);
    }
  } catch (error) {
    if (error instanceof NotificationServiceError) throw error;
    throw new NotificationServiceError("invalid_response");
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new NotificationServiceError("invalid_response");
  }
}

function parseResponse<T>(value: unknown, parser: (input: unknown) => T): T {
  try {
    return parser(value);
  } catch {
    throw new NotificationServiceError("invalid_response");
  }
}

function exactStateResponse<T extends "active" | "deleted">(
  value: unknown,
  ruleId: string,
  state: T,
): { readonly ruleId: string; readonly state: T } {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 2 ||
    value.ruleId !== ruleId ||
    value.state !== state
  ) {
    throw new NotificationServiceError("invalid_response");
  }
  return { ruleId, state };
}

function exactInstallationResponse(
  value: unknown,
  installationId: string,
): { readonly installationId: string; readonly state: "active" } {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 2 ||
    value.installationId !== installationId ||
    value.state !== "active"
  ) {
    throw new NotificationServiceError("invalid_response");
  }
  return { installationId, state: "active" };
}

function exactDrainResponse(
  value: unknown,
  operationId: string,
):
  | { readonly operationId: string; readonly state: "draining" }
  | {
      readonly operationId: string;
      readonly state: "inactive";
      readonly ledgerSequence: number;
    } {
  if (!isRecord(value) || value.operationId !== operationId) {
    throw new NotificationServiceError("invalid_response");
  }
  if (Object.keys(value).length === 2 && value.state === "draining") {
    return { operationId, state: "draining" };
  }
  if (
    Object.keys(value).length === 3 &&
    value.state === "inactive" &&
    Number.isSafeInteger(value.ledgerSequence) &&
    (value.ledgerSequence as number) > 0
  ) {
    return {
      operationId,
      state: "inactive",
      ledgerSequence: value.ledgerSequence as number,
    };
  }
  throw new NotificationServiceError("invalid_response");
}

function exactHttpsOrigin(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.origin !== value ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error(
      "notification service origin must be an exact HTTPS origin",
    );
  }
  return value;
}

function exactId(value: string): void {
  if (!/^[0-9a-f]{32}$/.test(value)) {
    throw new NotificationServiceError("invalid_response");
  }
}

function responseCode(status: number): NotificationServiceErrorCode {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 429) return "rate_limited";
  if (status === 503) return "not_ready";
  return "invalid_response";
}

function retryAfterMilliseconds(response: Response): number | undefined {
  if (response.status !== 429) return undefined;
  const value = response.headers.get("retry-after");
  if (!value || !/^[1-9][0-9]{0,3}$/.test(value)) return undefined;
  return Math.min(Number(value) * 1_000, 60_000);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
