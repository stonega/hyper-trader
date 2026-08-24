import {
  type CatalogSourceError,
  type HyperliquidNetwork,
  type Market,
  type MarketCatalog,
  type MarketCatalogBuilderDex,
  parseMarketCatalogSnapshot,
  type QuarantinedMarket,
} from "@hyper-trader/hyperliquid/public";
import type {
  MarketCatalogSyncLease,
  PublishedMarketCatalog,
} from "../catalog/market-catalog-store";
import type { MarketCatalogSyncStore } from "../catalog/market-catalog-sync";

const SYNC_LEASE_MS = 120_000;
const PAGE_INTERVAL_MS = 65_000;
const GENERATION_INTERVAL_MS = 5 * 60_000;
const MAX_PAGE_FAILURES = 3;
const MAX_RECORD_BATCH_BYTES = 512 * 1024;

const CORE_SOURCES = [
  { key: "perp:0", name: "metaAndAssetCtxs:native" },
  { key: "spot", name: "spotMetaAndAssetCtxs" },
  { key: "outcome", name: "outcomeMeta" },
] as const;

interface SyncStateRow {
  readonly network: HyperliquidNetwork;
  readonly published_generation: number | null;
  readonly published_at_ms: number | null;
  readonly building_generation: number | null;
  readonly core_ready: number;
  readonly next_builder_offset: number;
  readonly builder_total: number | null;
  readonly page_failures: number;
  readonly lease_generation: number;
}

interface PublishedStateRow {
  readonly generation: number;
  readonly published_at_ms: number;
}

interface RecordRow {
  readonly record_kind: "market" | "quarantined";
  readonly payload: string;
}

interface ErrorRow {
  readonly source_name: string;
  readonly error_message: string;
  readonly status: number | null;
  readonly retry_after_ms: number | null;
}

export class D1MarketCatalogStore implements MarketCatalogSyncStore {
  readonly #database: D1Database;
  readonly #now: () => number;

  constructor(database: D1Database, now: () => number = Date.now) {
    this.#database = database;
    this.#now = now;
  }

  async claimDueSync(
    network: HyperliquidNetwork,
    ownerId: string,
  ): Promise<MarketCatalogSyncLease | null> {
    validateOwnerId(ownerId);
    const now = this.#now();
    await this.#database
      .prepare(
        `INSERT OR IGNORE INTO market_catalog_sync_state
           (network, next_attempt_at_ms, updated_at_ms)
         VALUES (?, 0, ?)`,
      )
      .bind(network, now)
      .run();
    const claimed = await this.#database
      .prepare(
        `UPDATE market_catalog_sync_state
         SET lease_owner = ?,
             lease_generation = lease_generation + 1,
             lease_expires_at_ms = ?,
             updated_at_ms = ?
         WHERE network = ?
           AND next_attempt_at_ms <= ?
           AND (lease_owner IS NULL OR lease_expires_at_ms <= ?)
         RETURNING network, published_generation, published_at_ms,
                   building_generation, core_ready, next_builder_offset,
                   builder_total, page_failures, lease_generation`,
      )
      .bind(ownerId, now + SYNC_LEASE_MS, now, network, now, now)
      .first<SyncStateRow>();
    if (!claimed) return null;
    if (claimed.building_generation !== null) {
      return leaseFromRow(claimed, ownerId);
    }

    const buildingGeneration = (claimed.published_generation ?? 0) + 1;
    const statements = [
      deleteGenerationRecordsStatement(
        this.#database,
        network,
        buildingGeneration,
        ownerId,
        claimed.lease_generation,
        claimed.published_generation,
      ),
      deleteGenerationErrorsStatement(
        this.#database,
        network,
        buildingGeneration,
        ownerId,
        claimed.lease_generation,
        claimed.published_generation,
      ),
    ];
    if (claimed.published_generation !== null) {
      statements.push(
        copyGenerationRecordsStatement(
          this.#database,
          network,
          claimed.published_generation,
          buildingGeneration,
          ownerId,
          claimed.lease_generation,
        ),
        copyGenerationErrorsStatement(
          this.#database,
          network,
          claimed.published_generation,
          buildingGeneration,
          ownerId,
          claimed.lease_generation,
        ),
      );
    }
    const stateResultIndex = statements.length;
    statements.push(
      this.#database
        .prepare(
          `UPDATE market_catalog_sync_state
           SET building_generation = ?, core_ready = 0,
               next_builder_offset = 0, builder_total = NULL,
               page_failures = 0, updated_at_ms = ?
           WHERE network = ? AND lease_owner = ? AND lease_generation = ?
             AND published_generation IS ? AND building_generation IS NULL`,
        )
        .bind(
          buildingGeneration,
          now,
          network,
          ownerId,
          claimed.lease_generation,
          claimed.published_generation,
        ),
    );
    const results = await this.#database.batch(statements);
    if (results[stateResultIndex]?.meta.changes !== 1) {
      throw new Error("market catalog sync lease was lost");
    }
    return leaseFromRow(
      {
        ...claimed,
        building_generation: buildingGeneration,
        core_ready: 0,
        next_builder_offset: 0,
        builder_total: null,
        page_failures: 0,
      },
      ownerId,
    );
  }

