import { describe, expect, test } from "bun:test";

import {
  EMPTY_MARKET_PREFERENCES,
  MAX_RECENT_MARKETS,
  parseMarketPreferences,
  recordRecentMarket,
  serializeMarketPreferences,
  toggleFavorite,
} from "./preferences";

describe("public market preferences", () => {
  test("toggles favorites without duplicates", () => {
    const favorite = toggleFavorite(EMPTY_MARKET_PREFERENCES, "spot:7");
    expect(favorite.favoriteIds).toEqual(["spot:7"]);
    expect(toggleFavorite(favorite, "spot:7").favoriteIds).toEqual([]);
  });

  test("bounds and de-duplicates recents while updating last market", () => {
    let preferences = EMPTY_MARKET_PREFERENCES;
    for (let index = 0; index < MAX_RECENT_MARKETS + 5; index += 1) {
      preferences = recordRecentMarket(preferences, `perp:0:${index}`);
    }
    preferences = recordRecentMarket(preferences, "perp:0:10");
    expect(preferences.recentIds).toHaveLength(MAX_RECENT_MARKETS);
    expect(preferences.recentIds[0]).toBe("perp:0:10");
    expect(new Set(preferences.recentIds).size).toBe(MAX_RECENT_MARKETS);
    expect(preferences.lastMarketId).toBe("perp:0:10");
  });

  test("round trips versioned preferences and rejects malformed state", () => {
    const preferences = recordRecentMarket(
      toggleFavorite(EMPTY_MARKET_PREFERENCES, "spot:7"),
      "spot:7",
    );
    expect(
      parseMarketPreferences(
        JSON.parse(serializeMarketPreferences(preferences)),
      ),
    ).toEqual(preferences);
    expect(parseMarketPreferences({ version: 1, favoriteIds: [2] })).toBeNull();
  });

  test("drops the retired catalog mode from saved preferences", () => {
    expect(
      parseMarketPreferences({
        version: 1,
        favoriteIds: [],
        recentIds: [],
        lastMarketId: null,
        catalogMode: "strict",
      }),
    ).toEqual(EMPTY_MARKET_PREFERENCES);
  });
});
