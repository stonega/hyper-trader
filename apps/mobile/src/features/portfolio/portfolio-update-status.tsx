import type { JSX } from "react";

import { CompactUpdateStatus } from "../../components/ui/compact-update-status";
import type { CatalogPresentationState } from "../markets/catalog-state";
import type { PortfolioFreshness } from "./portfolio-query";

export function PortfolioUpdateStatus({
  marketFreshness,
  portfolioFreshness,
}: {
  readonly marketFreshness: CatalogPresentationState["freshness"];
  readonly portfolioFreshness: PortfolioFreshness;
}): JSX.Element {
  const warning =
    portfolioFreshness === "stale" ||
    portfolioFreshness === "offline" ||
    marketFreshness === "stale" ||
    marketFreshness === "offline";
  const syncing =
    !warning &&
    (portfolioFreshness === "refreshing" || marketFreshness === "refreshing");
  const status = warning
    ? {
        description: "Some portfolio data may be out of date. Pull to refresh.",
        title: "Refresh needed",
        tone: "warning" as const,
      }
    : syncing
      ? {
          description:
            "Syncing latest portfolio data. You can keep reviewing current data.",
          title: "Updating",
          tone: "success" as const,
        }
      : {
          description: "Portfolio data is current.",
          title: "Up to date",
          tone: "success" as const,
        };

  return (
    <CompactUpdateStatus
      accessibilityRole={warning ? "alert" : "text"}
      description={status.description}
      testID="portfolio-update-status"
      title={status.title}
      tone={status.tone}
    />
  );
}
