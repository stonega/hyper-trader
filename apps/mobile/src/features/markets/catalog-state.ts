export interface CatalogStateInput {
  readonly hasData: boolean;
  readonly marketCount: number;
  readonly isPending: boolean;
  readonly isPaused: boolean;
  readonly isFetching: boolean;
  readonly hasError: boolean;
  readonly isStale: boolean;
  readonly isOnline: boolean;
  readonly sourceErrorCount: number;
  readonly quarantinedCount: number;
}

export interface CatalogPresentationState {
  readonly content: "loading" | "ready" | "empty" | "unavailable";
  readonly freshness: "fresh" | "refreshing" | "stale" | "offline";
  readonly preservesTrustworthyData: boolean;
  readonly hasPartialSources: boolean;
  readonly hasQuarantinedMarkets: boolean;
  readonly canRetry: boolean;
  readonly statusLabel: string;
}

function deriveContent(
  input: CatalogStateInput,
): CatalogPresentationState["content"] {
  if (!input.hasData && !input.isOnline && input.isPaused) {
    return "unavailable";
  }
  if (input.isPending && !input.hasData) {
    return "loading";
  }
  if (input.hasData && input.marketCount > 0) {
    return "ready";
  }
  return input.hasError ? "unavailable" : "empty";
}

function deriveFreshness(
  input: CatalogStateInput,
  hasContent: boolean,
): CatalogPresentationState["freshness"] {
  if (!input.isOnline) {
    return "offline";
  }
  if (input.isFetching && hasContent) {
    return "refreshing";
  }
  return input.isStale || (input.hasError && hasContent) ? "stale" : "fresh";
}

export function deriveCatalogPresentationState(
  input: CatalogStateInput,
): CatalogPresentationState {
  const hasContent = input.hasData && input.marketCount > 0;
  const content = deriveContent(input);
  const freshness = deriveFreshness(input, hasContent);
  const hasPartialSources = input.sourceErrorCount > 0;

  const statusLabel = (() => {
    if (content === "loading") {
      return "Loading the validated market catalog.";
    }
    if (content === "unavailable") {
      return input.isOnline
        ? "Market catalog unavailable. Retry the request."
        : "Offline with no saved market catalog.";
    }
    if (content === "empty") {
      return hasPartialSources
        ? "Available catalog sources returned no validated markets."
        : "No validated markets are available.";
    }
    if (freshness === "offline") {
      return "Offline. Showing the last trustworthy saved catalog.";
    }
    if (freshness === "stale") {
      return "Showing saved market data while refresh is unavailable.";
    }
    if (freshness === "refreshing") {
      return "Showing current market data while refreshing.";
    }
    if (hasPartialSources) {
      return "Some catalog sources are unavailable; validated markets remain visible.";
    }
    return "Validated market catalog is current.";
  })();

  return {
    content,
    freshness,
    preservesTrustworthyData: hasContent && (input.hasError || !input.isOnline),
    hasPartialSources,
    hasQuarantinedMarkets: input.quarantinedCount > 0,
    canRetry:
      content === "unavailable" || freshness === "stale" || hasPartialSources,
    statusLabel,
  };
}
