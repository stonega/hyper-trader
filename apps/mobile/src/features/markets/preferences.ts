export const MAX_RECENT_MARKETS = 20;

export interface MarketPreferences {
  readonly favoriteIds: readonly string[];
  readonly recentIds: readonly string[];
  readonly lastMarketId: string | null;
}

export const EMPTY_MARKET_PREFERENCES: MarketPreferences = {
  favoriteIds: [],
  recentIds: [],
  lastMarketId: null,
};

function uniqueIds(value: unknown, limit: number): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (typeof candidate !== "string" || candidate.trim() === "") {
      return null;
    }
    const id = candidate.trim();
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
    if (ids.length === limit) {
      break;
    }
  }
  return ids;
}

export function parseMarketPreferences(
  value: unknown,
): MarketPreferences | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.version !== 1) {
    return null;
  }
  const favoriteIds = uniqueIds(record.favoriteIds, Number.MAX_SAFE_INTEGER);
  const recentIds = uniqueIds(record.recentIds, MAX_RECENT_MARKETS);
  const lastMarketId = record.lastMarketId;
  if (
    favoriteIds === null ||
    recentIds === null ||
    (lastMarketId !== null &&
      (typeof lastMarketId !== "string" || lastMarketId.trim() === ""))
  ) {
    return null;
  }
  return {
    favoriteIds,
    recentIds,
    lastMarketId: typeof lastMarketId === "string" ? lastMarketId.trim() : null,
  };
}

export function serializeMarketPreferences(
  preferences: MarketPreferences,
): string {
  return JSON.stringify({ version: 1, ...preferences });
}

export function toggleFavorite(
  preferences: MarketPreferences,
  canonicalId: string,
): MarketPreferences {
  const isFavorite = preferences.favoriteIds.includes(canonicalId);
  return {
    ...preferences,
    favoriteIds: isFavorite
      ? preferences.favoriteIds.filter((id) => id !== canonicalId)
      : [...preferences.favoriteIds, canonicalId],
  };
}

export function recordRecentMarket(
  preferences: MarketPreferences,
  canonicalId: string,
): MarketPreferences {
  if (
    preferences.lastMarketId === canonicalId &&
    preferences.recentIds[0] === canonicalId
  ) {
    return preferences;
  }
  return {
    ...preferences,
    lastMarketId: canonicalId,
    recentIds: [
      canonicalId,
      ...preferences.recentIds.filter((id) => id !== canonicalId),
    ].slice(0, MAX_RECENT_MARKETS),
  };
}
