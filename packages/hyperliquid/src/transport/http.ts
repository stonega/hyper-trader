import {
  HyperliquidApiError,
  type RateLimitMetadata,
  UnknownInfoRequestWeightError,
} from "../errors";
import {
  HYPERLIQUID_NETWORK_ORIGINS,
  type HyperliquidNetwork,
} from "../network";

export interface InfoRequestBudget {
  readonly requestType: string;
  readonly baseWeight: number;
  readonly responseItemDivisor?: number;
  readonly responseItemCount?: number;
  readonly totalWeight: number;
}

const WEIGHT_TWO = new Set([
  "allMids",
  "clearinghouseState",
  "exchangeStatus",
  "l2Book",
  "orderStatus",
  "spotClearinghouseState",
]);

const WEIGHT_SIXTY = new Set(["userRole"]);

const RESPONSE_WEIGHT_TWENTY = new Set([
  "delegatorHistory",
  "delegatorRewards",
  "fundingHistory",
  "historicalOrders",
  "nonUserFundingUpdates",
  "recentTrades",
  "twapHistory",
  "userFills",
  "userFillsByTime",
  "userFunding",
  "userTwapSliceFills",
  "userTwapSliceFillsByTime",
  "validatorStats",
]);

const DOCUMENTED_WEIGHT_TWENTY = new Set([
  "allMids",
  "candleSnapshot",
  "clearinghouseState",
  "exchangeStatus",
  "frontendOpenOrders",
  "fundingHistory",
  "historicalOrders",
  "l2Book",
  "meta",
  "metaAndAssetCtxs",
  "openOrders",
  "orderStatus",
  "outcomeMeta",
  "perpDexs",
  "portfolio",
  "recentTrades",
  "spotClearinghouseState",
  "spotMeta",
  "spotMetaAndAssetCtxs",
  "subAccounts",
  "userFills",
  "userFillsByTime",
  "userFunding",
  "userNonFundingLedgerUpdates",
  "userRole",
  "vaultDetails",
]);

export function getInfoRequestBudget(
  requestType: string,
  responseItemCount?: number,
): InfoRequestBudget {
  if (!DOCUMENTED_WEIGHT_TWENTY.has(requestType)) {
    throw new UnknownInfoRequestWeightError(requestType);
  }

  const baseWeight = WEIGHT_TWO.has(requestType)
    ? 2
    : WEIGHT_SIXTY.has(requestType)
      ? 60
      : 20;
  const responseItemDivisor =
    requestType === "candleSnapshot"
      ? 60
      : RESPONSE_WEIGHT_TWENTY.has(requestType)
        ? 20
        : undefined;
  const additionalWeight =
    responseItemDivisor === undefined || responseItemCount === undefined
      ? 0
      : Math.floor(responseItemCount / responseItemDivisor);

  return {
    requestType,
    baseWeight,
    ...(responseItemDivisor === undefined ? {} : { responseItemDivisor }),
    ...(responseItemCount === undefined ? {} : { responseItemCount }),
    totalWeight: baseWeight + additionalWeight,
  };
}

export interface InfoRequestOptions {
  readonly signal?: AbortSignal;
}

export interface InfoHttpTransport {
  readonly network: HyperliquidNetwork;
  readonly endpoint: string;
  request(
    body: Readonly<Record<string, unknown>> & { readonly type: string },
    options?: InfoRequestOptions,
  ): Promise<unknown>;
  budgetFor(requestType: string, responseItemCount?: number): InfoRequestBudget;
}

export interface InfoHttpTransportOptions {
  readonly network?: HyperliquidNetwork;
  readonly fetch?: typeof globalThis.fetch;
}

function parseHeaderNumber(value: string | null): number | undefined {
  if (value === null || value.trim() === "") {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseRateLimitMetadata(
  headers: Headers,
): RateLimitMetadata | undefined {
  const retryAfterSeconds = parseHeaderNumber(headers.get("retry-after"));
  const limit = parseHeaderNumber(headers.get("ratelimit-limit"));
  const remaining = parseHeaderNumber(headers.get("ratelimit-remaining"));
  const resetSeconds = parseHeaderNumber(headers.get("ratelimit-reset"));
  if (
    retryAfterSeconds === undefined &&
    limit === undefined &&
    remaining === undefined &&
    resetSeconds === undefined
  ) {
    return undefined;
  }
  return {
    ...(retryAfterSeconds === undefined
      ? {}
      : { retryAfterMs: retryAfterSeconds * 1_000 }),
    ...(limit === undefined ? {} : { limit }),
    ...(remaining === undefined ? {} : { remaining }),
    ...(resetSeconds === undefined ? {} : { resetAtMs: resetSeconds * 1_000 }),
  };
}

export function createInfoHttpTransport(
  options: InfoHttpTransportOptions = {},
): InfoHttpTransport {
  const network = options.network ?? "mainnet";
  const endpoint = HYPERLIQUID_NETWORK_ORIGINS[network].http;
  const fetchRequest = options.fetch ?? globalThis.fetch.bind(globalThis);

  return {
    network,
    endpoint,
    budgetFor: getInfoRequestBudget,
    async request(body, requestOptions = {}) {
      const requestBudget = getInfoRequestBudget(body.type);
      const response = await fetchRequest(endpoint, {
        method: "POST",
        redirect: "error",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: requestOptions.signal,
      });

      if (!response.ok) {
        throw new HyperliquidApiError({
          status: response.status,
          endpoint,
          requestBudget,
          rateLimit: parseRateLimitMetadata(response.headers),
        });
      }

      return response.json();
    },
  };
}