  async completeCore(
    lease: MarketCatalogSyncLease,
    catalog: MarketCatalog,
  ): Promise<void> {
    const state = await this.#claimedState(lease);
    const errors = new Map(
      catalog.sourceErrors.map((error) => [error.source, error] as const),
    );
    const statements: D1PreparedStatement[] = [];
    const coreErrors: CatalogSourceError[] = [];
    for (const source of CORE_SOURCES) {
      const error = errors.get(source.name);
      if (error) {
        coreErrors.push(error);
        statements.push(
          upsertSourceErrorStatement(this.#database, lease, source.key, error),
        );
      } else {
        statements.push(
          ...replaceSourceStatements(
            this.#database,
            lease,
            source.key,
            recordsForSource(catalog, source.key),
          ),
        );
      }
    }

    const nextFailureCount = state.page_failures + 1;
    const coreReady =
      coreErrors.length === 0 || nextFailureCount >= MAX_PAGE_FAILURES;
    const stateResultIndex = statements.length;
    statements.push(
      updateClaimedStateStatement(this.#database, lease, this.#now(), {
        coreReady,
        pageFailures: coreReady ? 0 : nextFailureCount,
        nextAttemptMs: coreReady
          ? PAGE_INTERVAL_MS
          : retryDelay(coreErrors, nextFailureCount),
      }),
    );
    const results = await this.#database.batch(statements);
    if (results[stateResultIndex]?.meta.changes !== 1) {
      throw new Error("market catalog sync lease was lost");
    }
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
    const state = await this.#claimedState(lease);
    const errors = new Map(
      catalog.sourceErrors.map((error) => [error.source, error] as const),
    );
    const statements: D1PreparedStatement[] = [];
    const descriptorErrors: CatalogSourceError[] = [];
    const enumerationError = errors.get("perpDexs");
    if (enumerationError) descriptorErrors.push(enumerationError);

    for (const dex of page.dexes) {
      const sourceName = `metaAndAssetCtxs:${dex.name || "native"}`;
      const error = errors.get(sourceName);
      const sourceKey = sourceKeyForBuilderDex(dex);
      if (error) {
        descriptorErrors.push(error);
        statements.push(
          upsertSourceErrorStatement(this.#database, lease, sourceKey, error),
        );
      } else {
        statements.push(
          ...replaceSourceStatements(
            this.#database,
            lease,
            sourceKey,
            recordsForBuilderDex(catalog, dex),
          ),
        );
      }
    }
    statements.push(
      enumerationError
        ? upsertSourceErrorStatement(
            this.#database,
            lease,
            "perp-dexs",
            enumerationError,
          )
        : deleteSourceErrorStatement(this.#database, lease, "perp-dexs"),
    );

    const nextFailureCount = state.page_failures + 1;
    const advance =
      descriptorErrors.length === 0 || nextFailureCount >= MAX_PAGE_FAILURES;
    if (!advance) {
      const stateResultIndex = statements.length;
      statements.push(
        updateClaimedStateStatement(this.#database, lease, this.#now(), {
          coreReady: true,
          pageFailures: nextFailureCount,
          builderTotal: page.total,
          nextAttemptMs: retryDelay(descriptorErrors, nextFailureCount),
        }),
      );
      const results = await this.#database.batch(statements);
      if (results[stateResultIndex]?.meta.changes !== 1) {
        throw new Error("market catalog sync lease was lost");
      }
      return { published: false };
    }

    const nextOffset = Math.min(page.total, page.offset + page.dexes.length);
    if (nextOffset < page.total) {
      const stateResultIndex = statements.length;
      statements.push(
        updateClaimedStateStatement(this.#database, lease, this.#now(), {
          coreReady: true,
          pageFailures: 0,
          builderTotal: page.total,
          nextBuilderOffset: nextOffset,
          nextAttemptMs: PAGE_INTERVAL_MS,
        }),
      );
      const results = await this.#database.batch(statements);
      if (results[stateResultIndex]?.meta.changes !== 1) {
        throw new Error("market catalog sync lease was lost");
      }
      return { published: false };
    }

    const retainExistingBuilders =
      enumerationError !== undefined && lease.publishedGeneration !== null;
    const publication = publishStatements(
      this.#database,
      lease,
      this.#now(),
      retainExistingBuilders ? null : page.total,
    );
    const stateResultIndex = statements.length + publication.stateResultIndex;
    statements.push(...publication.statements);
    const results = await this.#database.batch(statements);
    if (results[stateResultIndex]?.meta.changes !== 1) {
      throw new Error("market catalog sync lease was lost");
    }
    return { published: true };
  }

