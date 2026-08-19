import { HyperliquidValidationError } from "../errors";
import type { HyperliquidNetwork } from "../network";
import {
  parseDecimalString,
  parseNullableDecimalString,
} from "../numbers/decimal";
import type {
  CatalogSourceError,
  Market,
  MarketCatalog,
  QuarantinedMarket,
} from "./types";

const CONTEXT_KEYS = [
  "dayNtlVlm",
  "dayBaseVlm",
  "funding",
  "impactPxs",
  "markPx",
  "midPx",
  "openInterest",
  "oraclePx",
  "premium",
  "prevDayPx",
] as const;

const BASE_MARKET_KEYS = [
  "family",
  "canonicalId",
  "displaySymbol",
  "coin",
  "universeIndex",
  "orderAssetId",
  "lifecycle",
  "orderAvailability",
  "validationReasons",
  ...CONTEXT_KEYS,
] as const;

export interface MarketCatalogSnapshot {
  readonly schemaVersion: 1;
  readonly network: HyperliquidNetwork;
  readonly generation: number;
  readonly publishedAtMs: number;
  readonly catalog: MarketCatalog;
}

export function parseMarketCatalogSnapshot(
  value: unknown,
): MarketCatalogSnapshot {
  const source = exactRecord(value, "marketCatalogSnapshot", [
    "schemaVersion",
    "network",
    "generation",
    "publishedAtMs",
    "markets",
    "quarantined",
    "sourceErrors",
  ]);
  if (source.schemaVersion !== 1) {
    invalid("marketCatalogSnapshot.schemaVersion", "expected version 1");
  }
  const network = source.network;
  if (network !== "testnet" && network !== "mainnet") {
    invalid("marketCatalogSnapshot.network", "expected a supported network");
  }
  return {
    schemaVersion: 1,
    network,
    generation: positiveInteger(
      source.generation,
      "marketCatalogSnapshot.generation",
    ),
    publishedAtMs: positiveInteger(
      source.publishedAtMs,
      "marketCatalogSnapshot.publishedAtMs",
    ),
    catalog: {
      markets: boundedArray(
        source.markets,
        "marketCatalogSnapshot.markets",
        20_000,
      ).map(parseMarket),
      quarantined: boundedArray(
        source.quarantined,
        "marketCatalogSnapshot.quarantined",
        20_000,
      ).map(parseQuarantinedMarket),
      sourceErrors: boundedArray(
        source.sourceErrors,
        "marketCatalogSnapshot.sourceErrors",
        2_000,
      ).map(parseSourceError),
    },
  };
}

function parseMarket(value: unknown, index: number): Market {
  const path = `marketCatalogSnapshot.markets[${index}]`;
  const candidate = record(value, path);
  const family = candidate.family;
  const familyKeys =
    family === "perp"
      ? [
          "dexIndex",
          "dexName",
          "dexFullName",
          "sizeDecimals",
          "pricePrecision",
          "maxLeverage",
          "onlyIsolated",
          "marginMode",
          "marginTableId",
        ]
      : family === "spot"
        ? [
            "dexIndex",
            "dexName",
            "sizeDecimals",
            "pricePrecision",
            "baseToken",
            "quoteToken",
            "isCanonical",
          ]
        : family === "outcome"
          ? [
              "dexIndex",
              "dexName",
              "outcome",
              "outcomeName",
              "description",
              "side",
              "sideName",
              "encoding",
              "sizeDecimals",
              "pricePrecision",
            ]
          : invalid(path, "expected a supported market family");
  exactKeys(candidate, path, [...BASE_MARKET_KEYS, ...familyKeys]);
  parseBaseMarket(candidate, path);

  if (family === "perp") {
    nonNegativeInteger(candidate.dexIndex, `${path}.dexIndex`);
    boundedString(candidate.dexName, `${path}.dexName`, 128, true);
    nullableBoundedString(candidate.dexFullName, `${path}.dexFullName`, 256);
    const sizeDecimals = nonNegativeInteger(
      candidate.sizeDecimals,
      `${path}.sizeDecimals`,
    );
    if (sizeDecimals > 6)
      invalid(`${path}.sizeDecimals`, "exceeds perp precision");
    parsePricePrecision(
      candidate.pricePrecision,
      `${path}.pricePrecision`,
      6 - sizeDecimals,
    );
    positiveInteger(candidate.maxLeverage, `${path}.maxLeverage`);
    boolean(candidate.onlyIsolated, `${path}.onlyIsolated`);
    nullableBoundedString(candidate.marginMode, `${path}.marginMode`, 128);
    nullableNonNegativeInteger(
      candidate.marginTableId,
      `${path}.marginTableId`,
    );
  } else if (family === "spot") {
    literalNull(candidate.dexIndex, `${path}.dexIndex`);
    literalNull(candidate.dexName, `${path}.dexName`);
    const sizeDecimals = nonNegativeInteger(
      candidate.sizeDecimals,
      `${path}.sizeDecimals`,
    );
    if (sizeDecimals > 8)
      invalid(`${path}.sizeDecimals`, "exceeds spot precision");
    parsePricePrecision(
      candidate.pricePrecision,
      `${path}.pricePrecision`,
      8 - sizeDecimals,
    );
    parseToken(candidate.baseToken, `${path}.baseToken`);
    parseToken(candidate.quoteToken, `${path}.quoteToken`);
    boolean(candidate.isCanonical, `${path}.isCanonical`);
  } else {
    literalNull(candidate.dexIndex, `${path}.dexIndex`);
    literalNull(candidate.dexName, `${path}.dexName`);
    nonNegativeInteger(candidate.outcome, `${path}.outcome`);
    boundedString(candidate.outcomeName, `${path}.outcomeName`, 256);
    boundedString(candidate.description, `${path}.description`, 4096, true);
    if (candidate.side !== 0 && candidate.side !== 1) {
      invalid(`${path}.side`, "expected outcome side 0 or 1");
    }
    boundedString(candidate.sideName, `${path}.sideName`, 256);
    nonNegativeInteger(candidate.encoding, `${path}.encoding`);
    literalNull(candidate.sizeDecimals, `${path}.sizeDecimals`);
    literalNull(candidate.pricePrecision, `${path}.pricePrecision`);
  }
  return candidate as unknown as Market;
}

