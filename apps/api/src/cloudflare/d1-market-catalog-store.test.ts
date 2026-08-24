import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import type { PerpMarket } from "@hyper-trader/hyperliquid/public";

import { D1MarketCatalogStore } from "./d1-market-catalog-store";

const databases: Database[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("D1MarketCatalogStore", () => {
  test("copies a large published catalog as normalized generation rows", async () => {
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
    ).toEqual([
      { generation: 1, count: 1_200 },
      { generation: 2, count: 1_200 },
    ]);
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
});

function perp(): PerpMarket {
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
  };
}

async function migration(name: string): Promise<string> {
  return Bun.file(
    new URL(`../../cloudflare/migrations/${name}`, import.meta.url),
  ).text();
}

type Binding = string | number | bigint | boolean | null | Uint8Array;

class SqliteD1Database {
  readonly #sqlite: Database;

  constructor(sqlite: Database) {
    this.#sqlite = sqlite;
  }

  prepare(sql: string): SqliteD1PreparedStatement {
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
