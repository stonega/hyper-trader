import {
  assertRequestBodySize,
  CONTRACT_LIMITS,
  ContractError,
  parseIssueChallengeRequest,
  parseLostInstallationRevokeRequest,
  parsePushTokenRebindRequest,
  parsePutRuleRequest,
  parseRegisterInstallationRequest,
  parseRevokeInstallationRequest,
  parseRotateInstallationCredentialRequest,
  parseUnlinkAccountRequest,
  parseVerifyAccountLinkRequest,
} from "@hyper-trader/notifications";

import {
  ApplicationError,
  type AuthenticatedApplicationContext,
  type NotificationApplication,
  type NotificationApplicationContext,
  parseAccountLinkResponse,
  parseChallengeResponse,
  parseCredentialRotationResponse,
  parseDrainResponse,
  parseInstallationResponse,
  parseLostRevokeResponse,
  parsePushTokenResponse,
  parseRuleResponse,
} from "./application";

const JSON_CONTENT_TYPE = "application/json";
const BEARER = /^Bearer ([0-9a-f]{64})$/;
const PROTECTED_POST_PATHS = new Set([
  "/v1/challenges",
  "/v1/account-links/verify",
  "/v1/installations/revoke",
  "/v1/account-links/unlink",
  "/v1/installations/revoke-lost",
]);

export interface NotificationServerOptions {
  readonly application: NotificationApplication;
  readonly serviceOrigin: string;
}

export type NotificationRequestHandler = (
  request: Request,
  context: NotificationApplicationContext,
) => Promise<Response>;

export function createNotificationRequestHandler(
  options: NotificationServerOptions,
): NotificationRequestHandler {
  const origin = exactServiceOrigin(options.serviceOrigin);
  return async (request, context) => {
    try {
      const url = new URL(request.url);
      if (url.origin !== origin)
        return jsonResponse(421, { error: "origin_mismatch" });
      if (url.search !== "")
        return jsonResponse(400, { error: "query_not_allowed" });
      if (request.method === "GET" && url.pathname === "/health") {
        return jsonResponse(200, { status: "ok" });
      }
      if (request.method !== "POST" && request.method !== "PUT") {
        return jsonResponse(405, { error: "method_not_allowed" });
      }
      const isRegistration =
        request.method === "POST" && url.pathname === "/v1/installations";
      const credentialPath =
        /^\/v1\/installations\/([0-9a-f]{32})\/credential$/.exec(url.pathname);
      const pushTokenPath =
        /^\/v1\/installations\/([0-9a-f]{32})\/push-token$/.exec(url.pathname);
      const isRule =
        request.method === "PUT" &&
        /^\/v1\/rules\/[0-9a-f]{32}$/.test(url.pathname);
      const isKnownProtectedRoute =
        (request.method === "POST" && PROTECTED_POST_PATHS.has(url.pathname)) ||
        (request.method === "PUT" &&
          (credentialPath?.[1] !== undefined ||
            pushTokenPath?.[1] !== undefined ||
            isRule));
      if (!isRegistration && !isKnownProtectedRoute) {
        return jsonResponse(404, { error: "not_found" });
      }
      const authenticated = isRegistration
        ? undefined
        : authenticate(request, context);
      const body = await readBoundedJson(request);
      if (isRegistration) {
        const result = await options.application.registerInstallation(
          parseRegisterInstallationRequest(body),
          context,
        );
        return jsonResponse(201, parseInstallationResponse(result));
      }
      if (!authenticated)
        throw new ApplicationError(401, "authentication required");
      if (request.method === "POST" && url.pathname === "/v1/challenges") {
        return jsonResponse(
          201,
          parseChallengeResponse(
            await options.application.issueChallenge(
              parseIssueChallengeRequest(body),
              authenticated,
            ),
          ),
        );
      }
      if (
        request.method === "POST" &&
        url.pathname === "/v1/account-links/verify"
      ) {
        return jsonResponse(
          201,
          parseAccountLinkResponse(
            await options.application.verifyAccountLink(
              parseVerifyAccountLinkRequest(body),
              authenticated,
            ),
          ),
        );
      }
      if (request.method === "PUT" && credentialPath?.[1]) {
        const parsed = parseRotateInstallationCredentialRequest(body);
        if (parsed.installationId !== credentialPath[1]) {
          throw new ContractError("path and body installation IDs differ");
        }
        return jsonResponse(
          200,
          parseCredentialRotationResponse(
            await options.application.rotateInstallationCredential(
              parsed,
              authenticated,
            ),
          ),
        );
      }
      if (request.method === "PUT" && pushTokenPath?.[1]) {
        const parsed = parsePushTokenRebindRequest(body);
        if (parsed.installationId !== pushTokenPath[1]) {
          throw new ContractError("path and body installation IDs differ");
        }
        return jsonResponse(
          200,
          parsePushTokenResponse(
            await options.application.rebindPushToken(parsed, authenticated),
          ),
        );
      }
      if (isRule) {
        const parsed = parsePutRuleRequest(body);
        const pathRuleId = url.pathname.slice("/v1/rules/".length);
        if (parsed.rule.ruleId !== pathRuleId) {
          throw new ContractError("path and body rule IDs differ");
        }
        return jsonResponse(
          200,
          parseRuleResponse(
            await options.application.putRule(parsed, authenticated),
          ),
        );
      }
      if (
        request.method === "POST" &&
        url.pathname === "/v1/installations/revoke"
      ) {
        return jsonResponse(
          202,
          parseDrainResponse(
            await options.application.revokeInstallation(
              parseRevokeInstallationRequest(body),
              authenticated,
            ),
          ),
        );
      }
      if (
        request.method === "POST" &&
        url.pathname === "/v1/account-links/unlink"
      ) {
        return jsonResponse(
          202,
          parseDrainResponse(
            await options.application.unlinkAccount(
              parseUnlinkAccountRequest(body),
              authenticated,
            ),
          ),
        );
      }
      if (
        request.method === "POST" &&
        url.pathname === "/v1/installations/revoke-lost"
      ) {
        return jsonResponse(
          202,
          parseLostRevokeResponse(
            await options.application.revokeLostInstallations(
              parseLostInstallationRevokeRequest(body),
              authenticated,
            ),
          ),
        );
      }
      return jsonResponse(404, { error: "not_found" });
    } catch (error) {
      if (error instanceof BodyTooLargeError) {
        return jsonResponse(413, { error: "body_too_large" });
      }
      if (error instanceof ContractError || error instanceof SyntaxError) {
        return jsonResponse(400, { error: "invalid_request" });
      }
      if (error instanceof ApplicationError) {
        const headers =
          error.status === 429 && error.retryAfterMs !== undefined
            ? {
                "retry-after": String(
                  Math.max(1, Math.ceil(error.retryAfterMs / 1000)),
                ),
              }
            : undefined;
        return jsonResponse(
          error.status,
          { error: applicationErrorCode(error.status) },
          headers,
        );
      }
      return jsonResponse(500, { error: "internal_error" });
    }
  };
}

