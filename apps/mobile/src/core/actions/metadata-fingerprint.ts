import type {
  MarketFamily,
  MarketLifecycle,
  MarketOrderAvailability,
  PricePrecisionInputs,
} from "@hyper-trader/hyperliquid/public";

export interface MarketMetadataFingerprintInput {
  readonly canonicalId: string;
  readonly orderAssetId: number;
  readonly family: MarketFamily;
  readonly pricePrecision: PricePrecisionInputs | null;
  readonly sizeDecimals: number | null;
  readonly maxLeverage?: number | null;
  readonly onlyIsolated?: boolean | null;
  readonly marginMode?: string | null;
  readonly marginTableId?: number | null;
  readonly lifecycle: MarketLifecycle;
  readonly orderAvailability: MarketOrderAvailability;
}

export const MARKET_METADATA_FINGERPRINT_VERSION =
  "hyper-trader-market-safety-v1";

export function marketMetadataFingerprint(
  metadata: MarketMetadataFingerprintInput,
): string {
  const precision = metadata.pricePrecision;
  return JSON.stringify([
    MARKET_METADATA_FINGERPRINT_VERSION,
    metadata.canonicalId,
    metadata.orderAssetId,
    metadata.family,
    precision === null
      ? null
      : [precision.maxSignificantFigures, precision.maxDecimalPlaces],
    metadata.sizeDecimals,
    metadata.maxLeverage ?? null,
    metadata.onlyIsolated ?? null,
    metadata.marginMode ?? null,
    metadata.marginTableId ?? null,
    metadata.lifecycle,
    metadata.orderAvailability,
  ]);
}