  async recordFailure(
    lease: MarketCatalogSyncLease,
    retryAfterMs?: number,
  ): Promise<void> {
    const now = this.#now();
    await this.#database
      .prepare(
        `UPDATE market_catalog_sync_state
         SET lease_owner = NULL, lease_expires_at_ms = NULL,
             next_attempt_at_ms = ?, updated_at_ms = ?
         WHERE network = ? AND lease_owner = ? AND lease_generation = ?
           AND building_generation = ?`,
      )
      .bind(
        now + boundedDelay(retryAfterMs ?? PAGE_INTERVAL_MS),
        now,
        lease.network,
        lease.ownerId,
        lease.leaseGeneration,
        lease.buildingGeneration,
      )
      .run();
  }

  async readPublished(
    network: HyperliquidNetwork,
  ): Promise<PublishedMarketCatalog | null> {
    const results = await this.#database.batch([
      this.#database
        .prepare(
          `SELECT published_generation AS generation, published_at_ms
             FROM market_catalog_sync_state
             WHERE network = ? AND published_generation IS NOT NULL`,
        )
        .bind(network),
      this.#database
        .prepare(
          `SELECT record_kind, payload
             FROM market_catalog_records
             WHERE network = ? AND generation = (
               SELECT published_generation FROM market_catalog_sync_state
               WHERE network = ?
             )`,
        )
        .bind(network, network),
      this.#database
        .prepare(
          `SELECT source_name, error_message, status, retry_after_ms
             FROM market_catalog_source_errors
             WHERE network = ? AND generation = (
               SELECT published_generation FROM market_catalog_sync_state
               WHERE network = ?
             )
             ORDER BY source_key`,
        )
        .bind(network, network),
    ]);
    const stateResult = results[0];
    const recordsResult = results[1];
    const errorsResult = results[2];
    if (!stateResult || !recordsResult || !errorsResult) {
      throw new Error("market catalog read batch is incomplete");
    }
    const state = (stateResult.results as PublishedStateRow[])[0];
    if (!state) return null;
    const generation = safeInteger(state.generation, "published generation");
    const publishedAtMs = safeInteger(
      state.published_at_ms,
      "published timestamp",
    );
    const records = recordsResult.results as RecordRow[];
    const errors = errorsResult.results as ErrorRow[];
    const snapshot = parseMarketCatalogSnapshot({
      schemaVersion: 1,
      network,
      generation,
      publishedAtMs,
      markets: records
        .filter((row) => row.record_kind === "market")
        .map((row) => JSON.parse(row.payload) as unknown),
      quarantined: records
        .filter((row) => row.record_kind === "quarantined")
        .map((row) => JSON.parse(row.payload) as unknown),
      sourceErrors: errors.map((row) => ({
        source: row.source_name,
        message: row.error_message,
        ...(row.status === null ? {} : { status: row.status }),
        ...(row.retry_after_ms === null
          ? {}
          : { retryAfterMs: row.retry_after_ms }),
      })),
    });
    return {
      network,
      generation,
      publishedAtMs,
      catalog: snapshot.catalog,
    };
  }

  async #claimedState(lease: MarketCatalogSyncLease): Promise<SyncStateRow> {
    const row = await this.#database
      .prepare(
        `SELECT network, published_generation, published_at_ms,
                building_generation, core_ready, next_builder_offset,
                builder_total, page_failures, lease_generation
         FROM market_catalog_sync_state
         WHERE network = ? AND lease_owner = ? AND lease_generation = ?
           AND building_generation = ? AND lease_expires_at_ms > ?`,
      )
      .bind(
        lease.network,
        lease.ownerId,
        lease.leaseGeneration,
        lease.buildingGeneration,
        this.#now(),
      )
      .first<SyncStateRow>();
    if (!row) throw new Error("market catalog sync lease was lost");
    return row;
  }
}

