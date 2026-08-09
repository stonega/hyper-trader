import type { Market } from "@hyper-trader/hyperliquid/public";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Button } from "heroui-native/button";
import { Card } from "heroui-native/card";
import { Chip } from "heroui-native/chip";
import { Skeleton } from "heroui-native/skeleton";
import type { JSX } from "react";
import { useEffect, useMemo, useState } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ScreenHeading } from "../../components/screen-heading";
import { SetupResumeCard } from "../../components/setup-resume-card";
import { useReducedMotion } from "../../components/use-reduced-motion";
import { useTradingContext } from "../../core/context/provider";
import { CatalogStatus } from "../../features/markets/catalog-status";
import {
  marketDisplayLabel,
  marketPriceChangePercent,
  marketVenueLabel,
} from "../../features/markets/discovery";
import {
  formatCompactDecimal,
  formatMarketPrice,
  formatPercent,
} from "../../features/markets/format";
import { useMarketPreferences } from "../../features/markets/preferences-provider";
import { useMarketCatalogPresentation } from "../../features/markets/query";
import {
  isUsableTradeSelection,
  normalizeMarketRouteParam,
  resolveMarketSelection,
} from "../../features/markets/selection";
import { useUsableTradeMarker } from "../../features/markets/use-usable-trade-marker";

function MarketSummary({ market }: { readonly market: Market }): JSX.Element {
  return (
    <Card variant="default" className="gap-4">
      <Card.Header className="flex-row items-start justify-between gap-3">
        <View className="flex-1 gap-1">
          <Card.Title className="text-2xl">
            {marketDisplayLabel(market)}
          </Card.Title>
          <Card.Description>
            {marketVenueLabel(market)} · {market.canonicalId}
          </Card.Description>
        </View>
        <Chip
          accessibilityLabel={
            market.orderAvailability === "enabled"
              ? "Market metadata permits orders, but trading setup is locked"
              : "Browse-only market"
          }
          color={market.orderAvailability === "enabled" ? "success" : "warning"}
          size="sm"
          variant="soft"
        >
          {market.orderAvailability === "enabled" ? "Validated" : "Browse only"}
        </Chip>
      </Card.Header>
      <Card.Body className="gap-4">
        <Text className="text-4xl font-semibold tabular-nums text-foreground">
          {formatMarketPrice(market)}
        </Text>
        <View className="flex-row flex-wrap gap-x-6 gap-y-3">
          <View className="gap-1">
            <Text className="text-xs uppercase tracking-wide text-muted">
              24h change
            </Text>
            <Text className="text-base tabular-nums text-foreground">
              {formatPercent(marketPriceChangePercent(market))}
            </Text>
          </View>
          <View className="gap-1">
            <Text className="text-xs uppercase tracking-wide text-muted">
              24h volume
            </Text>
            <Text className="text-base tabular-nums text-foreground">
              {formatCompactDecimal(market.dayNtlVlm)}
            </Text>
          </View>
          {market.family === "perp" ? (
            <>
              <View className="gap-1">
                <Text className="text-xs uppercase tracking-wide text-muted">
                  Funding
                </Text>
                <Text className="text-base tabular-nums text-foreground">
                  {formatCompactDecimal(market.funding)}
                </Text>
              </View>
              <View className="gap-1">
                <Text className="text-xs uppercase tracking-wide text-muted">
                  Open interest
                </Text>
                <Text className="text-base tabular-nums text-foreground">
                  {formatCompactDecimal(market.openInterest)}
                </Text>
              </View>
            </>
          ) : null}
        </View>
      </Card.Body>
    </Card>
  );
}

function TradeLoading(): JSX.Element {
  const reducedMotion = useReducedMotion();
  return (
    <View accessibilityLabel="Loading selected Trade market" className="gap-3">
      <Skeleton
        animation={reducedMotion ? "disable-all" : undefined}
        className="h-48 w-full rounded-2xl"
        variant={reducedMotion ? "none" : "shimmer"}
      />
      <Skeleton
        animation={reducedMotion ? "disable-all" : undefined}
        className="h-32 w-full rounded-2xl"
        variant={reducedMotion ? "none" : "shimmer"}
      />
    </View>
  );
}

