import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import type { PerpMarket } from "@hyper-trader/hyperliquid/public";

import { D1MarketCatalogStore } from "./d1-market-catalog-store";

const databases: Database[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("D1MarketCatalogStore", () => {
  test("initializes a large existing catalog without copying published rows", async () => {
    const sqlite = new Database(":memory:");
    databases.push(sqlite);
    sqlite.exec(await migration("0001_market_catalog.sql"));

    const sourceErrors = Object.fromEntries(
      Array.from({ length: 1_200 }, (_, index) => [
        `perp:${index + 1}`,
        {
          source: `metaAndAssetCtxs:dex-${index + 1}`,
          message: "x".repeat(900),
        },
      ]),
    );
    const publishedPayload = JSON.stringify({
      schemaVersion: 1,
      markets: [],
      quarantined: [],
      sourceErrors,
    });
    expect(Buffer.byteLength(publishedPayload) * 2).toBeGreaterThan(2_000_000);

    sqlite
      .query(
        `INSERT INTO market_catalog_sync_state (
           network, published_generation, published_at_ms,
           published_payload, next_attempt_at_ms, updated_at_ms
         ) VALUES (?, ?, ?, ?, 0, 0)`,
      )
      .run("testnet", 1, 1_000, publishedPayload);
    sqlite.exec(await migration("0002_catalog_records.sql"));
    sqlite.exec(await migration("0003_generation_sources.sql"));

    const database = new SqliteD1Database(sqlite);
    const store = new D1MarketCatalogStore(
      database as unknown as D1Database,
      () => 2_000,
    );
    const lease = await store.claimDueSync("testnet", "catalog-owner");

    expect(lease).toMatchObject({
      network: "testnet",
      publishedGeneration: 1,
      buildingGeneration: 2,
      leaseGeneration: 1,
    });
    expect(
      sqlite
        .query(
          `SELECT generation, count(*) AS count
           FROM market_catalog_source_errors
           GROUP BY generation ORDER BY generation`,
        )
        .all(),
    ).toEqual([{ generation: 1, count: 1_200 }]);
    expect(
      sqlite
        .query(
          `SELECT generation, count(*) AS count
           FROM market_catalog_generation_sources
           GROUP BY generation ORDER BY generation`,
        )
        .all(),
    ).toEqual([{ generation: 1, count: 1_200 }]);
    expect(
      sqlite
        .query("PRAGMA table_info(market_catalog_sync_state)")
        .all()
        .map((column) => (column as { name: string }).name),
    ).not.toContain("published_payload");
    expect(
      sqlite
        .query("PRAGMA table_info(market_catalog_sync_state)")
        .all()
        .map((column) => (column as { name: string }).name),
    ).not.toContain("building_payload");
  });

  test("builds, publishes, and reads a normalized catalog generation", async () => {
    const sqlite = new Database(":memory:");
    databases.push(sqlite);
    sqlite.exec(await migration("0001_market_catalog.sql"));
    sqlite.exec(await migration("0002_catalog_records.sql"));
    sqlite.exec(await migration("0003_generation_sources.sql"));
    const database = new SqliteD1Database(sqlite);
    let now = 10_000;
    const store = new D1MarketCatalogStore(
      database as unknown as D1Database,
      () => now,
    );

    const coreLease = await store.claimDueSync("testnet", "catalog-owner");
    expect(coreLease).not.toBeNull();
    if (!coreLease) throw new Error("expected the core sync lease");
    await store.completeCore(coreLease, {
      markets: [perp()],
      quarantined: [],
      sourceErrors: [],
    });

    now += 65_000;
    const builderLease = await store.claimDueSync("testnet", "catalog-owner");
    expect(builderLease).toMatchObject({
      buildingGeneration: 1,
      coreReady: true,
      nextBuilderOffset: 0,
    });
    if (!builderLease) throw new Error("expected the builder sync lease");
    await expect(
      store.completeBuilderPage(builderLease, {
        markets: [],
        quarantined: [],
        sourceErrors: [],
        builderPage: { offset: 0, limit: 37, total: 0, dexes: [] },
      }),
    ).resolves.toEqual({ published: true });

    await expect(store.readPublished("testnet")).resolves.toMatchObject({
      network: "testnet",
      generation: 1,
      publishedAtMs: now,
      catalog: { markets: [perp()], quarantined: [], sourceErrors: [] },
    });
  });

  test("builds incrementally, retains only failed sources, and skips unchanged writes", async () => {
    const sqlite = new Database(":memory:");
    databases.push(sqlite);
    sqlite.exec(await migration("0001_market_catalog.sql"));
    sqlite.exec(await migration("0002_catalog_records.sql"));
    sqlite.exec(await migration("0003_generation_sources.sql"));
    const database = new SqliteD1Database(sqlite);
    let now = 10_000;
    const store = new D1MarketCatalogStore(
      database as unknown as D1Database,
      () => now,
    );

    const coreLease = await store.claimDueSync("testnet", "catalog-owner");
    if (!coreLease) throw new Error("expected the initial core lease");
    await store.completeCore(coreLease, {
      markets: [perp()],
      quarantined: [],
      sourceErrors: [],
    });
    now += 65_000;
    const builderLease = await store.claimDueSync("testnet", "catalog-owner");
    if (!builderLease) throw new Error("expected the initial builder lease");
    await store.completeBuilderPage(builderLease, {
      markets: [
        perp({
          canonicalId: "perp:1:0",
          dexIndex: 1,
          dexName: "builder-one",
          dexFullName: "Builder One",
          orderAssetId: 100_000,
        }),
      ],
      quarantined: [],
      sourceErrors: [],
      builderPage: {
        offset: 0,
        limit: 37,
        total: 1,
        dexes: [{ index: 1, name: "builder-one", fullName: "Builder One" }],
      },
    });
    const publishedAt = now;

    now = publishedAt + 5 * 60_000;
    await expect(
      store.claimDueSync("testnet", "catalog-owner"),
    ).resolves.toBeNull();
    now = publishedAt + 15 * 60_000;
    const nextCoreLease = await store.claimDueSync("testnet", "catalog-owner");
    if (!nextCoreLease) throw new Error("expected the next core lease");
    expect(
      sqlite
        .query(
          `SELECT count(*) AS count FROM market_catalog_records
           WHERE network = 'testnet' AND generation = 2`,
        )
        .get(),
    ).toEqual({ count: 0 });

    const nativeError = {
      source: "metaAndAssetCtxs:native",
      message: "native catalog unavailable",
    } as const;
    await store.completeCore(nextCoreLease, {
      markets: [],
      quarantined: [],
      sourceErrors: [nativeError],
    });
    expect(
      sqlite
        .query(
          `SELECT source_key FROM market_catalog_records
           WHERE network = 'testnet' AND generation = 2
           ORDER BY source_key`,
        )
        .all(),
    ).toEqual([{ source_key: "perp:0" }]);
    expect(
      sqlite
        .query(
          `SELECT source_key, resolution
           FROM market_catalog_generation_sources
           WHERE network = 'testnet' AND generation = 2
           ORDER BY source_key`,
        )
        .all(),
    ).toEqual([
      { source_key: "outcome", resolution: "refreshed" },
      { source_key: "perp:0", resolution: "fallback" },
      { source_key: "spot", resolution: "refreshed" },
    ]);

    now += 5_000;
    const retryLease = await store.claimDueSync("testnet", "catalog-owner");
    if (!retryLease) throw new Error("expected the core retry lease");
    const changesBeforeRetry = totalChanges(sqlite);
    await store.completeCore(retryLease, {
      markets: [],
      quarantined: [],
      sourceErrors: [nativeError],
    });
    expect(totalChanges(sqlite) - changesBeforeRetry).toBe(1);
    expect(
      database.preparedSql.some((sql) =>
        sql.includes("INDEXED BY market_catalog_records_source"),
      ),
    ).toBe(true);

    now += 10_000;
    const recoveryLease = await store.claimDueSync("testnet", "catalog-owner");
    if (!recoveryLease) throw new Error("expected the core recovery lease");
    const changesBeforeRecovery = totalChanges(sqlite);
    await store.completeCore(recoveryLease, {
      markets: [perp()],
      quarantined: [],
      sourceErrors: [
        { source: "outcomeMeta", message: "outcomes unavailable" },
      ],
    });
    expect(totalChanges(sqlite) - changesBeforeRecovery).toBe(4);
    expect(
      sqlite
        .query(
          `SELECT resolution FROM market_catalog_generation_sources
           WHERE network = 'testnet' AND generation = 2
             AND source_key = 'perp:0'`,
        )
        .get(),
    ).toEqual({ resolution: "refreshed" });
  });

  test("retains missing builder sources only after enumeration retries are exhausted", async () => {
    const sqlite = new Database(":memory:");
    databases.push(sqlite);
    sqlite.exec(await migration("0001_market_catalog.sql"));
    sqlite.exec(await migration("0002_catalog_records.sql"));
    sqlite.exec(await migration("0003_generation_sources.sql"));
    const database = new SqliteD1Database(sqlite);
    let now = 20_000;
    const store = new D1MarketCatalogStore(
      database as unknown as D1Database,
      () => now,
    );
    const builderMarket = perp({
      canonicalId: "perp:1:0",
      dexIndex: 1,
      dexName: "builder-one",
      dexFullName: "Builder One",
      orderAssetId: 100_000,
    });

    const firstCore = await store.claimDueSync("testnet", "catalog-owner");
    if (!firstCore) throw new Error("expected the first core lease");
    await store.completeCore(firstCore, {
      markets: [perp()],
      quarantined: [],
      sourceErrors: [],
    });
    now += 65_000;
    const firstBuilder = await store.claimDueSync("testnet", "catalog-owner");
    if (!firstBuilder) throw new Error("expected the first builder lease");
    await store.completeBuilderPage(firstBuilder, {
      markets: [builderMarket],
      quarantined: [],
      sourceErrors: [],
      builderPage: {
        offset: 0,
        limit: 37,
        total: 1,
        dexes: [{ index: 1, name: "builder-one", fullName: "Builder One" }],
      },
    });

    now += 15 * 60_000;
    const secondCore = await store.claimDueSync("testnet", "catalog-owner");
    if (!secondCore) throw new Error("expected the second core lease");
    await store.completeCore(secondCore, {
      markets: [perp({ markPx: "101000" })],
      quarantined: [],
      sourceErrors: [],
    });
    now += 65_000;

    const enumerationFailure = {
      markets: [],
      quarantined: [],
      sourceErrors: [
        { source: "perpDexs", message: "builder enumeration unavailable" },
      ],
      builderPage: { offset: 0, limit: 37, total: 0, dexes: [] },
    } as const;
    const firstFailure = await store.claimDueSync("testnet", "catalog-owner");
    if (!firstFailure) throw new Error("expected the first builder retry");
    await expect(
      store.completeBuilderPage(firstFailure, enumerationFailure),
    ).resolves.toEqual({ published: false });
    now += 5_000;
    const secondFailure = await store.claimDueSync("testnet", "catalog-owner");
    if (!secondFailure) throw new Error("expected the second builder retry");
    await expect(
      store.completeBuilderPage(secondFailure, enumerationFailure),
    ).resolves.toEqual({ published: false });
    now += 10_000;
    const finalFailure = await store.claimDueSync("testnet", "catalog-owner");
    if (!finalFailure) throw new Error("expected the final builder retry");
    await expect(
      store.completeBuilderPage(finalFailure, enumerationFailure),
    ).resolves.toEqual({ published: true });

    const published = await store.readPublished("testnet");
    expect(
      published?.catalog.markets.map((market) => market.canonicalId).sort(),
    ).toEqual(["perp:0:0", "perp:1:0"]);
    expect(published?.catalog.sourceErrors).toEqual([
      {
        source: "perpDexs",
        message: "builder enumeration unavailable",
      },
    ]);
    expect(
      sqlite
        .query(
          `SELECT source_key, resolution
           FROM market_catalog_generation_sources
           WHERE network = 'testnet' AND generation = 2
             AND source_key = 'perp:1'`,
        )
        .get(),
    ).toEqual({ source_key: "perp:1", resolution: "fallback" });
  });
});

function perp(input: Partial<PerpMarket> = {}): PerpMarket {
  return {
    family: "perp",
    canonicalId: "perp:0:0",
    displaySymbol: "BTC",
    coin: "BTC",
    dexIndex: 0,
    dexName: "",
    dexFullName: null,
    universeIndex: 0,
    orderAssetId: 0,
    sizeDecimals: 3,
    pricePrecision: { maxSignificantFigures: 5, maxDecimalPlaces: 3 },
    maxLeverage: 20,
    onlyIsolated: false,
    marginMode: null,
    marginTableId: null,
    lifecycle: "active",
    orderAvailability: "enabled",
    validationReasons: [],
    ...input,
  };
}

function totalChanges(database: Database): number {
  const row = database.query("SELECT total_changes() AS count").get() as {
    readonly count: number;
  };
  return row.count;
}

async function migration(name: string): Promise<string> {
  return Bun.file(
    new URL(`../../cloudflare/migrations/${name}`, import.meta.url),
  ).text();
}

type Binding = string | number | bigint | boolean | null | Uint8Array;

class SqliteD1Database {
  readonly #sqlite: Database;
  readonly preparedSql: string[] = [];

  constructor(sqlite: Database) {
    this.#sqlite = sqlite;
  }

  prepare(sql: string): SqliteD1PreparedStatement {
    this.preparedSql.push(sql);
    return new SqliteD1PreparedStatement(this.#sqlite, sql);
  }

  async batch(
    statements: readonly SqliteD1PreparedStatement[],
  ): Promise<unknown[]> {
    return this.#sqlite.transaction(() =>
      statements.map((statement) => statement.execute()),
    )();
  }
}

class SqliteD1PreparedStatement {
  readonly #sqlite: Database;
  readonly #sql: string;
  readonly #bindings: readonly Binding[];

  constructor(
    sqlite: Database,
    sql: string,
    bindings: readonly Binding[] = [],
  ) {
    this.#sqlite = sqlite;
    this.#sql = sql;
    this.#bindings = bindings;
  }

  bind(...bindings: Binding[]): SqliteD1PreparedStatement {
    return new SqliteD1PreparedStatement(this.#sqlite, this.#sql, bindings);
  }

  async first<T>(): Promise<T | null> {
    return this.#sqlite.query(this.#sql).get(...this.#bindings) as T | null;
  }

  async run(): Promise<unknown> {
    return this.execute();
  }

  execute(): unknown {
    const statement = this.#sqlite.query(this.#sql);
    if (/^\s*(?:SELECT|PRAGMA|WITH)\b/i.test(this.#sql)) {
      return result(statement.all(...this.#bindings), 0);
    }
    if (/\bRETURNING\b/i.test(this.#sql)) {
      return result(statement.all(...this.#bindings), 1);
    }
    const execution = statement.run(...this.#bindings);
    return result([], execution.changes);
  }
}

function result(results: unknown[], changes: number): unknown {
  return {
    success: true,
    results,
    meta: { changes },
  };
}
