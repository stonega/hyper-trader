import { HyperliquidValidationError } from "../errors";
import {
  parseDecimalString,
  parseNullableDecimalString,
} from "../numbers/decimal";
import { pricePrecisionForSizeDecimals } from "../numbers/precision";
import type { InfoHttpTransport, InfoRequestOptions } from "../transport/http";
import type {
  CatalogSourceError,
  Market,
  MarketCatalog,
  MarketContext,
  OutcomeMarket,
  PerpMarket,
  QuarantinedMarket,
  SpotMarket,
  TokenIdentity,
} from "./types";

interface DexDescriptor {
  readonly index: number;
  readonly name: string;
  readonly fullName: string | null;
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HyperliquidValidationError(path, "expected an object");
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new HyperliquidValidationError(path, "expected an array");
  }
  return value;
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new HyperliquidValidationError(path, "expected a non-empty string");
  }
  return value;
}

function integer(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new HyperliquidValidationError(
      path,
      "expected a non-negative integer",
    );
  }
  return value as number;
}

function optionalBoolean(value: unknown, path: string): boolean {
  if (value === undefined) {
    return false;
  }
  if (typeof value !== "boolean") {
    throw new HyperliquidValidationError(path, "expected a boolean");
  }
  return value;
}

function nullableString(value: unknown, path: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return string(value, path);
}

export function parseMarketContext(
  value: unknown,
  path: string,
): MarketContext {
  const source = record(value, path);
  const decimal = (key: string) =>
    source[key] === undefined
      ? undefined
      : parseDecimalString(source[key], `${path}.${key}`);
  const nullableDecimal = (key: string) =>
    source[key] === undefined
      ? undefined
      : parseNullableDecimalString(source[key], `${path}.${key}`);
  let impactPxs: readonly [string, string] | null | undefined;
  if (source.impactPxs === null) {
    impactPxs = null;
  } else if (source.impactPxs !== undefined) {
    const values = array(source.impactPxs, `${path}.impactPxs`);
    if (values.length !== 2) {
      throw new HyperliquidValidationError(
        `${path}.impactPxs`,
        "expected two prices",
      );
    }
    impactPxs = [
      parseDecimalString(values[0], `${path}.impactPxs[0]`),
      parseDecimalString(values[1], `${path}.impactPxs[1]`),
    ];
  }
  return {
    ...(decimal("dayNtlVlm") === undefined
      ? {}
      : { dayNtlVlm: decimal("dayNtlVlm") }),
    ...(decimal("dayBaseVlm") === undefined
      ? {}
      : { dayBaseVlm: decimal("dayBaseVlm") }),
    ...(decimal("funding") === undefined
      ? {}
      : { funding: decimal("funding") }),
    ...(impactPxs === undefined ? {} : { impactPxs }),
    ...(decimal("markPx") === undefined ? {} : { markPx: decimal("markPx") }),
    ...(nullableDecimal("midPx") === undefined
      ? {}
      : { midPx: nullableDecimal("midPx") }),
    ...(decimal("openInterest") === undefined
      ? {}
      : { openInterest: decimal("openInterest") }),
    ...(decimal("oraclePx") === undefined
      ? {}
      : { oraclePx: decimal("oraclePx") }),
    ...(nullableDecimal("premium") === undefined
      ? {}
      : { premium: nullableDecimal("premium") }),
    ...(decimal("prevDayPx") === undefined
      ? {}
      : { prevDayPx: decimal("prevDayPx") }),
  };
}

function parseDexs(payload: unknown): readonly DexDescriptor[] {
  const values = array(payload, "perpDexs");
  return values.flatMap((value, index) => {
    if (index === 0) {
      if (value !== null) {
        throw new HyperliquidValidationError(
          "perpDexs[0]",
          "expected the native DEX sentinel",
        );
      }
      return [];
    }
    const source = record(value, `perpDexs[${index}]`);
    return [
      {
        index,
        name: string(source.name, `perpDexs[${index}].name`),
        fullName: nullableString(
          source.fullName,
          `perpDexs[${index}].fullName`,
        ),
      },
    ];
  });
}

function quarantinePerp(
  dex: DexDescriptor,
  universeIndex: number,
  coin: string,
  reasons: readonly string[],
  delisted = false,
): QuarantinedMarket {
  return {
    family: "perp",
    canonicalId: `perp:${dex.index}:${universeIndex}`,
    displaySymbol: coin.includes(":")
      ? coin.slice(coin.indexOf(":") + 1)
      : coin,
    coin,
    dexIndex: dex.index,
    dexName: dex.name,
    universeIndex,
    orderAssetId:
      dex.index === 0
        ? universeIndex
        : 100_000 + dex.index * 10_000 + universeIndex,
    lifecycle: delisted ? "delisted" : "active",
    orderAvailability: "browse_only",
    reasons,
  };
}

