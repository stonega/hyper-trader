import type { PortfolioFilter } from "./portfolio-model";

export interface PortfolioLoadingSections {
  readonly summary: boolean;
  readonly performance: boolean;
  readonly rows: boolean;
}

function portfolioFilterUsesHistory(filter: PortfolioFilter): boolean {
  return filter === "fills" || filter === "funding" || filter === "activity";
}

export function portfolioLoadingSections(input: {
  readonly hasPortfolio: boolean;
  readonly hasSelectedRange: boolean;
  readonly historyPending: boolean;
  readonly filter: PortfolioFilter;
}): PortfolioLoadingSections {
  const initialLoad = !input.hasPortfolio;
  const selectedHistoryPending =
    input.historyPending && !input.hasSelectedRange;
  return {
    summary: initialLoad || selectedHistoryPending,
    performance: initialLoad || selectedHistoryPending,
    rows:
      initialLoad ||
      (input.historyPending && portfolioFilterUsesHistory(input.filter)),
  };
}