function parseBaseMarket(value: Record<string, unknown>, path: string): void {
  boundedString(value.canonicalId, `${path}.canonicalId`, 256);
  boundedString(value.displaySymbol, `${path}.displaySymbol`, 256);
  boundedString(value.coin, `${path}.coin`, 256);
  nonNegativeInteger(value.universeIndex, `${path}.universeIndex`);
  nonNegativeInteger(value.orderAssetId, `${path}.orderAssetId`);
  if (value.lifecycle !== "active" && value.lifecycle !== "delisted") {
    invalid(`${path}.lifecycle`, "expected a supported lifecycle");
  }
  if (
    value.orderAvailability !== "enabled" &&
    value.orderAvailability !== "browse_only"
  ) {
    invalid(
      `${path}.orderAvailability`,
      "expected a supported order availability",
    );
  }
  stringArray(value.validationReasons, `${path}.validationReasons`, 64);
  parseContext(value, path);
}

function parseContext(value: Record<string, unknown>, path: string): void {
  for (const key of [
    "dayNtlVlm",
    "dayBaseVlm",
    "funding",
    "markPx",
    "openInterest",
    "oraclePx",
    "prevDayPx",
  ] as const) {
    if (value[key] !== undefined)
      parseDecimalString(value[key], `${path}.${key}`);
  }
  for (const key of ["midPx", "premium"] as const) {
    if (value[key] !== undefined) {
      parseNullableDecimalString(value[key], `${path}.${key}`);
    }
  }
  const impactPxs = value.impactPxs;
  if (impactPxs !== undefined && impactPxs !== null) {
    if (!Array.isArray(impactPxs) || impactPxs.length !== 2) {
      invalid(`${path}.impactPxs`, "expected exactly two prices");
    }
    parseDecimalString(impactPxs[0], `${path}.impactPxs[0]`);
    parseDecimalString(impactPxs[1], `${path}.impactPxs[1]`);
  }
}

function parseToken(value: unknown, path: string): void {
  const token = exactRecord(value, path, [
    "index",
    "tokenId",
    "name",
    "fullName",
    "sizeDecimals",
    "weiDecimals",
    "isCanonical",
    "evmContract",
  ]);
  nonNegativeInteger(token.index, `${path}.index`);
  boundedString(token.tokenId, `${path}.tokenId`, 256);
  boundedString(token.name, `${path}.name`, 256);
  nullableBoundedString(token.fullName, `${path}.fullName`, 256);
  nonNegativeInteger(token.sizeDecimals, `${path}.sizeDecimals`);
  nonNegativeInteger(token.weiDecimals, `${path}.weiDecimals`);
  boolean(token.isCanonical, `${path}.isCanonical`);
  parseTokenEvmContract(token.evmContract, `${path}.evmContract`);
}

function parseTokenEvmContract(value: unknown, path: string): void {
  if (value === null) return;
  const contract = exactRecord(value, path, ["address", "extraWeiDecimals"]);
  const address = boundedString(contract.address, `${path}.address`, 42);
  if (!/^0x[0-9a-f]{40}$/.test(address)) {
    invalid(`${path}.address`, "expected a lowercase 20-byte EVM address");
  }
  const extraWeiDecimals = safeInteger(
    contract.extraWeiDecimals,
    `${path}.extraWeiDecimals`,
  );
  if (extraWeiDecimals < -255 || extraWeiDecimals > 255) {
    invalid(
      `${path}.extraWeiDecimals`,
      "expected an integer between -255 and 255",
    );
  }
}

function parsePricePrecision(
  value: unknown,
  path: string,
  expectedDecimalPlaces: number,
): void {
  const precision = exactRecord(value, path, [
    "maxSignificantFigures",
    "maxDecimalPlaces",
  ]);
  if (
    precision.maxSignificantFigures !== 5 ||
    precision.maxDecimalPlaces !== expectedDecimalPlaces
  ) {
    invalid(path, "price precision does not match market size precision");
  }
}

