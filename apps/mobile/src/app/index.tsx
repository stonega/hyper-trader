import {
  createHyperliquidClient,
  type MidPrice,
} from "@hyper-trader/hyperliquid";
import { useQuery } from "@tanstack/react-query";
import { Button } from "heroui-native/button";
import { Card } from "heroui-native/card";
import { Chip } from "heroui-native/chip";
import type { JSX } from "react";
import { Alert, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const hyperliquid = createHyperliquidClient({ network: "mainnet" });
const FEATURED_SYMBOLS = ["BTC", "ETH", "SOL", "HYPE"] as const;

function formatUsd(value: string): string {
  const price = Number(value);

  if (!Number.isFinite(price)) {
    return value;
  }

  const maximumFractionDigits = price >= 1_000 ? 0 : price >= 1 ? 2 : 5;

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits,
  }).format(price);
}

function selectFeaturedMarkets(markets: readonly MidPrice[]): MidPrice[] {
  const bySymbol = new Map(markets.map((market) => [market.symbol, market]));

  return FEATURED_SYMBOLS.flatMap((symbol) => {
    const market = bySymbol.get(symbol);
    return market ? [market] : [];
  });
}

function MarketCard({ market }: { market: MidPrice }): JSX.Element {
  return (
    <Card variant="secondary" className="gap-3">
      <Card.Header className="flex-row items-center justify-between">
        <Text className="text-base font-semibold text-surface-secondary-foreground">
          {market.symbol} / USD
        </Text>
        <Chip size="sm" variant="soft" color="default">
          Perpetual
        </Chip>
      </Card.Header>
      <Card.Body>
        <Card.Title className="text-3xl tabular-nums">
          {formatUsd(market.price)}
        </Card.Title>
        <Card.Description>Current Hyperliquid mid price</Card.Description>
      </Card.Body>
    </Card>
  );
}

export default function HomeScreen(): JSX.Element {
  const insets = useSafeAreaInsets();
  const marketsQuery = useQuery({
    queryKey: ["hyperliquid", "all-mids", "mainnet"],
    queryFn: () => hyperliquid.getAllMids(),
    refetchInterval: 15_000,
  });
  const featuredMarkets = selectFeaturedMarkets(marketsQuery.data ?? []);

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="gap-6 px-5 pb-10"
      contentContainerStyle={{ paddingTop: Math.max(insets.top, 24) }}
      refreshControl={
        <RefreshControl
          refreshing={marketsQuery.isRefetching}
          onRefresh={() => void marketsQuery.refetch()}
        />
      }
    >
      <View className="gap-3 pt-2">
        <View className="flex-row items-center justify-between gap-4">
          <Text className="flex-1 text-4xl font-semibold tracking-tight text-foreground">
            Hyper Trader
          </Text>
          <Chip size="sm" variant="secondary" color="success">
            Read only
          </Chip>
        </View>
        <Text className="max-w-lg text-base leading-6 text-muted">
          Live Hyperliquid markets on mobile, with secure order execution built
          as a separate signing flow.
        </Text>
      </View>

      <Card variant="default" className="gap-4">
        <Card.Header className="flex-row items-center justify-between">
          <View className="gap-1">
            <Card.Title>Market connection</Card.Title>
            <Card.Description>Hyperliquid mainnet public API</Card.Description>
          </View>
          <View
            className={
              marketsQuery.isSuccess
                ? "size-2.5 rounded-full bg-success"
                : "size-2.5 rounded-full bg-warning"
            }
          />
        </Card.Header>
        <Card.Footer className="flex-row gap-3">
          <Button
            size="sm"
            variant="secondary"
            isDisabled={marketsQuery.isFetching}
            onPress={() => void marketsQuery.refetch()}
          >
            {marketsQuery.isFetching ? "Refreshing…" : "Refresh prices"}
          </Button>
        </Card.Footer>
      </Card>

      <View className="gap-3">
        <Text className="text-xl font-semibold text-foreground">
          Featured markets
        </Text>

        {marketsQuery.isPending ? (
          <Card variant="secondary">
            <Card.Body>
              <Card.Title>Loading live prices…</Card.Title>
              <Card.Description>
                Connecting to the Hyperliquid info endpoint.
              </Card.Description>
            </Card.Body>
          </Card>
        ) : null}

        {marketsQuery.isError ? (
          <Card variant="secondary">
            <Card.Body>
              <Card.Title className="text-danger">
                Prices unavailable
              </Card.Title>
              <Card.Description>
                {marketsQuery.error instanceof Error
                  ? marketsQuery.error.message
                  : "The market data request failed."}
              </Card.Description>
            </Card.Body>
          </Card>
        ) : null}

        {featuredMarkets.map((market) => (
          <MarketCard key={market.symbol} market={market} />
        ))}
      </View>

      <Card variant="tertiary" className="gap-4">
        <Card.Body>
          <Card.Title>Trading starts with custody</Card.Title>
          <Card.Description>
            Wallet connection and signed orders will be added only with explicit
            confirmation, testnet defaults, and no private-key storage in the
            app.
          </Card.Description>
        </Card.Body>
        <Card.Footer>
          <Button
            className="w-full"
            onPress={() =>
              Alert.alert(
                "Secure signing comes next",
                "This starter intentionally enables market data only. Wallet custody and order confirmation will be designed before trading is activated.",
              )
            }
          >
            Review wallet plan
          </Button>
        </Card.Footer>
      </Card>
    </ScrollView>
  );
}