function parsePerpSource(
  payload: unknown,
  dex: DexDescriptor,
): {
  readonly markets: PerpMarket[];
  readonly quarantined: QuarantinedMarket[];
} {
  const tuple = array(payload, `metaAndAssetCtxs(${dex.name})`);
  if (tuple.length !== 2) {
    throw new HyperliquidValidationError(
      `metaAndAssetCtxs(${dex.name})`,
      "expected metadata and contexts",
    );
  }
  const metadata = record(tuple[0], `metaAndAssetCtxs(${dex.name})[0]`);
  const universe = array(
    metadata.universe,
    `metaAndAssetCtxs(${dex.name}).universe`,
  );
  const contexts = array(tuple[1], `metaAndAssetCtxs(${dex.name})[1]`);
  const markets: PerpMarket[] = [];
  const quarantined: QuarantinedMarket[] = [];

  for (const [universeIndex, rawAsset] of universe.entries()) {
    let coin = `unknown:${universeIndex}`;
    try {
      const asset = record(rawAsset, `perp(${dex.name})[${universeIndex}]`);
      coin = string(asset.name, `perp(${dex.name})[${universeIndex}].name`);
      const sizeDecimals = integer(
        asset.szDecimals,
        `perp(${dex.name})[${universeIndex}].szDecimals`,
      );
      const pricePrecision = pricePrecisionForSizeDecimals(
        "perp",
        sizeDecimals,
      );
      const isDelisted = optionalBoolean(
        asset.isDelisted,
        `perp(${dex.name})[${universeIndex}].isDelisted`,
      );
      if (pricePrecision === null || isDelisted) {
        quarantined.push(
          quarantinePerp(
            dex,
            universeIndex,
            coin,
            [
              ...(pricePrecision === null ? ["invalid_sz_decimals"] : []),
              ...(isDelisted ? ["delisted"] : []),
            ],
            isDelisted,
          ),
        );
        continue;
      }
      if (contexts[universeIndex] === undefined) {
        quarantined.push(
          quarantinePerp(dex, universeIndex, coin, ["missing_asset_context"]),
        );
        continue;
      }
      const maxLeverage = integer(
        asset.maxLeverage,
        `perp(${dex.name})[${universeIndex}].maxLeverage`,
      );
      if (maxLeverage === 0) {
        quarantined.push(
          quarantinePerp(dex, universeIndex, coin, ["invalid_max_leverage"]),
        );
        continue;
      }
      const context = parseMarketContext(
        contexts[universeIndex],
        `perpContext(${dex.name})[${universeIndex}]`,
      );
      const onlyIsolated = optionalBoolean(
        asset.onlyIsolated,
        `perp(${dex.name})[${universeIndex}].onlyIsolated`,
      );
      markets.push({
        family: "perp",
        canonicalId: `perp:${dex.index}:${universeIndex}`,
        displaySymbol: coin.includes(":")
          ? coin.slice(coin.indexOf(":") + 1)
          : coin,
        coin,
        dexIndex: dex.index,
        dexName: dex.name,
        dexFullName: dex.fullName,
        universeIndex,
        orderAssetId:
          dex.index === 0
            ? universeIndex
            : 100_000 + dex.index * 10_000 + universeIndex,
        sizeDecimals,
        pricePrecision,
        maxLeverage,
        onlyIsolated,
        marginMode: nullableString(
          asset.marginMode,
          `perp(${dex.name})[${universeIndex}].marginMode`,
        ),
        marginTableId:
          asset.marginTableId === undefined
            ? null
            : integer(
                asset.marginTableId,
                `perp(${dex.name})[${universeIndex}].marginTableId`,
              ),
        lifecycle: "active",
        orderAvailability: "enabled",
        validationReasons: [],
        ...context,
      });
    } catch (error) {
      quarantined.push(
        quarantinePerp(dex, universeIndex, coin, [
          error instanceof Error ? error.message : "invalid_perp_metadata",
        ]),
      );
    }
  }
  return { markets, quarantined };
}

