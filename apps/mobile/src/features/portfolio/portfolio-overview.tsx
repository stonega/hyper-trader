import { Card } from "heroui-native/card";
import type { JSX } from "react";
import { View } from "react-native";

import { AppText as Text } from "../../components/app-text";
import type { CatalogPresentationState } from "../markets/catalog-state";
import type { PortfolioRangeData } from "./portfolio-model";
import type { PortfolioFreshness } from "./portfolio-query";
import { portfolioAmountTone } from "./portfolio-row-presentation";
import { PortfolioUpdateStatus } from "./portfolio-update-status";

function pnlClassName(
  value: string | null | undefined,
  neutralClassName: "text-foreground" | "text-muted",
): string {
  const tone =
    value === null || value === undefined
      ? "default"
      : portfolioAmountTone(value);
  const colorClassName =
    tone === "success"
      ? "text-success"
      : tone === "danger"
        ? "text-danger"
        : neutralClassName;
  return `text-base tabular-nums ${colorClassName}`;
}

export function PortfolioSummaryCard({
  data,
  loading,
  marketFreshness,
  portfolioFreshness,
}: {
  readonly data: PortfolioRangeData | null;
  readonly loading: boolean;
  readonly marketFreshness: CatalogPresentationState["freshness"];
  readonly portfolioFreshness: PortfolioFreshness;
}): JSX.Element {
  const displayedPortfolioFreshness =
    loading && portfolioFreshness === "fresh"
      ? "refreshing"
      : portfolioFreshness;
  return (
    <Card
      accessibilityLabel={
        loading ? "Loading Portfolio account summary" : undefined
      }
      className="relative"
      variant="default"
    >
      <View className="absolute right-4 top-4 z-10 items-end">
        <PortfolioUpdateStatus
          marketFreshness={marketFreshness}
          portfolioFreshness={displayedPortfolioFreshness}
        />
      </View>
      <Card.Body className="gap-3">
        <Card.Description>Total account value</Card.Description>
        <Card.Title className="font-mono text-4xl tabular-nums">
          {data === null ? "-" : `$${data.accountValue}`}
        </Card.Title>
        <View className="flex-row flex-wrap gap-x-5 gap-y-2">
          <Text className={pnlClassName(data?.absolutePnl, "text-foreground")}>
            PnL {data?.absolutePnl ?? "-"}
          </Text>
          <Text className={pnlClassName(data?.percentagePnl, "text-muted")}>
            {data?.percentagePnl === null || data?.percentagePnl === undefined
              ? "-"
              : `${data.percentagePnl}%`}
          </Text>
        </View>
      </Card.Body>
    </Card>
  );
}

export function PortfolioRowsPlaceholder(): JSX.Element {
  return (
    <View
      accessible
      accessibilityLabel="Loading Portfolio account details"
      className="min-h-12"
    />
  );
}
