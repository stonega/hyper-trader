import {
  type HyperliquidNetwork,
  type MarketCatalog,
  parseMarketCatalogSnapshot,
} from "@hyper-trader/hyperliquid/public";
import {
  assertRequestBodySize,
  CONTRACT_LIMITS,
  ContractError,
  parseDeletePriceRuleRequest,
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
  parseDeletedRuleResponse,
  parseDrainResponse,
  parseInstallationResponse,
  parseLostRevokeResponse,
  parseMobileAlertResponse,
  parseMobileSnapshotResponse,
  parsePushTokenResponse,
  parseRuleResponse,
} from "./application";

const JSON_CONTENT_TYPE = "application/json";
const MAX_MARKET_CATALOG_RESPONSE_BYTES = 8 * 1024 * 1024;
const BEARER = /^Bearer ([0-9a-f]{64})$/;
const PROTECTED_POST_PATHS = new Set([
  "/v1/challenges",
  "/v1/account-links/verify",
  "/v1/installations/revoke",
  "/v1/account-links/unlink",
  "/v1/installations/revoke-lost",
]);

export interface MarketCatalogReader {
  readPublished(network: HyperliquidNetwork): Promise<{
    readonly network: HyperliquidNetwork;
    readonly generation: number;
    readonly publishedAtMs: number;
    readonly catalog: MarketCatalog;
  } | null>;
}

export interface MarketCatalogServerOptions {
  readonly serviceOrigin: string;
  readonly marketCatalog: MarketCatalogReader;
}

export interface NotificationServerOptions {
  readonly application: NotificationApplication;
  readonly serviceOrigin: string;
  readonly marketCatalog?: MarketCatalogReader;
}

export interface NotificationDirectTlsServerBoundary {
  readonly transport: "direct-tls";
  readonly tls: Readonly<{
    readonly cert: NonNullable<Bun.TLSOptions["cert"]>;
    readonly key: NonNullable<Bun.TLSOptions["key"]>;
    readonly passphrase?: Bun.TLSOptions["passphrase"];
  }>;
}

export type NotificationRequestHandler = (
  request: Request,
  context: NotificationApplicationContext,
) => Promise<Response>;

export type MarketCatalogRequestHandler = (
  request: Request,
) => Promise<Response>;

export function createMarketCatalogRequestHandler(
  options: MarketCatalogServerOptions,
): MarketCatalogRequestHandler {
  const origin = exactServiceOrigin(options.serviceOrigin);
  return async (request) => {
    try {
      const url = new URL(request.url);
      if (url.origin !== origin) {
        return jsonResponse(421, { error: "origin_mismatch" });
      }
      if (url.search !== "") {
        return jsonResponse(400, { error: "query_not_allowed" });
      }
      if (request.method !== "GET") {
        return jsonResponse(405, { error: "method_not_allowed" });
      }
      if (url.pathname === "/health") {
        return jsonResponse(200, { status: "ok" });
      }
      const match = /^\/v1\/market-catalog\/(testnet|mainnet)$/.exec(
        url.pathname,
      );
      if (!match?.[1]) {
        return jsonResponse(404, { error: "not_found" });
      }
      return marketCatalogResponse(
        request,
        match[1] as HyperliquidNetwork,
        options.marketCatalog,
      );
    } catch {
      return jsonResponse(500, { error: "internal_error" });
    }
  };
}

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
      if (
        request.method !== "GET" &&
        request.method !== "POST" &&
        request.method !== "PUT" &&
        request.method !== "DELETE"
      ) {
        return jsonResponse(405, { error: "method_not_allowed" });
      }
      const isRegistration =
        request.method === "POST" && url.pathname === "/v1/installations";
      const marketCatalogPath =
        request.method === "GET"
          ? /^\/v1\/market-catalog\/(testnet|mainnet)$/.exec(url.pathname)
          : null;
      const credentialPath =
        /^\/v1\/installations\/([0-9a-f]{32})\/credential$/.exec(url.pathname);
      const pushTokenPath =
        /^\/v1\/installations\/([0-9a-f]{32})\/push-token$/.exec(url.pathname);
      const snapshotPath =
        /^\/v1\/installations\/([0-9a-f]{32})\/snapshot$/.exec(url.pathname);
      const alertPath = /^\/v1\/alerts\/([0-9a-f]{32})$/.exec(url.pathname);
      const deleteRulePath = /^\/v1\/rules\/([0-9a-f]{32})$/.exec(url.pathname);
      const isRule =
        request.method === "PUT" &&
        /^\/v1\/rules\/[0-9a-f]{32}$/.test(url.pathname);
      const isKnownProtectedRoute =
        (request.method === "POST" && PROTECTED_POST_PATHS.has(url.pathname)) ||
        (request.method === "GET" &&
          (snapshotPath?.[1] !== undefined || alertPath?.[1] !== undefined)) ||
        (request.method === "DELETE" && deleteRulePath?.[1] !== undefined) ||
        (request.method === "PUT" &&
          (credentialPath?.[1] !== undefined ||
            pushTokenPath?.[1] !== undefined ||
            isRule));
      if (!isRegistration && !marketCatalogPath && !isKnownProtectedRoute) {
        return jsonResponse(404, { error: "not_found" });
      }
      if (marketCatalogPath?.[1]) {
        if (!options.marketCatalog) {
          throw new ApplicationError(503, "market catalog is not configured");
        }
        return marketCatalogResponse(
          request,
          marketCatalogPath[1] as HyperliquidNetwork,
          options.marketCatalog,
        );
      }
      const authenticated = isRegistration
        ? undefined
        : authenticate(request, context);
      const body =
        request.method === "GET" ? undefined : await readBoundedJson(request);
      if (isRegistration) {
        const result = await options.application.registerInstallation(
          parseRegisterInstallationRequest(body),
          context,
        );
        return jsonResponse(201, parseInstallationResponse(result));
      }
      if (!authenticated)
        throw new ApplicationError(401, "authentication required");
      if (request.method === "GET" && snapshotPath?.[1]) {
        return jsonResponse(
          200,
          parseMobileSnapshotResponse(
            await options.application.readInstallationSnapshot(
              snapshotPath[1],
              authenticated,
            ),
          ),
        );
      }
      if (request.method === "GET" && alertPath?.[1]) {
        return jsonResponse(
          200,
          parseMobileAlertResponse(
            await options.application.readAlert(alertPath[1], authenticated),
          ),
        );
      }
      if (request.method === "DELETE" && deleteRulePath?.[1]) {
        const parsed = parseDeletePriceRuleRequest(body);
        if (parsed.ruleId !== deleteRulePath[1]) {
          throw new ContractError("path and body rule IDs differ");
        }
        return jsonResponse(
          200,
          parseDeletedRuleResponse(
            await options.application.deletePriceRule(parsed, authenticated),
          ),
        );
      }
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
  options: NotificationServerOptions & {
    readonly port: number;
    readonly serverBoundary: NotificationDirectTlsServerBoundary;
  },
): Bun.Server<undefined> {
  const handler = createNotificationRequestHandler(options);
  const tls = directTlsOptions(options.serverBoundary);
  return Bun.serve({
    port: options.port,
    maxRequestBodySize: CONTRACT_LIMITS.maxBodyBytes,
    tls,
    fetch(request, server) {
      return handler(request, {
        ip: server.requestIP(request)?.address ?? "0.0.0.0",
      });
    },
  });
}

