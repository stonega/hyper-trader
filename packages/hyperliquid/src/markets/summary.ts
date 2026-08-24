import { HyperliquidValidationError } from "../errors";
import type { HyperliquidNetwork } from "../network";
import {
  type DecimalString,
  parseDecimalString,
  parseNullableDecimalString,
} from "../numbers/decimal";
import type { PricePrecisionInputs } from "../numbers/precision";
import type {
  Market,
  MarketFamily,
  MarketLifecycle,
  MarketOrderAvailability,
} from "./types";

export const DEFAULT_MARKET_SUMMARY_PAGE_SIZE = 24;
export const MAX_MARKET_SUMMARY_PAGE_SIZE = 50;

interface BaseMarketSummary {
  readonly family: MarketFamily;
  readonly canonicalId: string;
  readonly displaySymbol: string;
  readonly coin: string;
  readonly lifecycle: MarketLifecycle;
  readonly orderAvailability: MarketOrderAvailability;
  readonly pricePrecision: PricePrecisionInputs | null;
  readonly dayNtlVlm?: DecimalString;
  readonly funding?: DecimalString;
  readonly markPx?: DecimalString;
  readonly midPx?: DecimalString | null;
  readonly openInterest?: DecimalString;
  readonly prevDayPx?: DecimalString;
}

export interface PerpMarketSummary extends BaseMarketSummary {
  readonly family: "perp";
  readonly dexIndex: number;
  readonly dexName: string;
  readonly dexFullName: string | null;
  readonly maxLeverage: number;
}

export interface MarketSummaryToken {
  readonly tokenId: string;
  readonly name: string;
  readonly fullName: string | null;
}

export interface SpotMarketSummary extends BaseMarketSummary {
  readonly family: "spot";
  readonly baseToken: MarketSummaryToken;
  readonly quoteToken: MarketSummaryToken;
}

export interface OutcomeMarketSummary extends BaseMarketSummary {
  readonly family: "outcome";
  readonly outcome: number;
  readonly outcomeName: string;
  readonly description: string;
  readonly sideName: string;
}

export type MarketSummary =
  | PerpMarketSummary
  | SpotMarketSummary
  | OutcomeMarketSummary;

export type MarketSummarySort =
  | "symbol"
  | "volume"
  | "price_change"
  | "funding"
  | "open_interest";

export interface MarketSummaryQuery {
  readonly query: string;
  readonly family: MarketFamily | null;
  readonly includeHip3: boolean;
  readonly availability: MarketOrderAvailability | "all";
  readonly lifecycle: MarketLifecycle | "all";
  readonly sort: MarketSummarySort;
  readonly ids: readonly string[];
  readonly cursor: string | null;
  readonly limit: number;
}

export interface MarketSummaryPage {
  readonly schemaVersion: 1;
  readonly network: HyperliquidNetwork;
  readonly generation: number;
  readonly publishedAtMs: number;
  readonly items: readonly MarketSummary[];
  readonly total: number;
  readonly nextCursor: string | null;
  readonly quarantinedCount: number;
  readonly sourceErrorCount: number;
}

export class MarketSummaryGenerationChangedError extends Error {
  constructor() {
    super("market summary cursor belongs to another catalog generation");
    this.name = "MarketSummaryGenerationChangedError";
  }
}

function definedContext(market: Market) {
  return {
    ...(market.dayNtlVlm === undefined ? {} : { dayNtlVlm: market.dayNtlVlm }),
    ...(market.funding === undefined ? {} : { funding: market.funding }),
    ...(market.markPx === undefined ? {} : { markPx: market.markPx }),
    ...(market.midPx === undefined ? {} : { midPx: market.midPx }),
    ...(market.openInterest === undefined
      ? {}
      : { openInterest: market.openInterest }),
    ...(market.prevDayPx === undefined ? {} : { prevDayPx: market.prevDayPx }),
  };
}

export function marketSummaryFromMarket(market: Market): MarketSummary {
  const common = {
    family: market.family,
    canonicalId: market.canonicalId,
    displaySymbol: market.displaySymbol,
    coin: market.coin,
    lifecycle: market.lifecycle,
    orderAvailability: market.orderAvailability,
    pricePrecision: market.pricePrecision,
    ...definedContext(market),
  };
  if (market.family === "perp") {
    return {
      ...common,
      family: "perp",
      dexIndex: market.dexIndex,
      dexName: market.dexName,
      dexFullName: market.dexFullName,
      maxLeverage: market.maxLeverage,
    };
  }
  if (market.family === "spot") {
    return {
      ...common,
      family: "spot",
      baseToken: {
        tokenId: market.baseToken.tokenId,
        name: market.baseToken.name,
        fullName: market.baseToken.fullName,
      },
      quoteToken: {
        tokenId: market.quoteToken.tokenId,
        name: market.quoteToken.name,
        fullName: market.quoteToken.fullName,
      },
    };
  }
  return {
    ...common,
    family: "outcome",
    outcome: market.outcome,
    outcomeName: market.outcomeName,
    description: market.description,
    sideName: market.sideName,
  };
}

