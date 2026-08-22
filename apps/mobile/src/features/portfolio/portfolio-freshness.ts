import type { PortfolioFreshness } from "./portfolio-query";

/**
 * A background refresh does not invalidate the snapshot already on screen.
 * Final action confirmation still performs its own authoritative refresh.
 */
export function portfolioEvidenceAllowsReview(
  freshness: PortfolioFreshness,
): boolean {
  return freshness === "fresh" || freshness === "refreshing";
}