function replaceSourceStatements(
  database: D1Database,
  lease: MarketCatalogSyncLease,
  sourceKey: string,
  records: readonly (Market | QuarantinedMarket)[],
): D1PreparedStatement[] {
  const statements = [
    database
      .prepare(
        `DELETE FROM market_catalog_records
         WHERE network = ? AND generation = ? AND source_key = ?
           AND EXISTS (
             SELECT 1 FROM market_catalog_sync_state
             WHERE network = ? AND lease_owner = ?
               AND lease_generation = ? AND building_generation = ?
           )`,
      )
      .bind(
        lease.network,
        lease.buildingGeneration,
        sourceKey,
        lease.network,
        lease.ownerId,
        lease.leaseGeneration,
        lease.buildingGeneration,
      ),
    deleteSourceErrorStatement(database, lease, sourceKey),
  ];
  for (const recordsJson of recordJsonBatches(records)) {
    statements.push(
      database
        .prepare(
          `INSERT INTO market_catalog_records (
           network, generation, source_key, dex_index,
           record_kind, canonical_id, payload
         )
         SELECT ?, ?, ?, json_extract(record.value, '$.dexIndex'),
                CASE
                  WHEN json_type(record.value, '$.reasons') IS NULL
                    THEN 'market'
                  ELSE 'quarantined'
                END,
                json_extract(record.value, '$.canonicalId'), record.value
         FROM json_each(?) AS record
         WHERE EXISTS (
           SELECT 1 FROM market_catalog_sync_state
           WHERE network = ? AND lease_owner = ?
             AND lease_generation = ? AND building_generation = ?
         )`,
        )
        .bind(
          lease.network,
          lease.buildingGeneration,
          sourceKey,
          recordsJson,
          lease.network,
          lease.ownerId,
          lease.leaseGeneration,
          lease.buildingGeneration,
        ),
    );
  }
  return statements;
}

