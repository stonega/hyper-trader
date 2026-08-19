import type { Market } from "@hyper-trader/hyperliquid/public";
import { Button } from "heroui-native/button";
import { Card } from "heroui-native/card";
import { Chip } from "heroui-native/chip";
import type { JSX } from "react";
import { View } from "react-native";

import { AppText as Text } from "../../components/app-text";
import { useReducedMotion } from "../../components/use-reduced-motion";
import {
  marketDisplayLabel,
  marketPairLabel,
  marketPriceChangePercent,
  marketVenueLabel,
} from "./discovery";
import {
  formatCompactDecimal,
  formatMarketPrice,
  formatPercent,
} from "./format";
import { MarketIcon } from "./market-icon";

function familyLabel(market: Market): string {
  if (market.family === "perp") {
    return market.dexIndex === 0 ? "Perpetual" : "HIP-3 perpetual";
  }
  return market.family === "spot" ? "Spot" : "Outcome";
}

export function MarketRow({
  market,
  isFavorite,
  preferencesReady,
  onToggleFavorite,
  onOpen,
}: {
  readonly market: Market;
  readonly isFavorite: boolean;
  readonly preferencesReady: boolean;
  readonly onToggleFavorite: () => void;
  readonly onOpen: () => void;
}): JSX.Element {
  const reducedMotion = useReducedMotion();
  const label =
    market.family === "outcome"
      ? marketDisplayLabel(market)
      : marketPairLabel(market);
  const showVenue = market.family !== "perp" || market.dexIndex !== 0;
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
        <Chip
          accessibilityLabel={`${familyLabel(market)} market`}
          color="accent"
          size="sm"
          variant="soft"
        >
          {familyLabel(market)}
        </Chip>
      </Card.Header>
      <Card.Body className="gap-3">
        <Text className="text-2xl font-semibold tabular-nums text-foreground">
          {formatMarketPrice(market)}
        </Text>
        <View className="flex-row flex-wrap gap-x-5 gap-y-2">
          <Text className="text-sm text-muted">
            24h {formatPercent(marketPriceChangePercent(market))}
          </Text>
          <Text className="text-sm text-muted">
            Volume {formatCompactDecimal(market.dayNtlVlm)}
          </Text>
          {market.family === "perp" ? (
            <>
              <Text className="text-sm text-muted">
                Funding {formatCompactDecimal(market.funding)}
              </Text>
              <Text className="text-sm text-muted">
                Open interest {formatCompactDecimal(market.openInterest)}
              </Text>
            </>
          ) : null}
        </View>
      </Card.Body>
      <Card.Footer className="flex-row gap-3">
        <Button
          accessibilityLabel={
            isFavorite
              ? `Remove ${label} from favorites`
              : `Add ${label} to favorites`
          }
          accessibilityState={{ selected: isFavorite }}
          animation={reducedMotion ? "disable-all" : undefined}
          className="min-h-11 flex-1"
          isDisabled={!preferencesReady}
          onPress={onToggleFavorite}
          size="sm"
          variant="ghost"
        >
          {isFavorite ? "Favorited" : "Favorite"}
        </Button>
        <Button
          accessibilityHint="Opens this market in Trade."
          animation={reducedMotion ? "disable-all" : undefined}
          className="min-h-11 flex-1"
          isDisabled={!preferencesReady || market.lifecycle !== "active"}
          onPress={onOpen}
          size="sm"
          variant="secondary"
        >
          Open in Trade
        </Button>
      </Card.Footer>
    </Card>
  );
}