function parseQuarantinedMarket(
  value: unknown,
  index: number,
): QuarantinedMarket {
  const path = `marketCatalogSnapshot.quarantined[${index}]`;
  const candidate = exactRecord(value, path, [
    "family",
    "canonicalId",
    "displaySymbol",
    "coin",
    "dexIndex",
    "dexName",
    "universeIndex",
    "orderAssetId",
    "lifecycle",
    "orderAvailability",
    "reasons",
  ]);
  if (
    candidate.family !== "perp" &&
    candidate.family !== "spot" &&
    candidate.family !== "outcome"
  ) {
    invalid(`${path}.family`, "expected a supported market family");
  }
  boundedString(candidate.canonicalId, `${path}.canonicalId`, 256);
  boundedString(candidate.displaySymbol, `${path}.displaySymbol`, 256);
  boundedString(candidate.coin, `${path}.coin`, 256);
  nullableNonNegativeInteger(candidate.dexIndex, `${path}.dexIndex`);
  nullableBoundedString(candidate.dexName, `${path}.dexName`, 128, true);
  nonNegativeInteger(candidate.universeIndex, `${path}.universeIndex`);
  nonNegativeInteger(candidate.orderAssetId, `${path}.orderAssetId`);
  if (candidate.lifecycle !== "active" && candidate.lifecycle !== "delisted") {
    invalid(`${path}.lifecycle`, "expected a supported lifecycle");
  }
  if (candidate.orderAvailability !== "browse_only") {
    invalid(`${path}.orderAvailability`, "expected browse_only");
  }
  stringArray(candidate.reasons, `${path}.reasons`, 64);
  return candidate as unknown as QuarantinedMarket;
}

function parseSourceError(value: unknown, index: number): CatalogSourceError {
  const path = `marketCatalogSnapshot.sourceErrors[${index}]`;
  const candidate = record(value, path);
  const keys = ["source", "message"];
  if (candidate.status !== undefined) keys.push("status");
  if (candidate.retryAfterMs !== undefined) keys.push("retryAfterMs");
  exactKeys(candidate, path, keys);
  const source = boundedString(candidate.source, `${path}.source`, 256);
  const message = boundedString(candidate.message, `${path}.message`, 1024);
  const status =
    candidate.status === undefined
      ? undefined
      : positiveInteger(candidate.status, `${path}.status`);
  if (status !== undefined && (status < 400 || status > 599)) {
    invalid(`${path}.status`, "expected an HTTP error status");
  }
  const retryAfterMs =
    candidate.retryAfterMs === undefined
      ? undefined
      : nonNegativeInteger(candidate.retryAfterMs, `${path}.retryAfterMs`);
  return {
    source,
    message,
    ...(status === undefined ? {} : { status }),
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  };
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid(path, "expected an object");
  }
  return value as Record<string, unknown>;
}

function exactRecord(
  value: unknown,
  path: string,
  keys: readonly string[],
): Record<string, unknown> {
  const candidate = record(value, path);
  exactKeys(candidate, path, keys);
  return candidate;
}

function exactKeys(
  value: Record<string, unknown>,
  path: string,
  keys: readonly string[],
): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].filter((key) => value[key] !== undefined).sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    invalid(path, "contains missing or unknown fields");
  }
}

function boundedArray(
  value: unknown,
  path: string,
  maximum: number,
): readonly unknown[] {
  if (!Array.isArray(value) || value.length > maximum) {
    invalid(path, `expected an array with at most ${maximum} entries`);
  }
  return value;
}

function boundedString(
  value: unknown,
  path: string,
  maximum: number,
  allowEmpty = false,
): string {
  if (
    typeof value !== "string" ||
    (!allowEmpty && value.length === 0) ||
    value.length > maximum
  ) {
    invalid(path, "expected a bounded string");
  }
  return value;
}

function nullableBoundedString(
  value: unknown,
  path: string,
  maximum: number,
  allowEmpty = false,
): string | null {
  return value === null
    ? null
    : boundedString(value, path, maximum, allowEmpty);
}

function stringArray(value: unknown, path: string, maximum: number): void {
  for (const [index, entry] of boundedArray(value, path, maximum).entries()) {
    boundedString(entry, `${path}[${index}]`, 1024);
  }
}

function positiveInteger(value: unknown, path: string): number {
  const parsed = nonNegativeInteger(value, path);
  if (parsed < 1) invalid(path, "expected a positive integer");
  return parsed;
}

function safeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value)) {
    invalid(path, "expected a safe integer");
  }
  return value as number;
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    invalid(path, "expected a non-negative safe integer");
  }
  return value as number;
}

function nullableNonNegativeInteger(
  value: unknown,
  path: string,
): number | null {
  return value === null ? null : nonNegativeInteger(value, path);
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") invalid(path, "expected a boolean");
  return value;
}

function literalNull(value: unknown, path: string): null {
  if (value !== null) invalid(path, "expected null");
  return null;
}

function invalid(path: string, message: string): never {
  throw new HyperliquidValidationError(path, message);
}
