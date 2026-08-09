import type { InfoRequestBudget } from "./transport/http";

export interface RateLimitMetadata {
  readonly retryAfterMs?: number;
  readonly limit?: number;
  readonly remaining?: number;
  readonly resetAtMs?: number;
}

export class HyperliquidApiError extends Error {
  readonly status: number;
  readonly endpoint: string;
  readonly requestBudget: InfoRequestBudget;
  readonly rateLimit?: RateLimitMetadata;

  constructor(options: {
    readonly status: number;
    readonly endpoint: string;
    readonly requestBudget: InfoRequestBudget;
    readonly rateLimit?: RateLimitMetadata;
  }) {
    super(`Hyperliquid API request failed with status ${options.status}.`);
    this.name = "HyperliquidApiError";
    this.status = options.status;
    this.endpoint = options.endpoint;
    this.requestBudget = options.requestBudget;
    this.rateLimit = options.rateLimit;
  }
}

export class HyperliquidValidationError extends TypeError {
  readonly path: string;

  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "HyperliquidValidationError";
    this.path = path;
  }
}

export class UnknownInfoRequestWeightError extends Error {
  readonly requestType: string;

  constructor(requestType: string) {
    super(
      `No rate-weight metadata is registered for info request ${requestType}.`,
    );
    this.name = "UnknownInfoRequestWeightError";
    this.requestType = requestType;
  }
}
