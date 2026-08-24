import { Button } from "heroui-native/button";
import { Card } from "heroui-native/card";
import { Input } from "heroui-native/input";
import { Label } from "heroui-native/label";
import { TextField } from "heroui-native/text-field";
import type { JSX } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { View } from "react-native";

import { AppText as Text } from "../../components/app-text";
import { MarketActivity } from "../../components/order-book/market-activity";
import { COMPACT_SEGMENT_HIT_SLOP } from "../../components/ui/control-metrics";
import { UnderlineTabs } from "../../components/ui/underline-tabs";
import { useReducedMotion } from "../../components/use-reduced-motion";
import {
  TRADE_CHART_INTERVALS,
  type TradeChartInterval,
  tradeChartSpec,
} from "./market-chart-config";

const ORDER_TYPE_TABS = [
  { label: "Market", value: "market" },
  { label: "Limit", value: "limit" },
] as const;
const SIZE_PRESETS = [25, 50, 75, 100] as const;

function EmptyStat({ label }: { readonly label: string }): JSX.Element {
  return (
    <View className="gap-1">
      <Text className="text-xs uppercase tracking-wide text-muted">
        {label}
      </Text>
      <Text className="font-mono text-base text-foreground">-</Text>
    </View>
  );
}

export function TradeMarketSummaryPlaceholder({
  unavailable = false,
}: {
  readonly unavailable?: boolean;
}): JSX.Element {
  return (
    <Card
      accessibilityLabel={
        unavailable ? "Market summary unavailable" : "Market summary loading"
      }
      className="gap-3"
      variant="default"
    >
      <Card.Header className="flex-row items-start justify-between gap-3">
        <View className="min-w-0 flex-1 gap-1">
          <Card.Title className="text-xl">-</Card.Title>
          <Card.Description>-</Card.Description>
        </View>
        <View className="items-end gap-1">
          <Text className="font-mono text-2xl font-semibold text-foreground">
            -
          </Text>
          <Text className="text-sm tabular-nums text-muted">- · 24h</Text>
        </View>
      </Card.Header>
      <Card.Body className="flex-row flex-wrap items-end gap-x-4 gap-y-2">
        <View className="min-w-28 flex-1">
          <EmptyStat label="24h volume" />
        </View>
        <View className="min-w-24 flex-1">
          <EmptyStat label="Funding" />
        </View>
        <View className="min-w-28 flex-1">
          <EmptyStat label="Open interest" />
        </View>
      </Card.Body>
    </Card>
  );
}

export function TradeChartPlaceholder({
  interval,
  onIntervalChange,
  unavailable = false,
}: {
  readonly interval: TradeChartInterval;
  readonly onIntervalChange: (interval: TradeChartInterval) => void;
  readonly unavailable?: boolean;
}): JSX.Element {
  const reducedMotion = useReducedMotion();
  const spec = tradeChartSpec(interval);

  return (
    <Card
      accessibilityLabel={
        unavailable ? "Price chart unavailable" : "Price chart loading"
      }
      className="gap-2"
      variant="default"
    >
      <Card.Header className="flex-row flex-wrap items-start justify-between gap-3">
        <View className="min-w-40 flex-1 gap-1">
          <Card.Title>Price chart</Card.Title>
          <Card.Description>
            {spec.windowLabel} · {spec.label} · Live
          </Card.Description>
        </View>
        <View
          accessibilityLabel="Green candles closed higher. Red candles closed lower."
          className="flex-row items-center gap-3"
        >
          <View className="flex-row items-center gap-1.5">
            <View className="size-2 rounded-full bg-success" />
            <Text className="text-xs text-muted">Up</Text>
          </View>
          <View className="flex-row items-center gap-1.5">
            <View className="size-2 rounded-full bg-danger" />
            <Text className="text-xs text-muted">Down</Text>
          </View>
        </View>
      </Card.Header>
      <Card.Body className="gap-2.5">
        <View accessibilityRole="tablist" className="flex-row gap-2">
          {TRADE_CHART_INTERVALS.map((option) => {
            const selected = option.interval === interval;
            return (
              <Button
                accessibilityHint={`Shows ${option.windowLabel} using ${option.label} candles.`}
                accessibilityState={{ selected }}
                animation={reducedMotion ? "disable-all" : undefined}
                className="h-10 min-h-10 flex-1 px-2"
                hitSlop={COMPACT_SEGMENT_HIT_SLOP}
                key={option.interval}
                onPress={() => onIntervalChange(option.interval)}
                size="sm"
                variant={selected ? "primary" : "tertiary"}
              >
                {option.label}
              </Button>
            );
          })}
        </View>
        <View
          accessibilityElementsHidden
          className="min-h-52"
          importantForAccessibility="no-hide-descendants"
        />
      </Card.Body>
    </Card>
  );
}