function parseToken(value: unknown, path: string): TokenIdentity {
  const token = record(value, path);
  return {
    index: integer(token.index, `${path}.index`),
    tokenId: string(token.tokenId, `${path}.tokenId`),
    name: string(token.name, `${path}.name`),
    fullName: nullableString(token.fullName, `${path}.fullName`),
    sizeDecimals: integer(token.szDecimals, `${path}.szDecimals`),
    weiDecimals: integer(token.weiDecimals, `${path}.weiDecimals`),
    isCanonical: optionalBoolean(token.isCanonical, `${path}.isCanonical`),
    evmContract: nullableString(token.evmContract, `${path}.evmContract`),
  };
}

function parseSpotSource(payload: unknown): {
  readonly markets: SpotMarket[];
  readonly quarantined: QuarantinedMarket[];
} {
  const tuple = array(payload, "spotMetaAndAssetCtxs");
  if (tuple.length !== 2) {
    throw new HyperliquidValidationError(
      "spotMetaAndAssetCtxs",
      "expected metadata and contexts",
    );
  }
  const metadata = record(tuple[0], "spotMetaAndAssetCtxs[0]");
  const tokens = new Map<number, TokenIdentity>();
  for (const [index, value] of array(
    metadata.tokens,
    "spotMeta.tokens",
  ).entries()) {
    const token = parseToken(value, `spotMeta.tokens[${index}]`);
    tokens.set(token.index, token);
  }
  const universe = array(metadata.universe, "spotMeta.universe");
  const contexts = array(tuple[1], "spotMetaAndAssetCtxs[1]");
  const markets: SpotMarket[] = [];
  const quarantined: QuarantinedMarket[] = [];

  for (const [fallbackIndex, rawMarket] of universe.entries()) {
    let universeIndex = fallbackIndex;
    let coin = `@${fallbackIndex}`;
    try {
      const source = record(rawMarket, `spotMeta.universe[${fallbackIndex}]`);
      universeIndex = integer(
        source.index,
        `spotMeta.universe[${fallbackIndex}].index`,
      );
      coin = string(source.name, `spotMeta.universe[${fallbackIndex}].name`);
      const tokenIndexes = array(
        source.tokens,
        `spotMeta.universe[${fallbackIndex}].tokens`,
      );
      if (tokenIndexes.length !== 2) {
        throw new HyperliquidValidationError(
          `spotMeta.universe[${fallbackIndex}].tokens`,
          "expected base and quote token indexes",
        );
      }
      const baseToken = tokens.get(integer(tokenIndexes[0], "spot base token"));
      const quoteToken = tokens.get(
        integer(tokenIndexes[1], "spot quote token"),
      );
      if (!baseToken || !quoteToken) {
        throw new HyperliquidValidationError(
          `spotMeta.universe[${fallbackIndex}].tokens`,
          "references an unknown token",
        );
      }
      const pricePrecision = pricePrecisionForSizeDecimals(
        "spot",
        baseToken.sizeDecimals,
      );
      if (pricePrecision === null) {
        throw new HyperliquidValidationError(
          `spotMeta.universe[${fallbackIndex}]`,
          "invalid_sz_decimals",
        );
      }
      if (contexts[fallbackIndex] === undefined) {
        throw new HyperliquidValidationError(
          `spotContext[${fallbackIndex}]`,
          "missing_asset_context",
        );
      }
      markets.push({
        family: "spot",
        canonicalId: `spot:${universeIndex}`,
        displaySymbol: baseToken.name,
        coin,
        dexIndex: null,
        dexName: null,
        universeIndex,
        orderAssetId: 10_000 + universeIndex,
        sizeDecimals: baseToken.sizeDecimals,
        pricePrecision,
        baseToken,
        quoteToken,
        isCanonical: optionalBoolean(
          source.isCanonical,
          `spotMeta.universe[${fallbackIndex}].isCanonical`,
        ),
        lifecycle: "active",
        orderAvailability: "enabled",
        validationReasons: [],
        ...parseMarketContext(
          contexts[fallbackIndex],
          `spotContext[${fallbackIndex}]`,
        ),
      });
    } catch (error) {
      quarantined.push({
        family: "spot",
        canonicalId: `spot:${universeIndex}`,
        displaySymbol: coin,
        coin,
        dexIndex: null,
        dexName: null,
        universeIndex,
        orderAssetId: 10_000 + universeIndex,
        lifecycle: "active",
        orderAvailability: "browse_only",
        reasons: [
          error instanceof Error ? error.message : "invalid_spot_metadata",
        ],
      });
    }
  }
  return { markets, quarantined };
}

