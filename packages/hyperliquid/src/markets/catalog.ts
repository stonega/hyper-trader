import { HyperliquidApiError, HyperliquidValidationError } from "../errors";
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

const MAX_INCREMENTAL_BUILDER_DEXES = 37;

export type MarketCatalogRequestOptions = InfoRequestOptions &
  (
    | { readonly scope?: "complete" }
    | { readonly scope: "core" }
    | { readonly scope: "native" }
    | { readonly scope: "spot" }
    | {
        readonly scope: "incremental";
        readonly builderDexOffset: number;
        readonly builderDexLimit: number;
      }
  );

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

function signedInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new HyperliquidValidationError(path, "expected an integer");
  }
  return value as number;
}

function possiblyEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string") {
    throw new HyperliquidValidationError(path, "expected a string");
  }
  return value;
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
    evmContract: parseEvmContract(token.evmContract, `${path}.evmContract`),
  };
}

function parseEvmContract(
  value: unknown,
  path: string,
): TokenIdentity["evmContract"] {
  if (value === null || value === undefined) return null;
  const contract = record(value, path);
  const address = string(contract.address, `${path}.address`);
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new HyperliquidValidationError(
      `${path}.address`,
      "expected a 20-byte EVM address",
    );
  }
  const extraWeiDecimals = signedInteger(
    contract.evm_extra_wei_decimals,
    `${path}.evm_extra_wei_decimals`,
  );
  if (extraWeiDecimals < -255 || extraWeiDecimals > 255) {
    throw new HyperliquidValidationError(
      `${path}.evm_extra_wei_decimals`,
      "expected an integer between -255 and 255",
    );
  }
  return { address: address.toLowerCase(), extraWeiDecimals };
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
      const description = possiblyEmptyString(
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
    ...(reason instanceof HyperliquidApiError
      ? {
          status: reason.status,
          ...(reason.rateLimit?.retryAfterMs === undefined
            ? {}
            : { retryAfterMs: reason.rateLimit.retryAfterMs }),
        }
      : {}),
  };
}

const CATALOG_SOURCE_CONCURRENCY = 8;

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  throw (
    signal.reason ??
    new DOMException("Market catalog request was aborted.", "AbortError")
  );
}

async function settleCatalogSources<T>(
  tasks: readonly (() => Promise<T>)[],
  signal?: AbortSignal,
): Promise<PromiseSettledResult<T>[]> {
  const results = new Array<PromiseSettledResult<T>>(tasks.length);
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < tasks.length) {
      throwIfAborted(signal);
      const index = nextIndex;
      nextIndex += 1;
      const task = tasks[index];
      if (!task) return;
      try {
        results[index] = { status: "fulfilled", value: await task() };
      } catch (reason) {
        throwIfAborted(signal);
        results[index] = { status: "rejected", reason };
      }
    }
  };

  await Promise.all(
    Array.from(
      { length: Math.min(CATALOG_SOURCE_CONCURRENCY, tasks.length) },
      () => worker(),
    ),
  );
  return results;
}

export async function discoverMarketCatalog(
  transport: InfoHttpTransport,
  options: MarketCatalogRequestOptions = {},
): Promise<MarketCatalog> {
  throwIfAborted(options.signal);
  if (options.scope === "incremental") {
    if (
      !Number.isSafeInteger(options.builderDexOffset) ||
      options.builderDexOffset < 0
    ) {
      throw new HyperliquidValidationError(
        "marketCatalog.builderDexOffset",
        "expected a non-negative integer",
      );
    }
    if (
      !Number.isSafeInteger(options.builderDexLimit) ||
      options.builderDexLimit < 1 ||
      options.builderDexLimit > MAX_INCREMENTAL_BUILDER_DEXES
    ) {
      throw new HyperliquidValidationError(
        "marketCatalog.builderDexLimit",
        `expected an integer between 1 and ${MAX_INCREMENTAL_BUILDER_DEXES}`,
      );
    }
  }
  const sourceErrors: CatalogSourceError[] = [];
  const nativeDex: DexDescriptor = { index: 0, name: "", fullName: null };
  let dexes: readonly DexDescriptor[] = [nativeDex];
  if (
    options.scope !== "core" &&
    options.scope !== "native" &&
    options.scope !== "spot"
  ) {
    try {
      dexes = [
        nativeDex,
        ...parseDexs(await transport.request({ type: "perpDexs" }, options)),
      ];
    } catch (error) {
      throwIfAborted(options.signal);
      sourceErrors.push(sourceError("perpDexs", error));
    }
  }

  const builderDexes = (() => {
    if (
      options.scope === "core" ||
      options.scope === "native" ||
      options.scope === "spot"
    ) {
      return [];
    }
    if (options.scope !== "incremental") return dexes.slice(1);
    return dexes.slice(
      1 + options.builderDexOffset,
      1 + options.builderDexOffset + options.builderDexLimit,
    );
  })();

  const requests = [
    ...(options.scope === "spot"
      ? []
      : [
          {
            source: "metaAndAssetCtxs:native",
            kind: "perp" as const,
            dex: nativeDex,
            load: () =>
              transport.request(
                {
                  type: "metaAndAssetCtxs",
                },
                options,
              ),
          },
        ]),
    ...(options.scope === "native"
      ? []
      : [
          {
            source: "spotMetaAndAssetCtxs",
            kind: "spot" as const,
            dex: null,
            load: () =>
              transport.request({ type: "spotMetaAndAssetCtxs" }, options),
          },
          ...(transport.network === "testnet" && options.scope !== "spot"
            ? [
                {
                  source: "outcomeMeta",
                  kind: "outcome" as const,
                  dex: null,
                  load: () =>
                    transport.request({ type: "outcomeMeta" }, options),
                },
              ]
            : []),
        ]),
    ...builderDexes.map((dex) => ({
      source: `metaAndAssetCtxs:${dex.name || "native"}`,
      kind: "perp" as const,
      dex,
      load: () =>
        transport.request(
          {
            type: "metaAndAssetCtxs",
            dex: dex.name,
          },
          options,
        ),
    })),
  ];
  const settled = await settleCatalogSources(
    requests.map(({ load }) => load),
    options.signal,
  );
  throwIfAborted(options.signal);
  const perpetualMarkets: Market[] = [];
  const spotMarkets: Market[] = [];
  const outcomeMarkets: Market[] = [];
  const perpetualQuarantined: QuarantinedMarket[] = [];
  const spotQuarantined: QuarantinedMarket[] = [];

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
        perpetualMarkets.push(...parsed.markets);
        perpetualQuarantined.push(...parsed.quarantined);
      } else if (request.kind === "spot") {
        const parsed = parseSpotSource(result.value);
        spotMarkets.push(...parsed.markets);
        spotQuarantined.push(...parsed.quarantined);
      } else if (request.kind === "outcome") {
        outcomeMarkets.push(...parseOutcomeSource(result.value));
      }
    } catch (error) {
      sourceErrors.push(sourceError(request.source, error));
    }
  }

  return {
    markets: [...perpetualMarkets, ...spotMarkets, ...outcomeMarkets],
    quarantined: [...perpetualQuarantined, ...spotQuarantined],
    sourceErrors,
    ...(options.scope === "incremental"
      ? {
          builderPage: {
            offset: options.builderDexOffset,
            limit: options.builderDexLimit,
            total: Math.max(0, dexes.length - 1),
            dexes: builderDexes,
          },
        }
      : {}),
  };
}
