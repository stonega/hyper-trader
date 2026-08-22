import type {
  CatalogSourceError,
  Market,
  MarketCatalog,
  MarketCatalogBuilderDex,
  QuarantinedMarket,
} from "@hyper-trader/hyperliquid/public";

export interface PersistedCatalogPayload {
  readonly schemaVersion: 1;
  readonly markets: readonly Market[];
  readonly quarantined: readonly QuarantinedMarket[];
  readonly sourceErrors: Readonly<
    Record<string, CatalogSourceError | undefined>
  >;
}

const CORE_SOURCES = [
  { key: "perp:0", name: "metaAndAssetCtxs:native" },
  { key: "spot", name: "spotMetaAndAssetCtxs" },
  { key: "outcome", name: "outcomeMeta" },
] as const;

export function emptyCatalogPayload(): PersistedCatalogPayload {
  return {
    schemaVersion: 1,
    markets: [],
    quarantined: [],
    sourceErrors: {},
  };
}

export function catalogFromPayload(
  payload: PersistedCatalogPayload,
): MarketCatalog {
  return {
    markets: [...payload.markets].sort(compareMarket),
    quarantined: [...payload.quarantined].sort(compareQuarantined),
    sourceErrors: Object.entries(payload.sourceErrors)
      .sort(([left], [right]) => left.localeCompare(right))
      .flatMap(([, error]) => (error ? [error] : [])),
  };
}

export function mergeCoreCatalog(
  current: PersistedCatalogPayload,
  incoming: MarketCatalog,
): {
  readonly payload: PersistedCatalogPayload;
  readonly errors: readonly CatalogSourceError[];
} {
  let payload = current;
  const errors: CatalogSourceError[] = [];
  for (const source of CORE_SOURCES) {
    const error = incoming.sourceErrors.find(
      (candidate) => candidate.source === source.name,
    );
    if (error) errors.push(error);
    payload = mergeSource(payload, incoming, source.key, error);
  }
  return { payload: sortedPayload(payload), errors };
}

export function mergeBuilderCatalog(
  current: PersistedCatalogPayload,
  incoming: MarketCatalog,
): {
  readonly payload: PersistedCatalogPayload;
  readonly descriptorErrors: readonly CatalogSourceError[];
  readonly enumerationError?: CatalogSourceError;
} {
  const page = incoming.builderPage;
  if (!page) throw new Error("market catalog builder page is missing");
  let payload = current;
  const descriptorErrors: CatalogSourceError[] = [];
  for (const dex of page.dexes) {
    const sourceName = `metaAndAssetCtxs:${dex.name || "native"}`;
    const error = incoming.sourceErrors.find(
      (candidate) => candidate.source === sourceName,
    );
    if (error) descriptorErrors.push(error);
    payload = mergeSource(payload, incoming, sourceKeyForDex(dex), error);
  }
  const enumerationError = incoming.sourceErrors.find(
    (candidate) => candidate.source === "perpDexs",
  );
  payload = withSourceError(payload, "perp-dexs", enumerationError);
  return {
    payload: sortedPayload(payload),
    descriptorErrors,
    ...(enumerationError ? { enumerationError } : {}),
  };
}

export function pruneBuilderCatalog(
  payload: PersistedCatalogPayload,
  builderTotal: number,
): PersistedCatalogPayload {
  const keepRecord = (record: Market | QuarantinedMarket) =>
    record.family !== "perp" ||
    record.dexIndex === null ||
    record.dexIndex <= builderTotal;
  return sortedPayload({
    ...payload,
    markets: payload.markets.filter(keepRecord),
    quarantined: payload.quarantined.filter(keepRecord),
    sourceErrors: Object.fromEntries(
      Object.entries(payload.sourceErrors).filter(([key]) => {
        const match = /^perp:([0-9]+)$/.exec(key);
        return !match?.[1] || Number(match[1]) <= builderTotal;
      }),
    ),
  });
}