export function startMarketCatalogServer(
  options: MarketCatalogServerOptions & {
    readonly port: number;
    readonly serverBoundary: NotificationDirectTlsServerBoundary;
  },
): Bun.Server<undefined> {
  const handler = createMarketCatalogRequestHandler(options);
  const tls = directTlsOptions(options.serverBoundary);
  return Bun.serve({
    port: options.port,
    maxRequestBodySize: CONTRACT_LIMITS.maxBodyBytes,
    tls,
    fetch: handler,
  });
}

async function marketCatalogResponse(
  request: Request,
  network: HyperliquidNetwork,
  marketCatalog: MarketCatalogReader,
): Promise<Response> {
  const published = await marketCatalog.readPublished(network);
  if (!published) {
    return jsonResponse(503, { error: "not_ready" }, { "retry-after": "30" });
  }
  const snapshot = parseMarketCatalogSnapshot({
    schemaVersion: 1,
    network: published.network,
    generation: published.generation,
    publishedAtMs: published.publishedAtMs,
    markets: published.catalog.markets,
    quarantined: published.catalog.quarantined,
    sourceErrors: published.catalog.sourceErrors,
  });
  const etag = `"market-catalog-${snapshot.network}-${snapshot.generation}"`;
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, {
      status: 304,
      headers: {
        "cache-control":
          "public, max-age=30, stale-while-revalidate=300, stale-if-error=86400",
        etag,
      },
    });
  }
  return jsonResponse(
    200,
    {
      schemaVersion: snapshot.schemaVersion,
      network: snapshot.network,
      generation: snapshot.generation,
      publishedAtMs: snapshot.publishedAtMs,
      markets: snapshot.catalog.markets,
      quarantined: snapshot.catalog.quarantined,
      sourceErrors: snapshot.catalog.sourceErrors,
    },
    {
      "cache-control":
        "public, max-age=30, stale-while-revalidate=300, stale-if-error=86400",
      etag,
    },
    MAX_MARKET_CATALOG_RESPONSE_BYTES,
  );
}

function directTlsOptions(
  boundary: NotificationDirectTlsServerBoundary | undefined,
): NotificationDirectTlsServerBoundary["tls"] {
  if (
    boundary?.transport !== "direct-tls" ||
    boundary.tls?.cert === undefined ||
    boundary.tls.key === undefined
  ) {
    throw new Error(
      "HTTPS notification server requires a direct TLS server boundary with certificate and key material",
    );
  }
  return boundary.tls;
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
  maxBytes = CONTRACT_LIMITS.maxResponseBytes,
): Response {
  const body = JSON.stringify(value);
  if (body === undefined)
    throw new ContractError("response is not JSON serializable");
  if (new TextEncoder().encode(body).byteLength > maxBytes) {
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