function upsertSourceErrorStatement(
  database: D1Database,
  lease: MarketCatalogSyncLease,
  sourceKey: string,
  error: CatalogSourceError,
): D1PreparedStatement {
  const message = error.message.slice(0, 1024) || "catalog source failed";
  const status =
    error.status !== undefined && error.status >= 400 && error.status <= 599
      ? error.status
      : null;
  const retryAfterMs =
    error.retryAfterMs === undefined ? null : boundedDelay(error.retryAfterMs);
  return database
    .prepare(
      `INSERT INTO market_catalog_source_errors (
         network, generation, source_key, source_name,
         error_message, status, retry_after_ms
       )
       SELECT ?, ?, ?, ?, ?, ?, ?
       WHERE EXISTS (
         SELECT 1 FROM market_catalog_sync_state
         WHERE network = ? AND lease_owner = ?
           AND lease_generation = ? AND building_generation = ?
       )
       ON CONFLICT (network, generation, source_key) DO UPDATE SET
         source_name = excluded.source_name,
         error_message = excluded.error_message,
         status = excluded.status,
         retry_after_ms = excluded.retry_after_ms`,
    )
    .bind(
      lease.network,
      lease.buildingGeneration,
      sourceKey,
      error.source.slice(0, 256),
      message,
      status,
      retryAfterMs,
      lease.network,
      lease.ownerId,
      lease.leaseGeneration,
      lease.buildingGeneration,
    );
}

function deleteSourceErrorStatement(
  database: D1Database,
  lease: MarketCatalogSyncLease,
  sourceKey: string,
): D1PreparedStatement {
  return database
    .prepare(
      `DELETE FROM market_catalog_source_errors
       WHERE network = ? AND generation = ? AND source_key = ?
         AND EXISTS (
           SELECT 1 FROM market_catalog_sync_state
           WHERE network = ? AND lease_owner = ?
             AND lease_generation = ? AND building_generation = ?
         )`,
    )
    .bind(
      lease.network,
      lease.buildingGeneration,
      sourceKey,
      lease.network,
      lease.ownerId,
      lease.leaseGeneration,
      lease.buildingGeneration,
    );
}

function updateClaimedStateStatement(
  database: D1Database,
  lease: MarketCatalogSyncLease,
  now: number,
  update: {
    readonly coreReady: boolean;
    readonly pageFailures: number;
    readonly nextAttemptMs: number;
    readonly nextBuilderOffset?: number;
    readonly builderTotal?: number;
  },
): D1PreparedStatement {
  return database
    .prepare(
      `UPDATE market_catalog_sync_state
       SET core_ready = ?, page_failures = ?, next_builder_offset = ?,
           builder_total = ?, next_attempt_at_ms = ?, lease_owner = NULL,
           lease_expires_at_ms = NULL, updated_at_ms = ?
       WHERE network = ? AND lease_owner = ? AND lease_generation = ?
         AND building_generation = ?`,
    )
    .bind(
      update.coreReady ? 1 : 0,
      update.pageFailures,
      update.nextBuilderOffset ?? lease.nextBuilderOffset,
      update.builderTotal ?? lease.builderTotal,
      now + boundedDelay(update.nextAttemptMs),
      now,
      lease.network,
      lease.ownerId,
      lease.leaseGeneration,
      lease.buildingGeneration,
    );
}

