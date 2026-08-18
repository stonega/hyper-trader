import type {
  L2Book,
  L2Level,
  RecentTrade,
} from "@hyper-trader/hyperliquid/public";
import { Button } from "heroui-native/button";
import { Card } from "heroui-native/card";
import type { JSX } from "react";
import { useState } from "react";
import { View } from "react-native";

import { AppText as Text } from "../app-text";
import { useReducedMotion } from "../use-reduced-motion";

type ActivityMode = "book" | "trades";

function LevelRow({
  side,
  level,
}: {
  readonly side: "Ask" | "Bid";
  readonly level: L2Level;
}) {
  return (
    <View className="flex-row flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-1">
      <Text className="min-w-10 text-xs font-medium text-muted">{side}</Text>
      <Text className="flex-1 text-right text-sm tabular-nums text-foreground">
        {level.price}
      </Text>
      <Text className="min-w-24 text-right text-sm tabular-nums text-muted">
        {level.size} · {level.orderCount} orders
      </Text>
    </View>
  );
}

function TradeRow({ trade }: { readonly trade: RecentTrade }) {
  const side =
    trade.side === "B"
      ? "Buyer initiated"
      : trade.side === "A"
        ? "Seller initiated"
        : trade.side;
  return (
    <View className="flex-row flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-1">
      <Text className="min-w-28 text-xs font-medium text-muted">{side}</Text>
      <Text className="flex-1 text-right text-sm tabular-nums text-foreground">
        {trade.price}
      </Text>
      <Text className="min-w-20 text-right text-sm tabular-nums text-muted">
        {trade.size}
      </Text>
    </View>
  );
}

export function MarketActivity({
  book,
  bookLoading,
  bookUnavailable,
  trades,
  tradesLoading,
  tradesUnavailable,
}: {
  readonly book: L2Book | undefined;
  readonly bookLoading: boolean;
  readonly bookUnavailable: boolean;
  readonly trades: readonly RecentTrade[] | undefined;
  readonly tradesLoading: boolean;
  readonly tradesUnavailable: boolean;
}): JSX.Element {
  const reducedMotion = useReducedMotion();
  const [mode, setMode] = useState<ActivityMode>("book");
  const bookRows = book
    ? [
        ...book.asks
          .slice(0, 4)
          .reverse()
          .map((level) => ({ side: "Ask" as const, level })),
        ...book.bids
          .slice(0, 4)
          .map((level) => ({ side: "Bid" as const, level })),
      ]
    : [];
  const tradeRows = trades?.slice(0, 8) ?? [];
  const empty =
    mode === "book" ? bookRows.length === 0 : tradeRows.length === 0;
  const loading = mode === "book" ? bookLoading : tradesLoading;
  const unavailable = mode === "book" ? bookUnavailable : tradesUnavailable;

  return (
    <Card variant="default" className="gap-3">
      <Card.Header className="gap-3">
        <View className="gap-1">
          <Card.Title>Market activity</Card.Title>
          <Card.Description>
            Current order levels or recent trades
          </Card.Description>
        </View>
        <View className="flex-row flex-wrap gap-2">
          {(["book", "trades"] as const).map((value) => (
            <Button
              accessibilityState={{ selected: mode === value }}
              animation={reducedMotion ? "disable-all" : undefined}
              className="min-h-12 min-w-28 flex-1"
              key={value}
              onPress={() => setMode(value)}
              size="sm"
              variant={mode === value ? "primary" : "secondary"}
            >
              {value === "book" ? "Order book" : "Recent trades"}
            </Button>
          ))}
        </View>
      </Card.Header>
      <Card.Body className="gap-1">
        {mode === "book"
          ? bookRows.map((row) => (
              <LevelRow key={`${row.side}:${row.level.price}`} {...row} />
            ))
          : tradeRows.map((trade) => (
              <TradeRow key={trade.tradeId} trade={trade} />
            ))}
        {empty ? (
          <Text
            accessibilityRole={unavailable ? "alert" : undefined}
            className="text-sm leading-5 text-muted"
          >
            {loading
              ? `Loading ${mode === "book" ? "order-book levels" : "recent trades"}.`
              : unavailable
                ? "Current market activity is unavailable. No rows are inferred."
                : "No current activity rows are available."}
          </Text>
        ) : null}
        {!empty && unavailable ? (
          <Text
            accessibilityRole="alert"
            className="text-sm leading-5 text-warning"
          >
            Cached {mode === "book" ? "order-book levels" : "recent trades"}{" "}
            remain visible while the current refresh is unavailable.
          </Text>
        ) : null}
      </Card.Body>
    </Card>
  );
}