export function retainedBuilderTotal(payload: PersistedCatalogPayload): number {
  const recordIndexes = [...payload.markets, ...payload.quarantined].flatMap(
    (record) =>
      record.family === "perp" && (record.dexIndex ?? 0) > 0
        ? [record.dexIndex ?? 0]
        : [],
  );
  const errorIndexes = Object.keys(payload.sourceErrors).flatMap((key) => {
    const match = /^perp:([0-9]+)$/.exec(key);
    return match?.[1] ? [Number(match[1])] : [];
  });
  return Math.max(0, ...recordIndexes, ...errorIndexes);
}

function mergeSource(
  current: PersistedCatalogPayload,
  incoming: MarketCatalog,
  sourceKey: string,
  error: CatalogSourceError | undefined,
): PersistedCatalogPayload {
  if (error) return withSourceError(current, sourceKey, error);
  const incomingRecords = [...incoming.markets, ...incoming.quarantined].filter(
    (record) => sourceKeyForRecord(record) === sourceKey,
  );
  const currentMarkets = current.markets.filter(
    (record) => sourceKeyForRecord(record) !== sourceKey,
  );
  const currentQuarantined = current.quarantined.filter(
    (record) => sourceKeyForRecord(record) !== sourceKey,
  );
  return withSourceError(
    {
      ...current,
      markets: [
        ...currentMarkets,
        ...incomingRecords.filter(
          (record): record is Market => !("reasons" in record),
        ),
      ],
      quarantined: [
        ...currentQuarantined,
        ...incomingRecords.filter(
          (record): record is QuarantinedMarket => "reasons" in record,
        ),
      ],
    },
    sourceKey,
    undefined,
  );
}

function withSourceError(
  payload: PersistedCatalogPayload,
  sourceKey: string,
  error: CatalogSourceError | undefined,
): PersistedCatalogPayload {
  const sourceErrors = { ...payload.sourceErrors };
  if (error) sourceErrors[sourceKey] = sanitizedError(error);
  else delete sourceErrors[sourceKey];
  return { ...payload, sourceErrors };
}

function sanitizedError(error: CatalogSourceError): CatalogSourceError {
  return {
    source: error.source.slice(0, 256),
    message: error.message.slice(0, 1024) || "catalog source failed",
    ...(error.status !== undefined && error.status >= 400 && error.status <= 599
      ? { status: error.status }
      : {}),
    ...(error.retryAfterMs === undefined
      ? {}
      : { retryAfterMs: boundedDelay(error.retryAfterMs) }),
  };
}

function sourceKeyForRecord(record: Market | QuarantinedMarket): string {
  if (record.family === "perp") return `perp:${record.dexIndex ?? 0}`;
  return record.family;
}

function sourceKeyForDex(dex: MarketCatalogBuilderDex): string {
  return `perp:${dex.index}`;
}

function sortedPayload(
  payload: PersistedCatalogPayload,
): PersistedCatalogPayload {
  return {
    ...payload,
    markets: [...payload.markets].sort(compareMarket),
    quarantined: [...payload.quarantined].sort(compareQuarantined),
  };
}

function compareMarket(left: Market, right: Market): number {
  return compareRecord(left, right);
}

function compareQuarantined(
  left: QuarantinedMarket,
  right: QuarantinedMarket,
): number {
  return compareRecord(left, right);
}

function compareRecord(
  left: Market | QuarantinedMarket,
  right: Market | QuarantinedMarket,
): number {
  const family = familyOrder(left.family) - familyOrder(right.family);
  if (family !== 0) return family;
  const dex =
    (left.dexIndex ?? Number.MAX_SAFE_INTEGER) -
    (right.dexIndex ?? Number.MAX_SAFE_INTEGER);
  if (dex !== 0) return dex;
  return left.universeIndex - right.universeIndex;
}

function familyOrder(family: Market["family"]): number {
  if (family === "perp") return 0;
  if (family === "spot") return 1;
  return 2;
}

function boundedDelay(value: number): number {
  if (!Number.isFinite(value)) return 65_000;
  return Math.max(1_000, Math.min(86_400_000, Math.ceil(value)));
}