function publishStatements(
  database: D1Database,
  lease: MarketCatalogSyncLease,
  now: number,
  builderTotal: number | null,
): {
  readonly statements: D1PreparedStatement[];
  readonly stateResultIndex: number;
} {
  const statements: D1PreparedStatement[] = [];
  if (builderTotal !== null) {
    statements.push(
      database
        .prepare(
          `DELETE FROM market_catalog_records
           WHERE network = ? AND generation = ? AND dex_index > ?
             AND EXISTS (
               SELECT 1 FROM market_catalog_sync_state
               WHERE network = ? AND lease_owner = ?
                 AND lease_generation = ? AND building_generation = ?
             )`,
        )
        .bind(
          lease.network,
          lease.buildingGeneration,
          builderTotal,
          lease.network,
          lease.ownerId,
          lease.leaseGeneration,
          lease.buildingGeneration,
        ),
      database
        .prepare(
          `DELETE FROM market_catalog_source_errors
           WHERE network = ? AND generation = ?
             AND source_key GLOB 'perp:[0-9]*'
             AND CAST(substr(source_key, 6) AS INTEGER) > ?
             AND EXISTS (
               SELECT 1 FROM market_catalog_sync_state
               WHERE network = ? AND lease_owner = ?
                 AND lease_generation = ? AND building_generation = ?
             )`,
        )
        .bind(
          lease.network,
          lease.buildingGeneration,
          builderTotal,
          lease.network,
          lease.ownerId,
          lease.leaseGeneration,
          lease.buildingGeneration,
        ),
    );
  }
  const stateResultIndex = statements.length;
  statements.push(
    database
      .prepare(
        `UPDATE market_catalog_sync_state
         SET published_generation = ?, published_at_ms = ?,
             building_generation = NULL, core_ready = 0,
             next_builder_offset = 0, builder_total = NULL,
             page_failures = 0, next_attempt_at_ms = ?,
             lease_owner = NULL, lease_expires_at_ms = NULL,
             updated_at_ms = ?
         WHERE network = ? AND lease_owner = ? AND lease_generation = ?
           AND building_generation = ?`,
      )
      .bind(
        lease.buildingGeneration,
        now,
        now + GENERATION_INTERVAL_MS,
        now,
        lease.network,
        lease.ownerId,
        lease.leaseGeneration,
        lease.buildingGeneration,
      ),
  );
  const oldestRetainedGeneration = Math.max(1, lease.buildingGeneration - 1);
  statements.push(
    database
      .prepare(
        `DELETE FROM market_catalog_records
         WHERE network = ? AND generation < ?
           AND EXISTS (
             SELECT 1 FROM market_catalog_sync_state
             WHERE network = ? AND published_generation = ?
               AND building_generation IS NULL AND updated_at_ms = ?
           )`,
      )
      .bind(
        lease.network,
        oldestRetainedGeneration,
        lease.network,
        lease.buildingGeneration,
        now,
      ),
    database
      .prepare(
        `DELETE FROM market_catalog_source_errors
         WHERE network = ? AND generation < ?
           AND EXISTS (
             SELECT 1 FROM market_catalog_sync_state
             WHERE network = ? AND published_generation = ?
               AND building_generation IS NULL AND updated_at_ms = ?
           )`,
      )
      .bind(
        lease.network,
        oldestRetainedGeneration,
        lease.network,
        lease.buildingGeneration,
        now,
      ),
  );
  return { statements, stateResultIndex };
}

function deleteGenerationRecordsStatement(
  database: D1Database,
  network: HyperliquidNetwork,
  generation: number,
  ownerId: string,
  leaseGeneration: number,
  publishedGeneration: number | null,
): D1PreparedStatement {
  return database
    .prepare(
      `DELETE FROM market_catalog_records
       WHERE network = ? AND generation = ?
         AND EXISTS (
           SELECT 1 FROM market_catalog_sync_state
           WHERE network = ? AND lease_owner = ? AND lease_generation = ?
             AND published_generation IS ? AND building_generation IS NULL
         )`,
    )
    .bind(
      network,
      generation,
      network,
      ownerId,
      leaseGeneration,
      publishedGeneration,
    );
}

function deleteGenerationErrorsStatement(
  database: D1Database,
  network: HyperliquidNetwork,
  generation: number,
  ownerId: string,
  leaseGeneration: number,
  publishedGeneration: number | null,
): D1PreparedStatement {
  return database
    .prepare(
      `DELETE FROM market_catalog_source_errors
       WHERE network = ? AND generation = ?
         AND EXISTS (
           SELECT 1 FROM market_catalog_sync_state
           WHERE network = ? AND lease_owner = ? AND lease_generation = ?
             AND published_generation IS ? AND building_generation IS NULL
         )`,
    )
    .bind(
      network,
      generation,
      network,
      ownerId,
      leaseGeneration,
      publishedGeneration,
    );
}