export function startNotificationServer(
  options: NotificationServerOptions & { readonly port: number },
): Bun.Server<undefined> {
  const handler = createNotificationRequestHandler(options);
  return Bun.serve({
    port: options.port,
    maxRequestBodySize: CONTRACT_LIMITS.maxBodyBytes,
    fetch(request, server) {
      return handler(request, {
        ip: server.requestIP(request)?.address ?? "0.0.0.0",
      });
    },
  });
}

async function readBoundedJson(request: Request): Promise<unknown> {
  const contentType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim();
  if (contentType !== JSON_CONTENT_TYPE) {
    throw new ContractError("content-type must be application/json");
  }
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^(?:0|[1-9][0-9]*)$/.test(declaredLength)) {
      throw new ContractError("content-length is invalid");
    }
    const length = Number(declaredLength);
    if (length > CONTRACT_LIMITS.maxBodyBytes) {
      return Promise.reject(new BodyTooLargeError());
    }
    assertRequestBodySize(length);
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > CONTRACT_LIMITS.maxBodyBytes)
    throw new BodyTooLargeError();
  assertRequestBodySize(bytes.byteLength);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ContractError("request body is not valid UTF-8");
  }
  return JSON.parse(text);
}

function authenticate(
  request: Request,
  context: NotificationApplicationContext,
): AuthenticatedApplicationContext {
  const match = BEARER.exec(request.headers.get("authorization") ?? "");
  if (!match?.[1]) throw new ApplicationError(401, "authentication required");
  return { ...context, credential: match[1] };
}

function jsonResponse(
  status: number,
  value: unknown,
  headers?: HeadersInit,
): Response {
  const body = JSON.stringify(value);
  if (body === undefined)
    throw new ContractError("response is not JSON serializable");
  if (
    new TextEncoder().encode(body).byteLength > CONTRACT_LIMITS.maxResponseBytes
  ) {
    throw new ContractError("response body exceeds 64 KiB");
  }
  return new Response(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": JSON_CONTENT_TYPE,
      ...headers,
    },
  });
}

function exactServiceOrigin(value: string): string {
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
    throw new Error("serviceOrigin must be an exact HTTPS origin");
  }
  return value;
}

function applicationErrorCode(status: number): string {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 429) return "rate_limited";
  if (status === 503) return "not_ready";
  return "request_failed";
}

class BodyTooLargeError extends ContractError {
  constructor() {
    super("request body exceeds 64 KiB");
    this.name = "BodyTooLargeError";
  }
}
