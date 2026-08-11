import type { Candle, Market } from "@hyper-trader/hyperliquid/public";
import { Card } from "heroui-native/card";
import type { JSX } from "react";
import { useMemo } from "react";
import { View } from "react-native";
import { formatMarketPrice } from "../../features/markets/format";
import { AppText as Text } from "../app-text";
import { summarizeCandles } from "./text-chart-model";

function Metric({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <View className="min-w-28 flex-1 gap-1">
      <Text className="text-xs uppercase tracking-wide text-muted">
        {label}
      </Text>
      <Text className="text-sm tabular-nums text-foreground">{value}</Text>
    </View>
  );
}

export function TextMarketChart({
  market,
  candles,
  loading,
  unavailable,
}: {
  readonly market: Market;
  readonly candles: readonly Candle[] | undefined;
  readonly loading: boolean;
  readonly unavailable: boolean;
}): JSX.Element {
  const summary = useMemo(
    () => (candles ? summarizeCandles(candles) : null),
    [candles],
  );
  return (
    <Card variant="default" className="gap-3">
      <Card.Header>
        <View className="gap-1">
          <Card.Title>24 hour chart</Card.Title>
          <Card.Description>
            15 minute closes · text alternative always visible
          </Card.Description>
        </View>
      </Card.Header>
      <Card.Body className="gap-4">
        {summary ? (
          <>
            <Text
              accessibilityLabel={summary.accessibilityLabel}
              className="text-xl leading-8 tracking-widest text-accent"
            >
              {summary.sparkline}
            </Text>
            <View className="flex-row flex-wrap gap-3">
              <Metric label="Open" value={summary.open} />
              <Metric label="High" value={summary.high} />
              <Metric label="Low" value={summary.low} />
              <Metric label="Close" value={summary.close} />
            </View>
          </>
        ) : (
          <View className="gap-2">
            <Text className="text-sm text-foreground">
              Current price · {formatMarketPrice(market)}
            </Text>
            <Text
              accessibilityRole={unavailable ? "alert" : undefined}
              className="text-sm leading-5 text-muted"
            >
              {loading
                ? "Loading the latest chart series. Market summary remains visible."
                : unavailable
                  ? "Chart series is unavailable. No price path is inferred from missing data."
                  : "No chart points are available for this window."}
            </Text>
          </View>
        )}
      </Card.Body>
    </Card>
  );
}
