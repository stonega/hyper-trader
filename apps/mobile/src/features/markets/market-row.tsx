import Ionicons from "@expo/vector-icons/Ionicons";
import type { MarketSummary } from "@hyper-trader/hyperliquid/public";
import { Button } from "heroui-native/button";
import { useThemeColor } from "heroui-native/hooks";
import type { JSX } from "react";
import { memo } from "react";

import { useReducedMotion } from "../../components/use-reduced-motion";
import { marketDisplayLabel, marketPairLabel } from "./discovery";
import { MarketCard } from "./market-card";

export const MarketRow = memo(function MarketRow({
  market,
  isFavorite,
  preferencesReady,
  onToggleFavorite,
  onOpen,
}: {
  readonly market: MarketSummary;
  readonly isFavorite: boolean;
  readonly preferencesReady: boolean;
  readonly onToggleFavorite: (canonicalId: string) => void;
  readonly onOpen: (market: MarketSummary) => void;
}): JSX.Element {
  const reducedMotion = useReducedMotion();
  const warning = useThemeColor("warning");
  const label =
    market.family === "outcome"
      ? marketDisplayLabel(market)
      : marketPairLabel(market);
  return (
    <MarketCard
      footer={
        <>
          <Button
            accessibilityLabel={
              isFavorite
                ? `Remove ${label} from favorites`
                : `Add ${label} to favorites`
            }
            accessibilityState={{ selected: isFavorite }}
            animation={reducedMotion ? "disable-all" : undefined}
            className="min-h-11 flex-1 gap-2"
            isDisabled={!preferencesReady}
            onPress={() => onToggleFavorite(market.canonicalId)}
            size="sm"
            variant="ghost"
          >
            <Ionicons
              accessibilityElementsHidden
              color={warning}
              importantForAccessibility="no-hide-descendants"
              name={isFavorite ? "star" : "star-outline"}
              size={18}
            />
            <Button.Label className="text-warning">
              {isFavorite ? "Favorited" : "Favorite"}
            </Button.Label>
          </Button>
          <Button
            accessibilityHint="Opens this market in Trade."
            animation={reducedMotion ? "disable-all" : undefined}
            className="min-h-11 flex-1"
            isDisabled={!preferencesReady || market.lifecycle !== "active"}
            onPress={() => onOpen(market)}
            size="sm"
            variant="secondary"
          >
            Open in Trade
          </Button>
        </>
      }
      market={market}
    />
  );
});
