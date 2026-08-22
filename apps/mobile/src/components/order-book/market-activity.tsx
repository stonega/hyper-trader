import type {
  L2Book,
  L2Level,
  RecentTrade,
} from "@hyper-trader/hyperliquid/public";
import { Button } from "heroui-native/button";
import { Card } from "heroui-native/card";
import type { JSX } from "react";
import { useState } from "react";
import { type StyleProp, View, type ViewStyle } from "react-native";

import { AppText as Text } from "../app-text";
import { UnderlineTabs } from "../ui/underline-tabs";

type ActivityMode = "book" | "trades";

const ACTIVITY_TABS = [
  { label: "Book", value: "book" },
  { label: "Trades", value: "trades" },
] as const;

function LevelRow({
  side,
  level,
  compact,
  onSelectPrice,
}: {
  readonly side: "Ask" | "Bid";
  readonly level: L2Level;
  readonly compact: boolean;
  readonly onSelectPrice?: (price: string) => void;
}) {
  if (compact) {
    const content = (
      <>
        <Text
          className={`w-7 text-xs font-medium ${side === "Ask" ? "text-danger" : "text-success"}`}
        >
          {side}
        </Text>
        <Text
          adjustsFontSizeToFit
          className="flex-1 text-right font-mono text-xs text-foreground"
          numberOfLines={1}
        >
          {level.price}
        </Text>
        <Text
          adjustsFontSizeToFit
          className="flex-1 text-right font-mono text-xs text-muted"
          numberOfLines={1}
        >
          {level.size}
        </Text>
      </>
    );
    return onSelectPrice ? (
      <Button
        accessibilityLabel={`${side}, price ${level.price}, size ${level.size}, ${level.orderCount} orders`}
        accessibilityHint="Sets this price on a limit order."
        className="h-10 min-h-10 w-full flex-row items-baseline justify-start gap-1 px-0 py-1"
        onPress={() => onSelectPrice(level.price)}
        size="sm"
        variant="ghost"
      >
        {content}
      </Button>
    ) : (
      <View
        accessible
        accessibilityLabel={`${side}, price ${level.price}, size ${level.size}, ${level.orderCount} orders`}
        className="flex-row items-baseline gap-1 py-1"
      >
        {content}
      </View>
    );
  }
  const content = (
    <>
      <Text className="min-w-10 text-xs font-medium text-muted">{side}</Text>
      <Text className="flex-1 text-right font-mono text-sm text-foreground">
        {level.price}
      </Text>
      <Text className="min-w-24 text-right font-mono text-sm text-muted">
        {level.size} · {level.orderCount} orders
      </Text>
    </>
  );
  return onSelectPrice ? (
    <Button
      accessibilityLabel={`${side}, price ${level.price}, size ${level.size}, ${level.orderCount} orders`}
      accessibilityHint="Sets this price on a limit order."
      className="min-h-12 w-full flex-row flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-0 py-1"
      onPress={() => onSelectPrice(level.price)}
      variant="ghost"
    >
      {content}
    </Button>
  ) : (
    <View className="flex-row flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-1">
      {content}
    </View>
  );
}

function TradeRow({
  trade,
  compact,
}: {
  readonly trade: RecentTrade;
  readonly compact: boolean;
}) {
  const side =
    trade.side === "B"
      ? "Buyer initiated"
      : trade.side === "A"
        ? "Seller initiated"
        : trade.side;
  if (compact) {
    const shortSide =
      trade.side === "B" ? "Buy" : trade.side === "A" ? "Sell" : trade.side;
    return (
      <View
        accessible
        accessibilityLabel={`${side}, price ${trade.price}, size ${trade.size}`}
        className="flex-row items-baseline gap-1 py-1"
      >
        <Text
          className={`w-7 text-xs font-medium ${trade.side === "B" ? "text-success" : trade.side === "A" ? "text-danger" : "text-muted"}`}
        >
          {shortSide}
        </Text>
        <Text
          adjustsFontSizeToFit
          className="flex-1 text-right font-mono text-xs text-foreground"
          numberOfLines={1}
        >
          {trade.price}
        </Text>
        <Text
          adjustsFontSizeToFit
          className="flex-1 text-right font-mono text-xs text-muted"
          numberOfLines={1}
        >
          {trade.size}
        </Text>
      </View>
    );
  }
  return (
    <View className="flex-row flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-1">
      <Text className="min-w-28 text-xs font-medium text-muted">{side}</Text>
      <Text className="flex-1 text-right font-mono text-sm text-foreground">
        {trade.price}
      </Text>
      <Text className="min-w-20 text-right font-mono text-sm text-muted">
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
  onSelectPrice,
  compact = false,
  style,
}: {
  readonly book: L2Book | undefined;
  readonly bookLoading: boolean;
  readonly bookUnavailable: boolean;
  readonly trades: readonly RecentTrade[] | undefined;
  readonly tradesLoading: boolean;
  readonly tradesUnavailable: boolean;
  readonly onSelectPrice?: (price: string) => void;
  readonly compact?: boolean;
  readonly style?: StyleProp<ViewStyle>;
}): JSX.Element {
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
    <Card
      className={compact ? "gap-2" : "gap-3"}
      style={style}
      variant="default"
    >
      <Card.Header className={compact ? "gap-2" : "gap-3"}>
        {!compact ? (
          <View className="gap-1">
            <Card.Title>Market activity</Card.Title>
            <Card.Description>
              Current order levels or recent trades
            </Card.Description>
          </View>
        ) : null}
        <UnderlineTabs
          accessibilityLabel="Market activity view"
          compact={compact}
          onValueChange={setMode}
          options={ACTIVITY_TABS}
          value={mode}
        />
      </Card.Header>
      <Card.Body className="gap-1">
        {compact && !empty ? (
          <View className="flex-row gap-1 pb-1">
            <Text className="w-7 text-xs text-muted">Side</Text>
            <Text className="flex-1 text-right text-xs text-muted">Price</Text>
            <Text className="flex-1 text-right text-xs text-muted">Size</Text>
          </View>
        ) : null}
        {mode === "book"
          ? bookRows.map((row) => (
              <LevelRow
                compact={compact}
                key={`${row.side}:${row.level.price}`}
                onSelectPrice={onSelectPrice}
                {...row}
              />
            ))
          : tradeRows.map((trade) => (
              <TradeRow
                compact={compact}
                key={`${trade.time}:${trade.tradeId}`}
                trade={trade}
              />
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
