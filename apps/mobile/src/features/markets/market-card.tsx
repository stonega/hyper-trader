import type { MarketSummary } from "@hyper-trader/hyperliquid/public";
import { Card } from "heroui-native/card";
import { Chip } from "heroui-native/chip";
import type { JSX, ReactNode } from "react";
import { View } from "react-native";

import { AppText as Text } from "../../components/app-text";
import {
  marketDisplayLabel,
  marketPairLabel,
  marketPriceChangePercent,
  marketVenueLabel,
} from "./discovery";
import {
  formatCompactDecimal,
  formatFundingRate,
  formatMarketPrice,
  formatPercent,
} from "./format";
import { MarketIcon } from "./market-icon";

function familyLabel(market: MarketSummary): string {
  if (market.family === "perp") {
    return `x${market.maxLeverage}`;
  }
  return market.family === "spot" ? "Spot" : "Outcome";
}

function familyAccessibilityLabel(market: MarketSummary): string {
  return market.family === "perp"
    ? `Maximum leverage x${market.maxLeverage}`
    : `${familyLabel(market)} market`;
}

export function MarketCard({
  market,
  footer,
  showOrderAvailability = false,
  status,
}: {
  readonly market: MarketSummary;
  readonly footer?: ReactNode;
  readonly showOrderAvailability?: boolean;
  readonly status?: ReactNode;
}): JSX.Element {
  const label =
    market.family === "outcome"
      ? marketDisplayLabel(market)
      : marketPairLabel(market);
  const showVenue = market.family !== "perp" || market.dexIndex !== 0;
  const orderable =
    market.orderAvailability === "enabled" && market.lifecycle === "active";

  return (
    <Card variant="default" className="gap-3">
      <Card.Header className="flex-row items-center justify-between gap-3">
        <View className="min-w-0 flex-1 flex-row items-center gap-3">
          <MarketIcon market={market} />
          <View className="min-w-0 flex-1 gap-1">
            <Card.Title numberOfLines={1}>{label}</Card.Title>
            {showVenue ? (
              <Card.Description numberOfLines={1}>
                {marketVenueLabel(market)}
              </Card.Description>
            ) : null}
          </View>
        </View>
        <View className="shrink-0 flex-row items-center gap-1.5">
          <Chip
            accessibilityLabel={familyAccessibilityLabel(market)}
            color="accent"
            size="sm"
            variant="soft"
          >
            {familyLabel(market)}
          </Chip>
          {market.family === "perp" &&
          market.dexIndex !== 0 &&
          market.dexName !== "" ? (
            <Chip
              accessibilityLabel={`HIP-3 venue ${market.dexFullName ?? market.dexName}`}
              color="accent"
              size="sm"
              variant="soft"
            >
              {market.dexName}
            </Chip>
          ) : null}
        </View>
      </Card.Header>
      <Card.Body className="gap-3">
        <View
          className="flex-row flex-wrap items-baseline gap-x-3 gap-y-1"
          testID="market-price-summary"
        >
          <Text className="font-mono text-2xl font-semibold tabular-nums text-foreground">
            {formatMarketPrice(market)}
          </Text>
          <Text className="text-sm tabular-nums text-muted">
            24h {formatPercent(marketPriceChangePercent(market))}
          </Text>
        </View>
        <View className="flex-row flex-wrap gap-x-5 gap-y-2">
          <Text className="text-sm text-muted">
            Volume {formatCompactDecimal(market.dayNtlVlm)}
          </Text>
          {market.family === "perp" ? (
            <>
              <Text className="text-sm text-muted">
                Funding {formatFundingRate(market.funding)}
              </Text>
              <Text className="text-sm text-muted">
                Open interest {formatCompactDecimal(market.openInterest)}
              </Text>
            </>
          ) : null}
        </View>
        {status}
        {showOrderAvailability && !orderable ? (
          <View className="flex-row">
            <Chip
              accessibilityLabel="Browse-only market"
              color="warning"
              size="sm"
              variant="soft"
            >
              Browse only
            </Chip>
          </View>
        ) : null}
      </Card.Body>
      {footer ? (
        <Card.Footer className="flex-row gap-3">{footer}</Card.Footer>
      ) : null}
    </Card>
  );
}
