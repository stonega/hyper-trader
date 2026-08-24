import type { MarketSummary } from "@hyper-trader/hyperliquid/public";
import type { JSX } from "react";
import { useState } from "react";
import { Image, View } from "react-native";

import { AppText as Text } from "../../components/app-text";
import { marketIconSymbol, marketIconUri } from "./market-icon-model";

function fallbackLabel(market: MarketSummary): string {
  const symbol = marketIconSymbol(market) ?? market.displaySymbol;
  const normalized = symbol.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return normalized.slice(0, 2) || "?";
}

export function MarketIcon({
  market,
}: {
  readonly market: MarketSummary;
}): JSX.Element {
  const uri = marketIconUri(market);
  const [failed, setFailed] = useState(false);

  return (
    <View
      accessibilityElementsHidden
      className="h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-accent/10"
      importantForAccessibility="no-hide-descendants"
      testID="market-icon"
    >
      <Text className="text-xs font-semibold text-accent">
        {fallbackLabel(market)}
      </Text>
      {uri && !failed ? (
        <Image
          className="absolute inset-0 h-9 w-9 rounded-full"
          onError={() => setFailed(true)}
          resizeMode="contain"
          source={{ uri }}
          testID="market-icon-image"
        />
      ) : null}
    </View>
  );
}