function normalize(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

function summaryLabel(market: MarketSummary): string {
  if (market.family === "spot") {
    return `${market.baseToken.name}/${market.quoteToken.name}`;
  }
  if (market.family === "outcome") {
    return `${market.outcomeName} ${market.sideName}`;
  }
  return market.displaySymbol;
}

function venueLabel(market: MarketSummary): string {
  if (market.family === "perp") {
    return market.dexIndex === 0 || market.dexName === ""
      ? "native"
      : (market.dexFullName ?? market.dexName);
  }
  return market.family === "spot" ? "spot" : market.outcomeName;
}

function searchText(market: MarketSummary): string {
  const values = [
    market.displaySymbol,
    market.canonicalId,
    market.coin,
    market.family,
    venueLabel(market),
    summaryLabel(market),
  ];
  if (market.family === "perp") {
    values.push(market.dexName, market.dexFullName ?? "");
  } else if (market.family === "spot") {
    values.push(
      market.baseToken.name,
      market.baseToken.fullName ?? "",
      market.baseToken.tokenId,
      market.quoteToken.name,
      market.quoteToken.fullName ?? "",
      market.quoteToken.tokenId,
    );
  } else {
    values.push(
      market.outcomeName,
      market.sideName,
      market.description,
      String(market.outcome),
    );
  }
  return values.map(normalize).join("\n");
}

function decimal(value: DecimalString | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function priceChange(market: MarketSummary): number | null {
  const current = decimal(market.midPx ?? market.markPx);
  const previous = decimal(market.prevDayPx);
  if (current === null || previous === null || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function metric(
  market: MarketSummary,
  sort: Exclude<MarketSummarySort, "symbol">,
): number | null {
  switch (sort) {
    case "volume":
      return decimal(market.dayNtlVlm);
    case "price_change":
      return priceChange(market);
    case "funding":
      return market.family === "perp" ? decimal(market.funding) : null;
    case "open_interest":
      return market.family === "perp" ? decimal(market.openInterest) : null;
  }
}

function compareText(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function compareSummaries(
  left: MarketSummary,
  right: MarketSummary,
  sort: MarketSummarySort,
): number {
  if (sort !== "symbol") {
    const leftMetric = metric(left, sort);
    const rightMetric = metric(right, sort);
    if (leftMetric === null && rightMetric !== null) return 1;
    if (leftMetric !== null && rightMetric === null) return -1;
    if (
      leftMetric !== null &&
      rightMetric !== null &&
      leftMetric !== rightMetric
    ) {
      return rightMetric - leftMetric;
    }
  }
  const labelOrder = compareText(
    normalize(summaryLabel(left)),
    normalize(summaryLabel(right)),
  );
  return labelOrder === 0
    ? compareText(left.canonicalId, right.canonicalId)
    : labelOrder;
}

export function createMarketSummaryPage(input: {
  readonly network: HyperliquidNetwork;
  readonly generation: number;
  readonly publishedAtMs: number;
  readonly markets: readonly Market[];
  readonly quarantinedCount: number;
  readonly sourceErrorCount: number;
  readonly query: MarketSummaryQuery;
}): MarketSummaryPage {
  if (
    !Number.isSafeInteger(input.query.limit) ||
    input.query.limit < 1 ||
    input.query.limit > MAX_MARKET_SUMMARY_PAGE_SIZE
  ) {
    throw new HyperliquidValidationError(
      "marketSummary.limit",
      `expected an integer between 1 and ${MAX_MARKET_SUMMARY_PAGE_SIZE}`,
    );
  }
  const offset = parseMarketSummaryCursor(input.query.cursor, input.generation);
  const ids = input.query.ids.length === 0 ? null : new Set(input.query.ids);
  const tokens = normalize(input.query.query).split(/\s+/u).filter(Boolean);
  const summaries = input.markets
    .map(marketSummaryFromMarket)
    .filter(
      (market) =>
        (input.query.family === null || market.family === input.query.family) &&
        (input.query.includeHip3 ||
          market.family !== "perp" ||
          market.dexIndex === 0) &&
        (input.query.availability === "all" ||
          market.orderAvailability === input.query.availability) &&
        (input.query.lifecycle === "all" ||
          market.lifecycle === input.query.lifecycle) &&
        (ids === null || ids.has(market.canonicalId)) &&
        (tokens.length === 0 ||
          tokens.every((token) => searchText(market).includes(token))),
    )
    .sort((left, right) => compareSummaries(left, right, input.query.sort));
  const items = summaries.slice(offset, offset + input.query.limit);
  const nextOffset = offset + items.length;
  return {
    schemaVersion: 1,
    network: input.network,
    generation: input.generation,
    publishedAtMs: input.publishedAtMs,
    items,
    total: summaries.length,
    nextCursor:
      nextOffset < summaries.length
        ? marketSummaryCursor(input.generation, nextOffset)
        : null,
    quarantinedCount: input.quarantinedCount,
    sourceErrorCount: input.sourceErrorCount,
  };
}

function marketSummaryCursor(generation: number, offset: number): string {
  return `g${generation}o${offset}`;
}

export function parseMarketSummaryCursor(
  cursor: string | null,
  generation?: number,
): number {
  if (cursor === null) return 0;
  const match = /^g([1-9][0-9]*)o(0|[1-9][0-9]*)$/.exec(cursor);
  if (!match?.[1] || !match[2]) {
    throw new HyperliquidValidationError(
      "marketSummary.cursor",
      "expected a generation-bound cursor",
    );
  }
  const cursorGeneration = Number(match[1]);
  const offset = Number(match[2]);
  if (
    !Number.isSafeInteger(cursorGeneration) ||
    !Number.isSafeInteger(offset)
  ) {
    throw new HyperliquidValidationError(
      "marketSummary.cursor",
      "expected a safe generation-bound cursor",
    );
  }
  if (generation !== undefined && cursorGeneration !== generation) {
    throw new MarketSummaryGenerationChangedError();
  }
  return offset;
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HyperliquidValidationError(path, "expected an object");
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) {
      throw new HyperliquidValidationError(`${path}.${key}`, "unknown field");
    }
  }
}

function text(value: unknown, path: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0)) {
    throw new HyperliquidValidationError(path, "expected a string");
  }
  return value;
}

function nullableText(value: unknown, path: string): string | null {
  return value === null ? null : text(value, path);
}

function safeInteger(value: unknown, path: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new HyperliquidValidationError(path, "expected a safe integer");
  }
  return value as number;
}