function parseOutcomeSource(payload: unknown): readonly OutcomeMarket[] {
  const source = record(payload, "outcomeMeta");
  return array(source.outcomes, "outcomeMeta.outcomes").flatMap(
    (rawOutcome, outcomeIndex) => {
      const outcome = record(
        rawOutcome,
        `outcomeMeta.outcomes[${outcomeIndex}]`,
      );
      const outcomeId = integer(
        outcome.outcome,
        `outcomeMeta.outcomes[${outcomeIndex}].outcome`,
      );
      const outcomeName = string(
        outcome.name,
        `outcomeMeta.outcomes[${outcomeIndex}].name`,
      );
      const description = string(
        outcome.description,
        `outcomeMeta.outcomes[${outcomeIndex}].description`,
      );
      const sides = array(
        outcome.sideSpecs,
        `outcomeMeta.outcomes[${outcomeIndex}].sideSpecs`,
      );
      if (sides.length !== 2) {
        throw new HyperliquidValidationError(
          `outcomeMeta.outcomes[${outcomeIndex}].sideSpecs`,
          "expected exactly two sides",
        );
      }
      return ([0, 1] as const).map((side) => {
        const sideSpec = record(
          sides[side],
          `outcomeMeta.outcomes[${outcomeIndex}].sideSpecs[${side}]`,
        );
        const encoding = 10 * outcomeId + side;
        return {
          family: "outcome",
          canonicalId: `outcome:${outcomeId}:${side}`,
          displaySymbol: string(
            sideSpec.name,
            `outcomeMeta.outcomes[${outcomeIndex}].sideSpecs[${side}].name`,
          ),
          coin: `#${encoding}`,
          dexIndex: null,
          dexName: null,
          universeIndex: encoding,
          orderAssetId: 100_000_000 + encoding,
          lifecycle: "active",
          orderAvailability: "browse_only",
          validationReasons: ["precision_not_provided_by_outcome_metadata"],
          outcome: outcomeId,
          outcomeName,
          description,
          side,
          sideName: string(
            sideSpec.name,
            `outcomeMeta.outcomes[${outcomeIndex}].sideSpecs[${side}].name`,
          ),
          encoding,
          sizeDecimals: null,
          pricePrecision: null,
        } satisfies OutcomeMarket;
      });
    },
  );
}

function sourceError(source: string, reason: unknown): CatalogSourceError {
  return {
    source,
    message: reason instanceof Error ? reason.message : String(reason),
  };
}

export async function discoverMarketCatalog(
  transport: InfoHttpTransport,
  options: InfoRequestOptions = {},
): Promise<MarketCatalog> {
  const sourceErrors: CatalogSourceError[] = [];
  const nativeDex: DexDescriptor = { index: 0, name: "", fullName: null };
  let dexes: readonly DexDescriptor[] = [nativeDex];
  try {
    dexes = [
      nativeDex,
      ...parseDexs(await transport.request({ type: "perpDexs" }, options)),
    ];
  } catch (error) {
    sourceErrors.push(sourceError("perpDexs", error));
  }

  const requests = [
    ...dexes.map((dex) => ({
      source: `metaAndAssetCtxs:${dex.name || "native"}`,
      kind: "perp" as const,
      dex,
      promise: transport.request(
        {
          type: "metaAndAssetCtxs",
          ...(dex.name === "" ? {} : { dex: dex.name }),
        },
        options,
      ),
    })),
    {
      source: "spotMetaAndAssetCtxs",
      kind: "spot" as const,
      dex: null,
      promise: transport.request({ type: "spotMetaAndAssetCtxs" }, options),
    },
    ...(transport.network === "testnet"
      ? [
          {
            source: "outcomeMeta",
            kind: "outcome" as const,
            dex: null,
            promise: transport.request({ type: "outcomeMeta" }, options),
          },
        ]
      : []),
  ];
  const settled = await Promise.allSettled(
    requests.map(({ promise }) => promise),
  );
  const markets: Market[] = [];
  const quarantined: QuarantinedMarket[] = [];

  for (const [index, result] of settled.entries()) {
    const request = requests[index];
    if (!request) {
      continue;
    }
    if (result.status === "rejected") {
      sourceErrors.push(sourceError(request.source, result.reason));
      continue;
    }
    try {
      if (request.kind === "perp" && request.dex) {
        const parsed = parsePerpSource(result.value, request.dex);
        markets.push(...parsed.markets);
        quarantined.push(...parsed.quarantined);
      } else if (request.kind === "spot") {
        const parsed = parseSpotSource(result.value);
        markets.push(...parsed.markets);
        quarantined.push(...parsed.quarantined);
      } else if (request.kind === "outcome") {
        markets.push(...parseOutcomeSource(result.value));
      }
    } catch (error) {
      sourceErrors.push(sourceError(request.source, error));
    }
  }

  return { markets, quarantined, sourceErrors };
}
