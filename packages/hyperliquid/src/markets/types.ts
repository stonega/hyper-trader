import type { DecimalString } from "../numbers/decimal";
import type { PricePrecisionInputs } from "../numbers/precision";

export type MarketFamily = "perp" | "spot" | "outcome";
export type MarketLifecycle = "active" | "delisted";
export type MarketOrderAvailability = "enabled" | "browse_only";

export interface MarketContext {
  readonly dayNtlVlm?: DecimalString;
  readonly dayBaseVlm?: DecimalString;
  readonly funding?: DecimalString;
  readonly impactPxs?: readonly [DecimalString, DecimalString] | null;
  readonly markPx?: DecimalString;
  readonly midPx?: DecimalString | null;
  readonly openInterest?: DecimalString;
  readonly oraclePx?: DecimalString;
  readonly premium?: DecimalString | null;
  readonly prevDayPx?: DecimalString;
}

export interface TokenIdentity {
  readonly index: number;
  readonly tokenId: string;
  readonly name: string;
  readonly fullName: string | null;
  readonly sizeDecimals: number;
  readonly weiDecimals: number;
  readonly isCanonical: boolean;
  readonly evmContract: string | null;
}

interface BaseMarket extends MarketContext {
  readonly family: MarketFamily;
  readonly canonicalId: string;
  readonly displaySymbol: string;
  readonly coin: string;
  readonly universeIndex: number;
  readonly orderAssetId: number;
  readonly lifecycle: MarketLifecycle;
  readonly orderAvailability: MarketOrderAvailability;
  readonly validationReasons: readonly string[];
}

export interface PerpMarket extends BaseMarket {
  readonly family: "perp";
  readonly dexIndex: number;
  readonly dexName: string;
  readonly dexFullName: string | null;
  readonly sizeDecimals: number;
  readonly pricePrecision: PricePrecisionInputs;
  readonly maxLeverage: number;
  readonly onlyIsolated: boolean;
  readonly marginMode: string | null;
  readonly marginTableId: number | null;
}

export interface SpotMarket extends BaseMarket {
  readonly family: "spot";
  readonly dexIndex: null;
  readonly dexName: null;
  readonly sizeDecimals: number;
  readonly pricePrecision: PricePrecisionInputs;
  readonly baseToken: TokenIdentity;
  readonly quoteToken: TokenIdentity;
  readonly isCanonical: boolean;
}

export interface OutcomeMarket extends BaseMarket {
  readonly family: "outcome";
  readonly dexIndex: null;
  readonly dexName: null;
  readonly outcome: number;
  readonly outcomeName: string;
  readonly description: string;
  readonly side: 0 | 1;
  readonly sideName: string;
  readonly encoding: number;
  readonly sizeDecimals: null;
  readonly pricePrecision: null;
}

export type Market = PerpMarket | SpotMarket | OutcomeMarket;

export interface QuarantinedMarket {
  readonly family: MarketFamily;
  readonly canonicalId: string;
  readonly displaySymbol: string;
  readonly coin: string;
  readonly dexIndex: number | null;
  readonly dexName: string | null;
  readonly universeIndex: number;
  readonly orderAssetId: number;
  readonly lifecycle: MarketLifecycle;
  readonly orderAvailability: "browse_only";
  readonly reasons: readonly string[];
}

export interface CatalogSourceError {
  readonly source: string;
  readonly message: string;
}

export interface MarketCatalog {
  readonly markets: readonly Market[];
  readonly quarantined: readonly QuarantinedMarket[];
  readonly sourceErrors: readonly CatalogSourceError[];
}
