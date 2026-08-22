import {
  type CatalogSourceError,
  type HyperliquidNetwork,
  type MarketCatalog,
  parseMarketCatalogSnapshot,
} from "@hyper-trader/hyperliquid/public";
import type {
  MarketCatalogSyncLease,
  PublishedMarketCatalog,
} from "../catalog/market-catalog-store";
import type { MarketCatalogSyncStore } from "../catalog/market-catalog-sync";
import {
  catalogFromPayload,
  emptyCatalogPayload,
  mergeBuilderCatalog,
  mergeCoreCatalog,
  type PersistedCatalogPayload,
  pruneBuilderCatalog,
  retainedBuilderTotal,
} from "./catalog-payload";

const SYNC_LEASE_MS = 120_000;
const PAGE_INTERVAL_MS = 65_000;
const GENERATION_INTERVAL_MS = 5 * 60_000;
const MAX_PAGE_FAILURES = 3;

interface SyncStateRow {
  readonly network: HyperliquidNetwork;
  readonly published_generation: number | null;
  readonly published_at_ms: number | null;
  readonly published_payload: string | null;
  readonly building_generation: number | null;
  readonly building_payload: string | null;
  readonly core_ready: number;
  readonly next_builder_offset: number;
  readonly builder_total: number | null;
  readonly page_failures: number;
  readonly lease_generation: number;
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
                   published_payload, building_generation, building_payload,
                   core_ready, next_builder_offset, builder_total,
                   page_failures, lease_generation`,
      )
      .bind(ownerId, now + SYNC_LEASE_MS, now, network, now, now)
      .first<SyncStateRow>();
    if (!claimed) return null;
    if (claimed.building_generation !== null) {
      return leaseFromRow(claimed, ownerId);
    }

    const buildingGeneration = (claimed.published_generation ?? 0) + 1;
    const buildingPayload = claimed.published_payload
      ? parsePayload(claimed.published_payload)
      : emptyCatalogPayload();
    const initialized = await this.#database
      .prepare(
        `UPDATE market_catalog_sync_state
         SET building_generation = ?, building_payload = ?, core_ready = 0,
             next_builder_offset = 0, builder_total = NULL,
             page_failures = 0, updated_at_ms = ?
         WHERE network = ? AND lease_owner = ? AND lease_generation = ?
         RETURNING network, published_generation, published_at_ms,
                   published_payload, building_generation, building_payload,
                   core_ready, next_builder_offset, builder_total,
                   page_failures, lease_generation`,
      )
      .bind(
        buildingGeneration,
        JSON.stringify(buildingPayload),
        now,
        network,
        ownerId,
        claimed.lease_generation,
      )
      .first<SyncStateRow>();
    if (!initialized) throw new Error("market catalog sync lease was lost");
    return leaseFromRow(initialized, ownerId);
  }

  async completeCore(
    lease: MarketCatalogSyncLease,
    catalog: MarketCatalog,
  ): Promise<void> {
    const state = await this.#claimedState(lease);
    const merged = mergeCoreCatalog(
      parseRequiredPayload(state.building_payload),
      catalog,
    );
    const nextFailureCount = state.page_failures + 1;
    const coreReady =
      merged.errors.length === 0 || nextFailureCount >= MAX_PAGE_FAILURES;
    await this.#updateClaimedState(lease, merged.payload, {
      coreReady,
      pageFailures: coreReady ? 0 : nextFailureCount,
      nextAttemptMs: coreReady
        ? PAGE_INTERVAL_MS
        : retryDelay(merged.errors, nextFailureCount),
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
    const state = await this.#claimedState(lease);
    const merged = mergeBuilderCatalog(
      parseRequiredPayload(state.building_payload),
      catalog,
    );
    const nextFailureCount = state.page_failures + 1;
    const advance =
      merged.descriptorErrors.length === 0 ||
      nextFailureCount >= MAX_PAGE_FAILURES;
    if (!advance) {
      await this.#updateClaimedState(lease, merged.payload, {
        coreReady: true,
        pageFailures: nextFailureCount,
        builderTotal: page.total,
        nextAttemptMs: retryDelay(merged.descriptorErrors, nextFailureCount),
      });
      return { published: false };
    }

    const nextOffset = Math.min(page.total, page.offset + page.dexes.length);
    if (nextOffset < page.total) {
      await this.#updateClaimedState(lease, merged.payload, {
        coreReady: true,
        pageFailures: 0,
        builderTotal: page.total,
        nextBuilderOffset: nextOffset,
        nextAttemptMs: PAGE_INTERVAL_MS,
      });
      return { published: false };
    }

    const completedBuilderTotal =
      merged.enumerationError && lease.publishedGeneration !== null
        ? retainedBuilderTotal(merged.payload)
        : page.total;
    await this.#publish(
      lease,
      pruneBuilderCatalog(merged.payload, completedBuilderTotal),
    );
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
    const row = await this.#database
      .prepare(
        `SELECT published_generation, published_at_ms, published_payload
         FROM market_catalog_sync_state WHERE network = ?`,
      )
      .bind(network)
      .first<
        Pick<
          SyncStateRow,
          "published_generation" | "published_at_ms" | "published_payload"
        >
      >();
    if (
      !row ||
      row.published_generation === null ||
      row.published_at_ms === null ||
      row.published_payload === null
    ) {
      return null;
    }
    const generation = safeInteger(
      row.published_generation,
      "published generation",
    );
    const publishedAtMs = safeInteger(
      row.published_at_ms,
      "published timestamp",
    );
    const stored = parsePayload(row.published_payload);
    const snapshot = parseMarketCatalogSnapshot({
      schemaVersion: 1,
      network,
      generation,
      publishedAtMs,
      ...catalogFromPayload(stored),
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
                published_payload, building_generation, building_payload,
                core_ready, next_builder_offset, builder_total,
                page_failures, lease_generation
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

  async #updateClaimedState(
    lease: MarketCatalogSyncLease,
    payload: PersistedCatalogPayload,
    update: {
      readonly coreReady: boolean;
      readonly pageFailures: number;
      readonly nextAttemptMs: number;
      readonly nextBuilderOffset?: number;
      readonly builderTotal?: number;
    },
  ): Promise<void> {
    const now = this.#now();
    const result = await this.#database
      .prepare(
        `UPDATE market_catalog_sync_state
         SET building_payload = ?, core_ready = ?, page_failures = ?,
             next_builder_offset = ?, builder_total = ?,
             next_attempt_at_ms = ?, lease_owner = NULL,
             lease_expires_at_ms = NULL, updated_at_ms = ?
         WHERE network = ? AND lease_owner = ? AND lease_generation = ?
           AND building_generation = ?`,
      )
      .bind(
        JSON.stringify(payload),
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
      )
      .run();
    if (result.meta.changes !== 1) {
      throw new Error("market catalog sync lease was lost");
    }
  }

  async #publish(
    lease: MarketCatalogSyncLease,
    payload: PersistedCatalogPayload,
  ): Promise<void> {
    const now = this.#now();
    const result = await this.#database
      .prepare(
        `UPDATE market_catalog_sync_state
         SET published_generation = ?, published_at_ms = ?,
             published_payload = ?, building_generation = NULL,
             building_payload = NULL, core_ready = 0,
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
        JSON.stringify(payload),
        now + GENERATION_INTERVAL_MS,
        now,
        lease.network,
        lease.ownerId,
        lease.leaseGeneration,
        lease.buildingGeneration,
      )
      .run();
    if (result.meta.changes !== 1) {
      throw new Error("market catalog sync lease was lost");
    }
  }
}

function parseRequiredPayload(value: string | null): PersistedCatalogPayload {
  if (value === null) {
    throw new Error("market catalog building payload is unavailable");
  }
  return parsePayload(value);
}

function parsePayload(value: string): PersistedCatalogPayload {
  const parsed: unknown = JSON.parse(value);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    (parsed as { schemaVersion?: unknown }).schemaVersion !== 1 ||
    !Array.isArray((parsed as { markets?: unknown }).markets) ||
    !Array.isArray((parsed as { quarantined?: unknown }).quarantined) ||
    typeof (parsed as { sourceErrors?: unknown }).sourceErrors !== "object" ||
    (parsed as { sourceErrors?: unknown }).sourceErrors === null ||
    Array.isArray((parsed as { sourceErrors?: unknown }).sourceErrors)
  ) {
    throw new Error("market catalog payload is invalid");
  }
  return parsed as PersistedCatalogPayload;
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
