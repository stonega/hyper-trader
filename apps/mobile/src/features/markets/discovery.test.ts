import { describe, expect, test } from "bun:test";

import { discoverMarkets, marketPairLabel } from "./discovery";
import {
  HIP3_DUPLICATE,
  MARKET_FIXTURE,
  NATIVE_DUPLICATE,
  OUTCOME_MARKET,
  SPOT_DUPLICATE,
} from "./fixture";

const defaultOptions = {
  query: "",
  families: [],
  availability: "all",
  lifecycle: "all",
  favoritesOnly: false,
  recentsOnly: false,
  favoriteIds: [],
  recentIds: [],
  sort: "volume",
} as const;

describe("market discovery", () => {
  test("formats concise Trade header labels for each market family", () => {
    expect(marketPairLabel(NATIVE_DUPLICATE)).toBe("DUP-USDC");
    expect(marketPairLabel(SPOT_DUPLICATE)).toBe("DUP-USDC");
    expect(marketPairLabel(OUTCOME_MARKET)).toBe("Higher");
  });

  test("keeps a newly discovered HIP-3 collision searchable by venue and canonical ID", () => {
    const markets = [NATIVE_DUPLICATE, HIP3_DUPLICATE];

    expect(
      discoverMarkets(markets, {
        ...defaultOptions,
        query: "DUP",
      }).map(({ canonicalId }) => canonicalId),
    ).toEqual(["perp:3:9", "perp:0:4"]);

    expect(
      discoverMarkets(markets, {
        ...defaultOptions,
        query: "omega",
      }).map(({ canonicalId }) => canonicalId),
    ).toEqual(["perp:3:9"]);

    expect(
      discoverMarkets(markets, {
        ...defaultOptions,
        query: "perp:0:4",
      }).map(({ canonicalId }) => canonicalId),
    ).toEqual(["perp:0:4"]);
  });

  test("presents the complete catalog, including a new HIP-3 record", () => {
    expect(
      discoverMarkets(MARKET_FIXTURE, defaultOptions).map(
        ({ canonicalId }) => canonicalId,
      ),
    ).toEqual(["perp:3:9", "spot:7", "perp:0:4", "outcome:12:0"]);
    expect(
      discoverMarkets(MARKET_FIXTURE, {
        ...defaultOptions,
        query: "DUP",
      }).map(({ canonicalId }) => canonicalId),
    ).toEqual(["perp:3:9", "spot:7", "perp:0:4"]);
  });

  test("filters native and HIP-3 perps together and keeps other families distinct", () => {
    expect(
      discoverMarkets(MARKET_FIXTURE, {
        ...defaultOptions,
        families: ["perp"],
      }),
    ).toEqual([HIP3_DUPLICATE, NATIVE_DUPLICATE]);
    expect(
      discoverMarkets(MARKET_FIXTURE, {
        ...defaultOptions,
        families: ["spot"],
      }),
    ).toEqual([SPOT_DUPLICATE]);
    expect(
      discoverMarkets(MARKET_FIXTURE, {
        ...defaultOptions,
        families: ["outcome"],
      }),
    ).toEqual([OUTCOME_MARKET]);
  });

  test("filters favorites, recents, lifecycle, and order availability", () => {
    expect(
      discoverMarkets(MARKET_FIXTURE, {
        ...defaultOptions,
        favoritesOnly: true,
        favoriteIds: [SPOT_DUPLICATE.canonicalId],
      }),
    ).toEqual([SPOT_DUPLICATE]);
    expect(
      discoverMarkets(MARKET_FIXTURE, {
        ...defaultOptions,
        recentsOnly: true,
        recentIds: [HIP3_DUPLICATE.canonicalId],
      }),
    ).toEqual([HIP3_DUPLICATE]);
    expect(
      discoverMarkets(MARKET_FIXTURE, {
        ...defaultOptions,
        availability: "browse_only",
      }),
    ).toEqual([OUTCOME_MARKET]);
    expect(
      discoverMarkets([{ ...NATIVE_DUPLICATE, lifecycle: "delisted" }], {
        ...defaultOptions,
        lifecycle: "active",
      }),
    ).toEqual([]);
  });

  test("puts missing numeric values last with deterministic tie breaking", () => {
    expect(
      discoverMarkets(MARKET_FIXTURE, {
        ...defaultOptions,
        sort: "price_change",
      }).at(-1)?.canonicalId,
    ).toBe(OUTCOME_MARKET.canonicalId);
    expect(
      discoverMarkets(MARKET_FIXTURE, {
        ...defaultOptions,
        sort: "funding",
      }).map(({ canonicalId }) => canonicalId),
    ).toEqual(["perp:3:9", "perp:0:4", "outcome:12:0", "spot:7"]);
  });
});