export default function TradeScreen(): JSX.Element {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ market?: string | string[] }>();
  const { current } = useTradingContext();
  const preferences = useMarketPreferences();
  const { catalog, catalogQuery, presentation } = useMarketCatalogPresentation(
    current.network,
  );
  const reducedMotion = useReducedMotion();
  const [layoutReady, setLayoutReady] = useState(false);
  const requestedMarket = normalizeMarketRouteParam(params.market);
  const selection = useMemo(
    () =>
      preferences.status === "loading"
        ? null
        : resolveMarketSelection(
            catalog?.markets ?? [],
            requestedMarket,
            preferences.preferences.lastMarketId,
          ),
    [
      catalog?.markets,
      preferences.preferences.lastMarketId,
      preferences.status,
      requestedMarket,
    ],
  );
  const usable = isUsableTradeSelection(
    catalog?.markets ?? [],
    selection?.market.canonicalId ?? null,
    layoutReady && presentation.content === "ready",
  );
  useUsableTradeMarker(usable);

  useEffect(() => {
    if (
      selection &&
      preferences.status !== "loading" &&
      (preferences.preferences.lastMarketId !== selection.market.canonicalId ||
        preferences.preferences.recentIds[0] !== selection.market.canonicalId)
    ) {
      preferences.selectMarket(selection.market.canonicalId);
    }
  }, [preferences, selection]);

  const invalidRestoredMarket =
    selection !== null &&
    selection.source === "volume_fallback" &&
    (requestedMarket !== null || preferences.preferences.lastMarketId !== null);
  let marketContent: JSX.Element;
  if (selection) {
    marketContent = <MarketSummary market={selection.market} />;
  } else if (
    presentation.content === "loading" ||
    preferences.status === "loading"
  ) {
    marketContent = <TradeLoading />;
  } else {
    marketContent = (
      <Card variant="secondary">
        <Card.Body>
          <Card.Title>No valid market selected</Card.Title>
          <Card.Description>
            {presentation.content === "unavailable"
              ? "The catalog is unavailable and no trustworthy saved market can be restored."
              : "The current catalog has no valid markets. Retry or use Markets when data becomes available."}
          </Card.Description>
        </Card.Body>
      </Card>
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="gap-5 px-5 pb-10"
      contentContainerStyle={{ paddingTop: Math.max(insets.top, 20) }}
      onLayout={() => setLayoutReady(true)}
      refreshControl={
        <RefreshControl
          accessibilityLabel="Refresh selected market"
          onRefresh={() => void catalogQuery.refetch()}
          refreshing={catalogQuery.isRefetching}
        />
      }
    >
      <ScreenHeading
        title="Trade"
        description="Inspect a validated market in the active global context. Order entry remains locked until its reviewed trading unit is complete."
        network={current.network}
      />

      <Button
        accessibilityHint="Opens the complete searchable catalog without changing account or network."
        animation={reducedMotion ? "disable-all" : undefined}
        className="min-h-12 w-full"
        onPress={() => router.navigate("/(tabs)/markets")}
        variant="secondary"
      >
        {selection
          ? `Switch market · ${marketDisplayLabel(selection.market)}`
          : "Choose a market"}
      </Button>

      {invalidRestoredMarket ? (
        <Text accessibilityRole="alert" className="text-sm text-warning">
          The requested or last market is no longer valid. Trade selected the
          highest-volume current market from the live catalog.
        </Text>
      ) : null}

      {marketContent}

      <CatalogStatus
        onRetry={() => void catalogQuery.refetch()}
        sourceErrors={catalog?.sourceErrors ?? []}
        state={presentation}
      />

      <Card variant="secondary" className="gap-4">
        <Card.Body className="gap-2">
          <Card.Title>Order entry</Card.Title>
          <Card.Description>
            Order entry is currently read-only. A later trading surface will
            validate market, network, price, size, leverage, and slippage before
            review.
          </Card.Description>
          <Text className="text-sm text-warning">
            Locked — no API-wallet authority is active.
          </Text>
        </Card.Body>
        <Card.Footer>
          <Button
            accessibilityHint="Trading remains unavailable; use the setup prompt to save an intent."
            animation={reducedMotion ? "disable-all" : undefined}
            className="min-h-12 w-full"
            isDisabled
          >
            Review order unavailable
          </Button>
        </Card.Footer>
      </Card>

      <SetupResumeCard />
    </ScrollView>
  );
}
