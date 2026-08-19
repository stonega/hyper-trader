import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import type {
  MarketCatalog,
  PerpMarket,
} from "@hyper-trader/hyperliquid/public";
import { SQL } from "bun";
import {
  migrateNotifications,
  rollbackNotificationMigrations,
} from "../db/migrations";
import {
  type MarketCatalogSyncLease,
  PostgresMarketCatalogStore,
} from "./market-catalog-store";

const databaseUrl = process.env.NOTIFICATION_TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

integration("PostgreSQL market catalog generations", () => {
  let sql: SQL;
  let store: PostgresMarketCatalogStore;

  beforeAll(async () => {
    sql = new SQL(databaseUrl as string, { max: 2 });
  });

  beforeEach(async () => {
    await rollbackNotificationMigrations(sql, { target: 0 });
    await migrateNotifications(sql, { target: 5 });
    store = new PostgresMarketCatalogStore(sql);
  });

  afterAll(async () => {
    await rollbackNotificationMigrations(sql, { target: 0 });
    await sql.close();
  });

  test("publishes only a completed generation and preserves it during the next build", async () => {
    const coreLease = requiredLease(
      await store.claimDueSync("testnet", "catalog-owner"),
    );
    await store.completeCore(coreLease, {
      markets: [perpMarket(0, "", "BTC")],
      quarantined: [],
      sourceErrors: [],
    });
    expect(await store.readPublished("testnet")).toBeNull();

    await makeDue(sql, "testnet");
    const builderLease = requiredLease(
      await store.claimDueSync("testnet", "catalog-owner"),
    );
    expect(builderLease).toMatchObject({
      coreReady: true,
      buildingGeneration: 1,
      nextBuilderOffset: 0,
    });
    const builderCatalog: MarketCatalog = {
      markets: [perpMarket(0, "", "BTC"), perpMarket(1, "alpha", "ALPHA")],
      quarantined: [],
      sourceErrors: [],
      builderPage: {
        offset: 0,
        limit: 37,
        total: 1,
        dexes: [{ index: 1, name: "alpha", fullName: "Alpha DEX" }],
      },
    };
    await expect(
      store.completeBuilderPage(builderLease, builderCatalog),
    ).resolves.toEqual({ published: true });

    const published = await store.readPublished("testnet");
    expect(published).toMatchObject({
      network: "testnet",
      generation: 1,
      catalog: {
        markets: [{ canonicalId: "perp:0:0" }, { canonicalId: "perp:1:0" }],
      },
    });

    await makeDue(sql, "testnet");
    const nextLease = requiredLease(
      await store.claimDueSync("testnet", "catalog-owner"),
    );
    expect(nextLease).toMatchObject({
      publishedGeneration: 1,
      buildingGeneration: 2,
      coreReady: false,
    });
    expect((await store.readPublished("testnet"))?.generation).toBe(1);
    await store.recordFailure(nextLease);
  });

  test("retains the published builder catalog when enumeration repeatedly fails", async () => {
    const initialCoreLease = requiredLease(
      await store.claimDueSync("testnet", "catalog-owner"),
    );
    await store.completeCore(initialCoreLease, {
      markets: [perpMarket(0, "", "BTC")],
      quarantined: [],
      sourceErrors: [],
    });
    await makeDue(sql, "testnet");
    const initialBuilderLease = requiredLease(
      await store.claimDueSync("testnet", "catalog-owner"),
    );
    await store.completeBuilderPage(initialBuilderLease, {
      markets: [perpMarket(0, "", "BTC"), perpMarket(1, "alpha", "ALPHA")],
      quarantined: [],
      sourceErrors: [],
      builderPage: {
        offset: 0,
        limit: 37,
        total: 1,
        dexes: [{ index: 1, name: "alpha", fullName: "Alpha DEX" }],
      },
    });
    const published = await store.readPublished("testnet");
    expect(published?.generation).toBe(1);

    await makeDue(sql, "testnet");
    const coreLease = requiredLease(
      await store.claimDueSync("testnet", "catalog-owner"),
    );
    expect(coreLease).toMatchObject({
      publishedGeneration: 1,
      buildingGeneration: 2,
      coreReady: false,
    });
    await store.completeCore(coreLease, {
      markets: [perpMarket(0, "", "BTC")],
      quarantined: [],
      sourceErrors: [],
    });

    for (let failure = 1; failure <= 3; failure += 1) {
      await makeDue(sql, "testnet");
      const lease = requiredLease(
        await store.claimDueSync("testnet", "catalog-owner"),
      );
      expect(lease).toMatchObject({
        buildingGeneration: 2,
        coreReady: true,
        pageFailures: failure - 1,
      });
      await expect(
        store.completeBuilderPage(lease, {
          markets: [perpMarket(0, "", "BTC")],
          quarantined: [],
          sourceErrors: [
            { source: "perpDexs", message: "upstream unavailable" },
          ],
          builderPage: { offset: 0, limit: 37, total: 0, dexes: [] },
        }),
      ).resolves.toEqual({ published: failure === 3 });
    }

    expect(await store.readPublished("testnet")).toMatchObject({
      generation: 2,
      catalog: {
        markets: [{ canonicalId: "perp:0:0" }, { canonicalId: "perp:1:0" }],
        sourceErrors: [{ source: "perpDexs" }],
      },
    });
  });

  test("publishes validated sources after bounded bootstrap failures", async () => {
    for (let failure = 1; failure <= 3; failure += 1) {
      const lease = requiredLease(
        await store.claimDueSync("testnet", "catalog-owner"),
      );
      expect(lease).toMatchObject({
        buildingGeneration: 1,
        coreReady: false,
        pageFailures: failure - 1,
      });
      await store.completeCore(lease, {
        markets: [perpMarket(0, "", "BTC")],
        quarantined: [],
        sourceErrors: [
          { source: "spotMetaAndAssetCtxs", message: "upstream unavailable" },
        ],
      });
      await makeDue(sql, "testnet");
    }

    const builderLease = requiredLease(
      await store.claimDueSync("testnet", "catalog-owner"),
    );
    expect(builderLease).toMatchObject({
      buildingGeneration: 1,
      coreReady: true,
      pageFailures: 0,
    });
    await expect(
      store.completeBuilderPage(builderLease, {
        markets: [perpMarket(0, "", "BTC")],
        quarantined: [],
        sourceErrors: [],
        builderPage: { offset: 0, limit: 37, total: 0, dexes: [] },
      }),
    ).resolves.toEqual({ published: true });

    expect(await store.readPublished("testnet")).toMatchObject({
      generation: 1,
      catalog: {
        markets: [{ canonicalId: "perp:0:0" }],
        sourceErrors: [{ source: "spotMetaAndAssetCtxs" }],
      },
    });
  });
});