const CONTEXT_KEYS = [
  "dayNtlVlm",
  "funding",
  "markPx",
  "midPx",
  "openInterest",
  "prevDayPx",
] as const;
const BASE_KEYS = [
  "family",
  "canonicalId",
  "displaySymbol",
  "coin",
  "lifecycle",
  "orderAvailability",
  "pricePrecision",
  ...CONTEXT_KEYS,
] as const;

function parsedContext(source: Record<string, unknown>, path: string) {
  const decimalField = (key: (typeof CONTEXT_KEYS)[number]) =>
    source[key] === undefined
      ? {}
      : {
          [key]:
            key === "midPx"
              ? parseNullableDecimalString(source[key], `${path}.${key}`)
              : parseDecimalString(source[key], `${path}.${key}`),
        };
  return Object.assign({}, ...CONTEXT_KEYS.map(decimalField));
}

function parseToken(value: unknown, path: string): MarketSummaryToken {
  const source = object(value, path);
  exactKeys(source, ["tokenId", "name", "fullName"], path);
  return {
    tokenId: text(source.tokenId, `${path}.tokenId`),
    name: text(source.name, `${path}.name`),
    fullName: nullableText(source.fullName, `${path}.fullName`),
  };
}

function parsePricePrecision(
  value: unknown,
  path: string,
): PricePrecisionInputs | null {
  if (value === null) return null;
  const source = object(value, path);
  exactKeys(source, ["maxSignificantFigures", "maxDecimalPlaces"], path);
  if (source.maxSignificantFigures !== 5) {
    throw new HyperliquidValidationError(
      `${path}.maxSignificantFigures`,
      "expected 5",
    );
  }
  const maxDecimalPlaces = safeInteger(
    source.maxDecimalPlaces,
    `${path}.maxDecimalPlaces`,
  );
  if (maxDecimalPlaces > 8) {
    throw new HyperliquidValidationError(
      `${path}.maxDecimalPlaces`,
      "expected at most 8",
    );
  }
  return { maxSignificantFigures: 5, maxDecimalPlaces };
}

