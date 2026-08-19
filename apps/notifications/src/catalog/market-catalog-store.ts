import type {
  CatalogSourceError,
  HyperliquidNetwork,
  Market,
  MarketCatalog,
  MarketCatalogBuilderDex,
  QuarantinedMarket,
} from "@hyper-trader/hyperliquid/public";
import type { SQL } from "bun";

const SYNC_LEASE_MS = 120_000;
const PAGE_INTERVAL_MS = 65_000;
const GENERATION_INTERVAL_MS = 5 * 60_000;
const MAX_PAGE_FAILURES = 3;

const CORE_SOURCES = [
  { key: "perp:0", name: "metaAndAssetCtxs:native" },
  { key: "spot", name: "spotMetaAndAssetCtxs" },
  { key: "outcome", name: "outcomeMeta" },
] as const;

export interface MarketCatalogSyncLease {
  readonly network: HyperliquidNetwork;
  readonly ownerId: string;
  readonly leaseGeneration: number;
  readonly buildingGeneration: number;
  readonly publishedGeneration: number | null;
  readonly coreReady: boolean;
  readonly nextBuilderOffset: number;
  readonly builderTotal: number | null;
  readonly pageFailures: number;
}

export interface PublishedMarketCatalog {
  readonly network: HyperliquidNetwork;
  readonly generation: number;
  readonly publishedAtMs: number;
  readonly catalog: MarketCatalog;
}

interface SyncStateRow {
  readonly network: HyperliquidNetwork;
  readonly published_generation: string | number | null;
  readonly building_generation: string | number | null;
  readonly core_ready: boolean;
  readonly next_builder_offset: number;
  readonly builder_total: number | null;
  readonly page_failures: number;
  readonly lease_generation: number;
}

interface RecordRow {
  readonly record_kind: "market" | "quarantined";
  readonly payload: unknown;
}

interface ErrorRow {
  readonly source_name: string;
  readonly error_message: string;
  readonly status: number | null;
  readonly retry_after_ms: number | null;
}

export class PostgresMarketCatalogStore {
  readonly #sql: SQL;

  constructor(sql: SQL) {
    this.#sql = sql;
  }