async function makeDue(sql: SQL, network: "testnet" | "mainnet") {
  await sql`
    UPDATE market_catalog_sync_state
    SET next_attempt_at = clock_timestamp() - interval '1 second'
    WHERE network = ${network}
  `;
}

function perpMarket(
  dexIndex: number,
  dexName: string,
  symbol: string,
): PerpMarket {
  return {
    family: "perp",
    canonicalId: `perp:${dexIndex}:0`,
    displaySymbol: symbol,
    coin: dexIndex === 0 ? symbol : `${dexName}:${symbol}`,
    dexIndex,
    dexName,
    dexFullName: dexIndex === 0 ? null : `${symbol} DEX`,
    universeIndex: 0,
    orderAssetId: dexIndex === 0 ? 0 : 100_000 + dexIndex * 10_000,
    sizeDecimals: 2,
    pricePrecision: { maxSignificantFigures: 5, maxDecimalPlaces: 4 },
    maxLeverage: 5,
    onlyIsolated: false,
    marginMode: null,
    marginTableId: null,
    lifecycle: "active",
    orderAvailability: "enabled",
    validationReasons: [],
    markPx: "1.0",
  };
}

function requiredLease(
  value: MarketCatalogSyncLease | null,
): MarketCatalogSyncLease {
  expect(value).not.toBeNull();
  if (!value) throw new Error("market catalog sync lease was not claimed");
  return value;
}