function copyGenerationRecordsStatement(
  database: D1Database,
  network: HyperliquidNetwork,
  sourceGeneration: number,
  targetGeneration: number,
  ownerId: string,
  leaseGeneration: number,
): D1PreparedStatement {
  return database
    .prepare(
      `INSERT INTO market_catalog_records (
         network, generation, source_key, dex_index,
         record_kind, canonical_id, payload
       )
       SELECT source.network, ?, source.source_key, source.dex_index,
              source.record_kind, source.canonical_id, source.payload
       FROM market_catalog_records AS source
       WHERE source.network = ? AND source.generation = ?
         AND EXISTS (
           SELECT 1 FROM market_catalog_sync_state
           WHERE network = ? AND lease_owner = ? AND lease_generation = ?
             AND published_generation = ? AND building_generation IS NULL
         )`,
    )
    .bind(
      targetGeneration,
      network,
      sourceGeneration,
      network,
      ownerId,
      leaseGeneration,
      sourceGeneration,
    );
}

function copyGenerationErrorsStatement(
  database: D1Database,
  network: HyperliquidNetwork,
  sourceGeneration: number,
  targetGeneration: number,
  ownerId: string,
  leaseGeneration: number,
): D1PreparedStatement {
  return database
    .prepare(
      `INSERT INTO market_catalog_source_errors (
         network, generation, source_key, source_name,
         error_message, status, retry_after_ms
       )
       SELECT source.network, ?, source.source_key, source.source_name,
              source.error_message, source.status, source.retry_after_ms
       FROM market_catalog_source_errors AS source
       WHERE source.network = ? AND source.generation = ?
         AND EXISTS (
           SELECT 1 FROM market_catalog_sync_state
           WHERE network = ? AND lease_owner = ? AND lease_generation = ?
             AND published_generation = ? AND building_generation IS NULL
         )`,
    )
    .bind(
      targetGeneration,
      network,
      sourceGeneration,
      network,
      ownerId,
      leaseGeneration,
      sourceGeneration,
    );
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

function recordJsonBatches(
  records: readonly (Market | QuarantinedMarket)[],
): string[] {
  const batches: string[] = [];
  let parts: string[] = [];
  let batchBytes = 2;
  for (const record of records) {
    const part = JSON.stringify(record);
    const partBytes = new TextEncoder().encode(part).byteLength;
    if (partBytes + 2 > MAX_RECORD_BATCH_BYTES) {
      throw new Error("market catalog record exceeds the D1 write boundary");
    }
    const separatorBytes = parts.length === 0 ? 0 : 1;
    if (
      parts.length > 0 &&
      batchBytes + separatorBytes + partBytes > MAX_RECORD_BATCH_BYTES
    ) {
      batches.push(`[${parts.join(",")}]`);
      parts = [];
      batchBytes = 2;
    }
    parts.push(part);
    batchBytes += (parts.length === 1 ? 0 : 1) + partBytes;
  }
  if (parts.length > 0) batches.push(`[${parts.join(",")}]`);
  return batches;
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
  return boundedDelay(Math.max(upstream, exponential));
}

function boundedDelay(value: number): number {
  if (!Number.isFinite(value)) return PAGE_INTERVAL_MS;
  return Math.max(1_000, Math.min(86_400_000, Math.ceil(value)));
}

function leaseFromRow(
  row: SyncStateRow,
  ownerId: string,
): MarketCatalogSyncLease {
  if (row.building_generation === null) {
    throw new Error("market catalog building generation is unavailable");
  }
  return {
    network: row.network,
    ownerId,
    leaseGeneration: safeInteger(row.lease_generation, "lease generation"),
    buildingGeneration: safeInteger(
      row.building_generation,
      "building generation",
    ),
    publishedGeneration:
      row.published_generation === null
        ? null
        : safeInteger(row.published_generation, "published generation"),
    coreReady: row.core_ready === 1,
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

function safeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`market catalog ${name} is invalid`);
  }
  return value;
}

function validateOwnerId(ownerId: string): void {
  if (!/^[a-z0-9:_-]{1,128}$/.test(ownerId)) {
    throw new Error("market catalog sync owner ID is invalid");
  }
}
