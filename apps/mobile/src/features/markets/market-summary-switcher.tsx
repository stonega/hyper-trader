import type { HyperliquidNetwork } from "@hyper-trader/hyperliquid/public";
import type { JSX } from "react";
import { useCallback, useDeferredValue, useMemo, useState } from "react";

import { ACTIVE_MARKET_CATALOG_FILTERS } from "./catalog-filter";
import { CatalogStatus } from "./catalog-status";
import { MarketSwitcher } from "./market-switcher";
import { useMarketSummaryPages } from "./query";

const EMPTY_IDS: readonly string[] = [];

export function MarketSummarySwitcher({
  network,
  onClose,
  onSelect,
  selectedCanonicalId,
  visible,
}: {
  readonly network: HyperliquidNetwork;
  readonly onClose: () => void;
  readonly onSelect: (canonicalId: string) => void;
  readonly selectedCanonicalId: string | null;
  readonly visible: boolean;
}): JSX.Element {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const summaryOptions = useMemo(
    () => ({
      query: deferredQuery,
      family: null,
      includeHip3: ACTIVE_MARKET_CATALOG_FILTERS.includeHip3,
      availability: ACTIVE_MARKET_CATALOG_FILTERS.availability,
      lifecycle: ACTIVE_MARKET_CATALOG_FILTERS.lifecycle,
      sort: "volume" as const,
      restrictToIds: false,
      ids: EMPTY_IDS,
    }),
    [deferredQuery],
  );
  const summary = useMarketSummaryPages(network, summaryOptions);
  const loadNextPage = useCallback(() => {
    if (
      !visible ||
      !summary.query.hasNextPage ||
      summary.query.isFetchingNextPage
    ) {
      return;
    }
    void summary.loadNextPage();
  }, [summary, visible]);
  const showStatus =
    summary.presentation.content !== "ready" ||
    summary.presentation.freshness === "stale" ||
    summary.presentation.freshness === "offline" ||
    summary.presentation.hasPartialSources;

  return (
    <MarketSwitcher
      filterQuery={deferredQuery}
      isFetchingNextPage={summary.query.isFetchingNextPage}
      loading={summary.presentation.content === "loading"}
      markets={summary.markets}
      onClose={onClose}
      onEndReached={loadNextPage}
      onQueryChange={setQuery}
      onSelect={onSelect}
      query={query}
      selectedCanonicalId={selectedCanonicalId}
      status={
        showStatus ? (
          <CatalogStatus
            compact
            onRetry={() => void summary.query.refetch()}
            state={summary.presentation}
          />
        ) : undefined
      }
      total={summary.total}
      visible={visible}
    />
  );
}
