import { describe, expect, test } from "bun:test";

import { deriveCatalogPresentationState } from "./catalog-state";

const base = {
  hasData: false,
  marketCount: 0,
  isPending: false,
  isPaused: false,
  isFetching: false,
  hasError: false,
  isStale: false,
  isOnline: true,
  sourceErrorCount: 0,
  quarantinedCount: 0,
};

describe("catalog presentation state", () => {
  test("distinguishes initial loading, empty, and unavailable", () => {
    expect(
      deriveCatalogPresentationState({ ...base, isPending: true }).content,
    ).toBe("loading");
    expect(deriveCatalogPresentationState(base).content).toBe("empty");
    expect(
      deriveCatalogPresentationState({ ...base, hasError: true }).content,
    ).toBe("unavailable");
  });

  test("preserves trustworthy cached content for stale and offline failures", () => {
    const offline = deriveCatalogPresentationState({
      ...base,
      hasData: true,
      marketCount: 4,
      hasError: true,
      isOnline: false,
      isStale: true,
    });
    expect(offline.content).toBe("ready");
    expect(offline.freshness).toBe("offline");
    expect(offline.preservesTrustworthyData).toBe(true);
    expect(offline.statusLabel).toContain("last trustworthy");
  });

  test("reports empty-cache offline as unavailable instead of loading forever", () => {
    const offline = deriveCatalogPresentationState({
      ...base,
      isOnline: false,
      isPaused: true,
      isPending: true,
    });
    expect(offline.content).toBe("unavailable");
    expect(offline.statusLabel).toBe("Offline with no saved market catalog.");
  });

  test("exposes partial sources and quarantined records separately", () => {
    const partial = deriveCatalogPresentationState({
      ...base,
      hasData: true,
      marketCount: 4,
      sourceErrorCount: 2,
      quarantinedCount: 3,
    });
    expect(partial.hasPartialSources).toBe(true);
    expect(partial.hasQuarantinedMarkets).toBe(true);
    expect(partial.canRetry).toBe(true);
    expect(partial.statusLabel).toBe(
      "2 market sources could not refresh. Validated markets from other sources remain available.",
    );
  });

  test("summarizes the previous partial pass while a retry is active", () => {
    const refreshing = deriveCatalogPresentationState({
      ...base,
      hasData: true,
      marketCount: 4,
      isFetching: true,
      sourceErrorCount: 37,
    });

    expect(refreshing.freshness).toBe("refreshing");
    expect(refreshing.canRetry).toBe(false);
    expect(refreshing.statusLabel).toBe(
      "Refreshing market coverage. 37 market sources could not refresh in the last pass.",
    );
  });
});