  async claimDueSync(
    network: HyperliquidNetwork,
    ownerId: string,
  ): Promise<MarketCatalogSyncLease | null> {
    validateOwnerId(ownerId);
    return this.#sql.begin(async (transaction) => {
      await transaction`
        INSERT INTO market_catalog_sync_state (network)
        VALUES (${network})
        ON CONFLICT (network) DO NOTHING
      `;
      const claimed = await transaction<SyncStateRow[]>`
        UPDATE market_catalog_sync_state
        SET lease_owner = ${ownerId},
            lease_generation = lease_generation + 1,
            lease_expires_at = clock_timestamp() +
              (${SYNC_LEASE_MS} * interval '1 millisecond'),
            updated_at = clock_timestamp()
        WHERE network = ${network}
          AND next_attempt_at <= clock_timestamp()
          AND (lease_owner IS NULL OR lease_expires_at <= clock_timestamp())
        RETURNING network, published_generation, building_generation,
                  core_ready, next_builder_offset, builder_total,
                  page_failures, lease_generation
      `;
      const claimedRow = claimed[0];
      if (!claimedRow) return null;

      if (claimedRow.building_generation !== null) {
        return leaseFromRow(claimedRow, ownerId);
      }

      const publishedGeneration = nullableSafeInteger(
        claimedRow.published_generation,
        "published generation",
      );
      const buildingGeneration = (publishedGeneration ?? 0) + 1;
      await transaction`
        INSERT INTO market_catalog_generations (network, generation, state)
        VALUES (${network}, ${buildingGeneration}, 'building')
      `;
      if (publishedGeneration !== null) {
        await transaction`
          INSERT INTO market_catalog_records (
            network, generation, source_key, dex_index,
            record_kind, canonical_id, payload
          )
          SELECT network, ${buildingGeneration}, source_key, dex_index,
                 record_kind, canonical_id, payload
          FROM market_catalog_records
          WHERE network = ${network} AND generation = ${publishedGeneration}
        `;
        await transaction`
          INSERT INTO market_catalog_source_errors (
            network, generation, source_key, source_name,
            error_message, status, retry_after_ms
          )
          SELECT network, ${buildingGeneration}, source_key, source_name,
                 error_message, status, retry_after_ms
          FROM market_catalog_source_errors
          WHERE network = ${network} AND generation = ${publishedGeneration}
        `;
      }
      const initialized = await transaction<SyncStateRow[]>`
        UPDATE market_catalog_sync_state
        SET building_generation = ${buildingGeneration},
            core_ready = false,
            next_builder_offset = 0,
            builder_total = NULL,
            page_failures = 0,
            updated_at = clock_timestamp()
        WHERE network = ${network}
          AND lease_owner = ${ownerId}
          AND lease_generation = ${claimedRow.lease_generation}
        RETURNING network, published_generation, building_generation,
                  core_ready, next_builder_offset, builder_total,
                  page_failures, lease_generation
      `;
      const initializedRow = initialized[0];
      if (!initializedRow)
        throw new Error("market catalog sync lease was lost");
      return leaseFromRow(initializedRow, ownerId);
    });
  }

  async completeCore(
    lease: MarketCatalogSyncLease,
    catalog: MarketCatalog,
  ): Promise<void> {
    await this.#sql.begin(async (transaction) => {
      const state = await lockLease(transaction, lease);
      const errors = new Map(
        catalog.sourceErrors.map((error) => [error.source, error] as const),
      );
      for (const source of CORE_SOURCES) {
        const error = errors.get(source.name);
        if (error) {
          await upsertSourceError(transaction, lease, source.key, error);
          continue;
        }
        await replaceSourceRecords(
          transaction,
          lease,
          source.key,
          recordsForSource(catalog, source.key),
        );
      }

      const coreErrors = CORE_SOURCES.flatMap((source) => {
        const error = errors.get(source.name);
        return error ? [error] : [];
      });
      const nextFailureCount = state.page_failures + 1;
      const coreReady =
        coreErrors.length === 0 || nextFailureCount >= MAX_PAGE_FAILURES;
      const nextAttemptMs = coreReady
        ? PAGE_INTERVAL_MS
        : retryDelay(coreErrors, nextFailureCount);
      await updateClaimedState(transaction, lease, {
        coreReady,
        pageFailures: coreReady ? 0 : nextFailureCount,
        nextAttemptMs,
      });
    });
  }

  async completeBuilderPage(
    lease: MarketCatalogSyncLease,
    catalog: MarketCatalog,
  ): Promise<{ readonly published: boolean }> {
    const page = catalog.builderPage;
    if (!page || page.offset !== lease.nextBuilderOffset) {
      throw new Error("market catalog builder page does not match sync state");
    }
    if (page.total > page.offset && page.dexes.length === 0) {
      throw new Error("market catalog builder page made no progress");
    }

    return this.#sql.begin(async (transaction) => {
      const state = await lockLease(transaction, lease);
      const errors = new Map(
        catalog.sourceErrors.map((error) => [error.source, error] as const),
      );
      const descriptorErrors: CatalogSourceError[] = [];
      const enumerationError = errors.get("perpDexs");
      if (enumerationError) descriptorErrors.push(enumerationError);

      for (const dex of page.dexes) {
        const sourceName = `metaAndAssetCtxs:${dex.name || "native"}`;
        const error = errors.get(sourceName);
        if (error) {
          descriptorErrors.push(error);
          await upsertSourceError(
            transaction,
            lease,
            sourceKeyForBuilderDex(dex),
            error,
          );
          continue;
        }
        await replaceSourceRecords(
          transaction,
          lease,
          sourceKeyForBuilderDex(dex),
          recordsForBuilderDex(catalog, dex),
        );
      }

      if (enumerationError) {
        await upsertSourceError(
          transaction,
          lease,
          "perp-dexs",
          enumerationError,
        );
      } else {
        await transaction`
          DELETE FROM market_catalog_source_errors
          WHERE network = ${lease.network}
            AND generation = ${lease.buildingGeneration}
            AND source_key = 'perp-dexs'
        `;
      }

      const nextFailureCount = state.page_failures + 1;
      const advance =
        descriptorErrors.length === 0 || nextFailureCount >= MAX_PAGE_FAILURES;
      if (!advance) {
        await updateClaimedState(transaction, lease, {
          coreReady: true,
          pageFailures: nextFailureCount,
          builderTotal: page.total,
          nextAttemptMs: retryDelay(descriptorErrors, nextFailureCount),
        });
        return { published: false };
      }

      const nextOffset = Math.min(page.total, page.offset + page.dexes.length);
      if (nextOffset < page.total) {
        await updateClaimedState(transaction, lease, {
          coreReady: true,
          pageFailures: 0,
          builderTotal: page.total,
          nextBuilderOffset: nextOffset,
          nextAttemptMs: PAGE_INTERVAL_MS,
        });
        return { published: false };
      }

      const completedBuilderTotal =
        enumerationError && lease.publishedGeneration !== null
          ? await retainedBuilderTotal(transaction, lease)
          : page.total;
      await publishGeneration(transaction, lease, completedBuilderTotal);
      return { published: true };
    });
  }

  async recordFailure(
    lease: MarketCatalogSyncLease,
    retryAfterMs?: number,
  ): Promise<void> {
    const delay = boundedRetryDelay(retryAfterMs ?? PAGE_INTERVAL_MS);
    await this.#sql`
      UPDATE market_catalog_sync_state
      SET lease_owner = NULL,
          lease_expires_at = NULL,
          next_attempt_at = clock_timestamp() +
            (${delay} * interval '1 millisecond'),
          updated_at = clock_timestamp()
      WHERE network = ${lease.network}
        AND lease_owner = ${lease.ownerId}
        AND lease_generation = ${lease.leaseGeneration}
        AND building_generation = ${lease.buildingGeneration}
    `;
  }

  async readPublished(
    network: HyperliquidNetwork,
  ): Promise<PublishedMarketCatalog | null> {
    const states = await this.#sql<
      {
        readonly generation: string | number;
        readonly published_at_ms: string | number;
      }[]
    >`
      SELECT state.published_generation AS generation,
             floor(extract(epoch FROM generation.published_at) * 1000)::bigint
               AS published_at_ms
      FROM market_catalog_sync_state AS state
      JOIN market_catalog_generations AS generation
        ON generation.network = state.network
       AND generation.generation = state.published_generation
      WHERE state.network = ${network}
    `;
    const state = states[0];
    if (!state) return null;
    const generation = safeInteger(state.generation, "catalog generation");
    const [records, errors] = await Promise.all([
      this.#sql<RecordRow[]>`
        SELECT record_kind, payload
        FROM market_catalog_records
        WHERE network = ${network} AND generation = ${generation}
      `,
      this.#sql<ErrorRow[]>`
        SELECT source_name, error_message, status, retry_after_ms
        FROM market_catalog_source_errors
        WHERE network = ${network} AND generation = ${generation}
        ORDER BY source_key
      `,
    ]);
    const markets = records
      .filter((row) => row.record_kind === "market")
      .map((row) => row.payload as Market)
      .sort(compareMarket);
    const quarantined = records
      .filter((row) => row.record_kind === "quarantined")
      .map((row) => row.payload as QuarantinedMarket)
      .sort(compareCatalogRecord);
    return {
      network,
      generation,
      publishedAtMs: safeInteger(state.published_at_ms, "published timestamp"),
      catalog: {
        markets,
        quarantined,
        sourceErrors: errors.map((row) => ({
          source: row.source_name,
          message: row.error_message,
          ...(row.status === null ? {} : { status: row.status }),
          ...(row.retry_after_ms === null
            ? {}
            : { retryAfterMs: row.retry_after_ms }),
        })),
      },
    };
  }
}

async function lockLease(
  sql: SQL,
  lease: MarketCatalogSyncLease,
): Promise<SyncStateRow> {
  const rows = await sql<SyncStateRow[]>`
    SELECT network, published_generation, building_generation,
           core_ready, next_builder_offset, builder_total,
           page_failures, lease_generation
    FROM market_catalog_sync_state
    WHERE network = ${lease.network}
      AND lease_owner = ${lease.ownerId}
      AND lease_generation = ${lease.leaseGeneration}
      AND building_generation = ${lease.buildingGeneration}
      AND lease_expires_at > clock_timestamp()
    FOR UPDATE
  `;
  const row = rows[0];
  if (!row) throw new Error("market catalog sync lease was lost");
  return row;
}

async function replaceSourceRecords(
  sql: SQL,
  lease: MarketCatalogSyncLease,
  sourceKey: string,
  records: readonly (Market | QuarantinedMarket)[],
): Promise<void> {
  await sql`
    DELETE FROM market_catalog_records
    WHERE network = ${lease.network}
      AND generation = ${lease.buildingGeneration}
      AND source_key = ${sourceKey}
  `;
  await sql`
    DELETE FROM market_catalog_source_errors
    WHERE network = ${lease.network}
      AND generation = ${lease.buildingGeneration}
      AND source_key = ${sourceKey}
  `;
  for (const record of records) {
    const dexIndex = record.dexIndex;
    const recordKind = "reasons" in record ? "quarantined" : "market";
    await sql`
      INSERT INTO market_catalog_records (
        network, generation, source_key, dex_index,
        record_kind, canonical_id, payload
      ) VALUES (
        ${lease.network}, ${lease.buildingGeneration}, ${sourceKey},
        ${dexIndex}, ${recordKind}, ${record.canonicalId},
        ${record as unknown as Record<string, unknown>}::jsonb
      )
    `;
  }
}

async function upsertSourceError(
  sql: SQL,
  lease: MarketCatalogSyncLease,
  sourceKey: string,
  error: CatalogSourceError,
): Promise<void> {
  const message = error.message.slice(0, 1024) || "catalog source failed";
  const status =
    error.status !== undefined && error.status >= 400 && error.status <= 599
      ? error.status
      : null;
  const retryAfterMs =
    error.retryAfterMs === undefined
      ? null
      : boundedRetryDelay(error.retryAfterMs);
  await sql`
    INSERT INTO market_catalog_source_errors (
      network, generation, source_key, source_name,
      error_message, status, retry_after_ms
    ) VALUES (
      ${lease.network}, ${lease.buildingGeneration}, ${sourceKey},
      ${error.source.slice(0, 256)}, ${message}, ${status}, ${retryAfterMs}
    )
    ON CONFLICT (network, generation, source_key) DO UPDATE
    SET source_name = EXCLUDED.source_name,
        error_message = EXCLUDED.error_message,
        status = EXCLUDED.status,
        retry_after_ms = EXCLUDED.retry_after_ms
  `;
}

async function updateClaimedState(
  sql: SQL,
  lease: MarketCatalogSyncLease,
  update: {
    readonly coreReady: boolean;
    readonly pageFailures: number;
    readonly nextAttemptMs: number;
    readonly nextBuilderOffset?: number;
    readonly builderTotal?: number;
  },
): Promise<void> {
  const rows = await sql<{ readonly network: string }[]>`
    UPDATE market_catalog_sync_state
    SET core_ready = ${update.coreReady},
        page_failures = ${update.pageFailures},
        next_builder_offset = ${update.nextBuilderOffset ?? lease.nextBuilderOffset},
        builder_total = ${update.builderTotal ?? lease.builderTotal},
        next_attempt_at = clock_timestamp() +
          (${boundedRetryDelay(update.nextAttemptMs)} * interval '1 millisecond'),
        lease_owner = NULL,
        lease_expires_at = NULL,
        updated_at = clock_timestamp()
    WHERE network = ${lease.network}
      AND lease_owner = ${lease.ownerId}
      AND lease_generation = ${lease.leaseGeneration}
      AND building_generation = ${lease.buildingGeneration}
    RETURNING network
  `;
  if (rows.length !== 1) throw new Error("market catalog sync lease was lost");
}

async function publishGeneration(
  sql: SQL,
  lease: MarketCatalogSyncLease,
  builderTotal: number,
): Promise<void> {
  await sql`
    DELETE FROM market_catalog_records
    WHERE network = ${lease.network}
      AND generation = ${lease.buildingGeneration}
      AND dex_index > ${builderTotal}
  `;
  await sql`
    DELETE FROM market_catalog_source_errors
    WHERE network = ${lease.network}
      AND generation = ${lease.buildingGeneration}
      AND source_key ~ '^perp:[0-9]+$'
      AND split_part(source_key, ':', 2)::integer > ${builderTotal}
  `;
  if (lease.publishedGeneration !== null) {
    await sql`
      UPDATE market_catalog_generations
      SET state = 'retired', published_at = NULL
      WHERE network = ${lease.network}
        AND generation = ${lease.publishedGeneration}
        AND state = 'published'
    `;
  }
  const published = await sql<{ readonly generation: string | number }[]>`
    UPDATE market_catalog_generations
    SET state = 'published', published_at = clock_timestamp()
    WHERE network = ${lease.network}
      AND generation = ${lease.buildingGeneration}
      AND state = 'building'
    RETURNING generation
  `;
  if (published.length !== 1) {
    throw new Error("market catalog building generation is unavailable");
  }
  const updated = await sql<{ readonly network: string }[]>`
    UPDATE market_catalog_sync_state
    SET published_generation = ${lease.buildingGeneration},
        building_generation = NULL,
        core_ready = false,
        next_builder_offset = 0,
        builder_total = NULL,
        page_failures = 0,
        next_attempt_at = clock_timestamp() +
          (${GENERATION_INTERVAL_MS} * interval '1 millisecond'),
        lease_owner = NULL,
        lease_expires_at = NULL,
        updated_at = clock_timestamp(),
        published_at = clock_timestamp()
    WHERE network = ${lease.network}
      AND lease_owner = ${lease.ownerId}
      AND lease_generation = ${lease.leaseGeneration}
      AND building_generation = ${lease.buildingGeneration}
    RETURNING network
  `;
  if (updated.length !== 1)
    throw new Error("market catalog sync lease was lost");
  await sql`
    DELETE FROM market_catalog_generations
    WHERE network = ${lease.network}
      AND state = 'retired'
      AND generation < ${Math.max(1, lease.buildingGeneration - 1)}
  `;
}

async function retainedBuilderTotal(
  sql: SQL,
  lease: MarketCatalogSyncLease,
): Promise<number> {
  const rows = await sql<{ readonly builder_total: string | number }[]>`
    SELECT coalesce(max(builder_index), 0)::bigint AS builder_total
    FROM (
      SELECT dex_index AS builder_index
      FROM market_catalog_records
      WHERE network = ${lease.network}
        AND generation = ${lease.buildingGeneration}
        AND dex_index > 0
      UNION ALL
      SELECT split_part(source_key, ':', 2)::integer AS builder_index
      FROM market_catalog_source_errors
      WHERE network = ${lease.network}
        AND generation = ${lease.buildingGeneration}
        AND source_key ~ '^perp:[0-9]+$'
    ) AS retained_builder_sources
  `;
  return safeInteger(rows[0]?.builder_total ?? 0, "retained builder total");
}

function recordsForSource(
  catalog: MarketCatalog,
  sourceKey: string,
): readonly (Market | QuarantinedMarket)[] {
  return [...catalog.markets, ...catalog.quarantined].filter(
    (record) => sourceKeyForRecord(record) === sourceKey,
  );
}

function recordsForBuilderDex(
  catalog: MarketCatalog,
  dex: MarketCatalogBuilderDex,
): readonly (Market | QuarantinedMarket)[] {
  return [...catalog.markets, ...catalog.quarantined].filter(
    (record) => record.family === "perp" && record.dexIndex === dex.index,
  );
}

function sourceKeyForRecord(record: Market | QuarantinedMarket): string {
  if (record.family === "perp") return `perp:${record.dexIndex ?? 0}`;
  return record.family;
}

function sourceKeyForBuilderDex(dex: MarketCatalogBuilderDex): string {
  return `perp:${dex.index}`;
}

function retryDelay(
  errors: readonly CatalogSourceError[],
  failureCount: number,
): number {
  const upstream = Math.max(
    0,
    ...errors.map((error) => error.retryAfterMs ?? 0),
  );
  const exponential = Math.min(
    GENERATION_INTERVAL_MS,
    5_000 * 2 ** Math.max(0, failureCount - 1),
  );
  return boundedRetryDelay(Math.max(upstream, exponential));
}

function boundedRetryDelay(value: number): number {
  if (!Number.isFinite(value)) return PAGE_INTERVAL_MS;
  return Math.max(1_000, Math.min(86_400_000, Math.ceil(value)));
}

function leaseFromRow(
  row: SyncStateRow,
  ownerId: string,
): MarketCatalogSyncLease {
  const buildingGeneration = nullableSafeInteger(
    row.building_generation,
    "building generation",
  );
  if (buildingGeneration === null) {
    throw new Error("market catalog building generation is unavailable");
  }
  return {
    network: row.network,
    ownerId,
    leaseGeneration: safeInteger(row.lease_generation, "lease generation"),
    buildingGeneration,
    publishedGeneration: nullableSafeInteger(
      row.published_generation,
      "published generation",
    ),
    coreReady: row.core_ready,
    nextBuilderOffset: safeInteger(
      row.next_builder_offset,
      "next builder offset",
    ),
    builderTotal:
      row.builder_total === null
        ? null
        : safeInteger(row.builder_total, "builder total"),
    pageFailures: safeInteger(row.page_failures, "page failures"),
  };
}

function safeInteger(value: string | number, name: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`market catalog ${name} is invalid`);
  }
  return parsed;
}

function nullableSafeInteger(
  value: string | number | null,
  name: string,
): number | null {
  return value === null ? null : safeInteger(value, name);
}

function validateOwnerId(ownerId: string): void {
  if (!/^[a-z0-9:_-]{1,128}$/.test(ownerId)) {
    throw new Error("market catalog sync owner ID is invalid");
  }
}

function compareMarket(left: Market, right: Market): number {
  const family = familyOrder(left.family) - familyOrder(right.family);
  if (family !== 0) return family;
  const dex =
    (left.dexIndex ?? Number.MAX_SAFE_INTEGER) -
    (right.dexIndex ?? Number.MAX_SAFE_INTEGER);
  if (dex !== 0) return dex;
  return left.universeIndex - right.universeIndex;
}

function compareCatalogRecord(
  left: QuarantinedMarket,
  right: QuarantinedMarket,
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