function parseSummary(value: unknown, path: string): MarketSummary {
  const source = object(value, path);
  const family = source.family;
  const common = {
    canonicalId: text(source.canonicalId, `${path}.canonicalId`),
    displaySymbol: text(source.displaySymbol, `${path}.displaySymbol`),
    coin: text(source.coin, `${path}.coin`),
    lifecycle:
      source.lifecycle === "active" || source.lifecycle === "delisted"
        ? source.lifecycle
        : (() => {
            throw new HyperliquidValidationError(
              `${path}.lifecycle`,
              "expected a market lifecycle",
            );
          })(),
    orderAvailability:
      source.orderAvailability === "enabled" ||
      source.orderAvailability === "browse_only"
        ? source.orderAvailability
        : (() => {
            throw new HyperliquidValidationError(
              `${path}.orderAvailability`,
              "expected market availability",
            );
          })(),
    pricePrecision: parsePricePrecision(
      source.pricePrecision,
      `${path}.pricePrecision`,
    ),
    ...parsedContext(source, path),
  };
  if (family === "perp") {
    exactKeys(
      source,
      [...BASE_KEYS, "dexIndex", "dexName", "dexFullName", "maxLeverage"],
      path,
    );
    return {
      ...common,
      family,
      dexIndex: safeInteger(source.dexIndex, `${path}.dexIndex`),
      dexName: text(source.dexName, `${path}.dexName`, true),
      dexFullName: nullableText(source.dexFullName, `${path}.dexFullName`),
      maxLeverage: safeInteger(source.maxLeverage, `${path}.maxLeverage`, 1),
    };
  }
  if (family === "spot") {
    exactKeys(source, [...BASE_KEYS, "baseToken", "quoteToken"], path);
    return {
      ...common,
      family,
      baseToken: parseToken(source.baseToken, `${path}.baseToken`),
      quoteToken: parseToken(source.quoteToken, `${path}.quoteToken`),
    };
  }
  if (family === "outcome") {
    exactKeys(
      source,
      [...BASE_KEYS, "outcome", "outcomeName", "description", "sideName"],
      path,
    );
    return {
      ...common,
      family,
      outcome: safeInteger(source.outcome, `${path}.outcome`),
      outcomeName: text(source.outcomeName, `${path}.outcomeName`),
      description: text(source.description, `${path}.description`, true),
      sideName: text(source.sideName, `${path}.sideName`),
    };
  }
  throw new HyperliquidValidationError(
    `${path}.family`,
    "expected a market family",
  );
}

export function parseMarketSummaryPage(value: unknown): MarketSummaryPage {
  const source = object(value, "marketSummaryPage");
  exactKeys(
    source,
    [
      "schemaVersion",
      "network",
      "generation",
      "publishedAtMs",
      "items",
      "total",
      "nextCursor",
      "quarantinedCount",
      "sourceErrorCount",
    ],
    "marketSummaryPage",
  );
  if (source.schemaVersion !== 1) {
    throw new HyperliquidValidationError(
      "marketSummaryPage.schemaVersion",
      "expected schema version 1",
    );
  }
  if (source.network !== "testnet" && source.network !== "mainnet") {
    throw new HyperliquidValidationError(
      "marketSummaryPage.network",
      "expected a Hyperliquid network",
    );
  }
  if (
    !Array.isArray(source.items) ||
    source.items.length > MAX_MARKET_SUMMARY_PAGE_SIZE
  ) {
    throw new HyperliquidValidationError(
      "marketSummaryPage.items",
      `expected at most ${MAX_MARKET_SUMMARY_PAGE_SIZE} items`,
    );
  }
  const generation = safeInteger(
    source.generation,
    "marketSummaryPage.generation",
    1,
  );
  const total = safeInteger(source.total, "marketSummaryPage.total");
  const items = source.items.map((item, index) =>
    parseSummary(item, `marketSummaryPage.items[${index}]`),
  );
  const nextCursor =
    source.nextCursor === null
      ? null
      : text(source.nextCursor, "marketSummaryPage.nextCursor");
  if (nextCursor !== null) parseMarketSummaryCursor(nextCursor, generation);
  if (items.length > total) {
    throw new HyperliquidValidationError(
      "marketSummaryPage.total",
      "expected total to cover returned items",
    );
  }
  return {
    schemaVersion: 1,
    network: source.network,
    generation,
    publishedAtMs: safeInteger(
      source.publishedAtMs,
      "marketSummaryPage.publishedAtMs",
    ),
    items,
    total,
    nextCursor,
    quarantinedCount: safeInteger(
      source.quarantinedCount,
      "marketSummaryPage.quarantinedCount",
    ),
    sourceErrorCount: safeInteger(
      source.sourceErrorCount,
      "marketSummaryPage.sourceErrorCount",
    ),
  };
}