export function TradeOrderEntryPlaceholder({
  splitWorkspace,
  unavailable = false,
}: {
  readonly splitWorkspace: boolean;
  readonly unavailable?: boolean;
}): JSX.Element {
  const reducedMotion = useReducedMotion();
  const style: StyleProp<ViewStyle> = splitWorkspace
    ? { flex: 1.35 }
    : undefined;

  return (
    <Card
      accessibilityLabel={
        unavailable ? "Order entry unavailable" : "Order entry loading"
      }
      className={splitWorkspace ? "gap-3" : "gap-4"}
      style={style}
      variant="default"
    >
      <Card.Header
        className="flex-row items-center gap-2"
        testID="order-type-settings-row"
      >
        <View className="min-w-0 flex-1">
          <UnderlineTabs
            accessibilityLabel="Order type"
            compact={splitWorkspace}
            isDisabled
            onValueChange={() => undefined}
            options={ORDER_TYPE_TABS}
            value="market"
          />
        </View>
        <Button
          accessibilityLabel="Order settings"
          animation={reducedMotion ? "disable-all" : undefined}
          className="h-10 min-h-10 min-w-0 max-w-36 px-2"
          isDisabled
          size="sm"
          variant="ghost"
        >
          Settings
        </Button>
      </Card.Header>
      <Card.Body className={splitWorkspace ? "gap-3" : "gap-5"}>
        <TextField
          animation={reducedMotion ? "disable-all" : undefined}
          isDisabled
        >
          <Label>Size</Label>
          <Input
            accessibilityLabel="Size"
            className="font-mono"
            editable={false}
            placeholder="0"
            value=""
          />
        </TextField>

        <View className="gap-2">
          <Text className="text-sm font-medium text-foreground">
            Size presets
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {SIZE_PRESETS.map((percentage) => (
              <Button
                animation={reducedMotion ? "disable-all" : undefined}
                className={
                  splitWorkspace
                    ? "h-10 min-h-10 min-w-0 flex-1 px-1"
                    : "min-h-12 min-w-20 flex-1"
                }
                hitSlop={splitWorkspace ? COMPACT_SEGMENT_HIT_SLOP : undefined}
                isDisabled
                key={percentage}
                size="sm"
                variant="secondary"
              >
                {percentage}%
              </Button>
            ))}
          </View>
        </View>

        <View
          className="flex-row items-center justify-between gap-4"
          testID="available-funds-row"
        >
          <Text className="min-w-0 flex-1 text-xs uppercase tracking-wide text-muted">
            Available margin
          </Text>
          <Text className="shrink-0 text-right text-base tabular-nums text-foreground">
            -
          </Text>
        </View>
      </Card.Body>
      <Card.Footer className="flex-col gap-2" testID="execution-action-rail">
        <Button className="min-h-12 w-full" isDisabled variant="primary">
          Buy / Long
        </Button>
        <Button className="min-h-12 w-full" isDisabled variant="danger">
          Sell / Short
        </Button>
      </Card.Footer>
    </Card>
  );
}

export function TradeActivityPlaceholder({
  splitWorkspace,
  unavailable = false,
}: {
  readonly splitWorkspace: boolean;
  readonly unavailable?: boolean;
}): JSX.Element {
  return (
    <MarketActivity
      book={undefined}
      bookLoading={!unavailable}
      bookUnavailable={unavailable}
      compact={splitWorkspace}
      style={splitWorkspace ? { flex: 1 } : undefined}
      trades={undefined}
      tradesLoading={!unavailable}
      tradesUnavailable={unavailable}
    />
  );
}
