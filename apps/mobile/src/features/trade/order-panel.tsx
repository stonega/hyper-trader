import Ionicons from "@expo/vector-icons/Ionicons";
import type { Market } from "@hyper-trader/hyperliquid/public";
import { Button } from "heroui-native/button";
import { Card } from "heroui-native/card";
import { Dialog } from "heroui-native/dialog";
import { useThemeColor } from "heroui-native/hooks";
import { Input } from "heroui-native/input";
import { Label } from "heroui-native/label";
import { TextField } from "heroui-native/text-field";
import type { JSX } from "react";
import { useEffect, useRef, useState } from "react";
import { type StyleProp, View, type ViewStyle } from "react-native";

import { AppText as Text } from "../../components/app-text";
import { COMPACT_SEGMENT_HIT_SLOP } from "../../components/ui/control-metrics";
import { UnderlineTabs } from "../../components/ui/underline-tabs";
import { useReducedMotion } from "../../components/use-reduced-motion";
import {
  controlsForMarket,
  hasSupportedOrderMetadata,
  sizeForPreset,
  type TradeAuthority,
  type TradeDraft,
  type TradeGate,
} from "./trade-model";

const SIZE_PRESETS = [25, 50, 75, 100] as const;
const SLIPPAGE_PRESETS = [10, 25, 50, 100] as const;
const ORDER_TYPE_TABS = [
  { label: "Market", value: "market" },
  { label: "Limit", value: "limit" },
] as const;

function slippagePercent(bps: number | string): string {
  const value = typeof bps === "number" ? bps : Number(bps);
  return Number.isFinite(value) ? `${value / 100}%` : "—";
}

function SelectorButton({
  label,
  selected,
  onPress,
  compact = false,
}: {
  readonly label: string;
  readonly selected: boolean;
  readonly onPress: () => void;
  readonly compact?: boolean;
}): JSX.Element {
  const reducedMotion = useReducedMotion();
  return (
    <Button
      accessibilityState={{ selected }}
      accessibilityLabel={`${label}${selected ? ", selected" : ""}`}
      animation={reducedMotion ? "disable-all" : undefined}
      className={
        compact
          ? "h-10 min-h-10 min-w-0 flex-1 px-2"
          : "min-h-12 min-w-28 flex-1"
      }
      hitSlop={compact ? COMPACT_SEGMENT_HIT_SLOP : undefined}
      onPress={onPress}
      size={compact ? "sm" : "md"}
      variant={selected ? "primary" : "secondary"}
    >
      {compact ? label : selected ? `Selected · ${label}` : label}
    </Button>
  );
}

export function OrderPanel({
  market,
  authority,
  draft,
  gate,
  invalidationMessage,
  onDraftChange,
  onReview,
  compact = false,
  style,
}: {
  readonly market: Market;
  readonly authority: TradeAuthority;
  readonly draft: TradeDraft;
  readonly gate: TradeGate;
  readonly invalidationMessage: string | null;
  readonly onDraftChange: (draft: TradeDraft) => void;
  readonly onReview: (draft: TradeDraft) => Promise<void>;
  readonly compact?: boolean;
  readonly style?: StyleProp<ViewStyle>;
}): JSX.Element {
  const reducedMotion = useReducedMotion();
  const accent = useThemeColor("accent");
  const [reviewingSide, setReviewingSide] = useState<TradeDraft["side"] | null>(
    null,
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const errorLeverage = useRef(draft.leverage);

  useEffect(() => {
    if (errorLeverage.current === draft.leverage) return;
    errorLeverage.current = draft.leverage;
    setFormError(null);
  }, [draft.leverage]);

  const structurallyOrderable = hasSupportedOrderMetadata(market);
  const controls = controlsForMarket(market, draft.orderType);
  const referencePrice = market.midPx ?? market.markPx ?? null;
  const account = authority.account;
  const leverage = market.family === "spot" ? 1 : (account?.leverage ?? null);
  const formReady =
    draft.size.trim() !== "" &&
    (!controls.price || draft.limitPrice.trim() !== "") &&
    (!controls.leverage || leverage !== null);
  const update = (next: Partial<TradeDraft>) => {
    setFormError(null);
    onDraftChange({ ...draft, ...next });
  };
  const applyPreset = (percentage: (typeof SIZE_PRESETS)[number]) => {
    if (
      account === null ||
      referencePrice === null ||
      leverage === null ||
      market.sizeDecimals === null
    ) {
      setFormError(
        "Current funds, price, leverage, and precision are required for a size preset.",
      );
      return;
    }
    try {
      update({
        size: sizeForPreset({
          availableFunds: account.availableFunds[draft.side],
          referencePrice,
          leverage,
          percentage,
          sizeDecimals: market.sizeDecimals,
        }),
      });
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : "This size preset is unavailable.",
      );
    }
  };
  const review = async (side: TradeDraft["side"]) => {
    if (reviewingSide !== null) return;
    setFormError(null);
    setReviewingSide(side);
    try {
      await onReview(draft.side === side ? draft : { ...draft, side });
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : "Order review could not be opened safely.",
      );
    } finally {
      setReviewingSide(null);
    }
  };

  if (!structurallyOrderable) {
    return (
      <Card
        className={compact ? "gap-2" : "gap-3"}
        style={style}
        variant="secondary"
      >
        <Card.Body className="gap-2">
          <Card.Title>Browse-only market</Card.Title>
          <Card.Description>
            Orders are not available for this market.
          </Card.Description>
          <Text
            accessibilityRole="alert"
            className="text-sm leading-5 text-warning"
          >
            {gate.reason}
          </Text>
        </Card.Body>
      </Card>
    );
  }

  return (
    <Card
      className={compact ? "gap-3" : "gap-4"}
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
            compact={compact}
            onValueChange={(orderType) =>
              update(
                orderType === "market"
                  ? { orderType, reduceOnly: false }
                  : { orderType },
              )
            }
            options={ORDER_TYPE_TABS}
            value={draft.orderType}
          />
        </View>
        <Dialog
          animation={reducedMotion ? "disable-all" : undefined}
          isOpen={advancedOpen}
          onOpenChange={setAdvancedOpen}
        >
          <Dialog.Trigger asChild>
            <Button
              accessibilityHint="Opens leverage and advanced order controls."
              accessibilityLabel="Order settings"
              accessibilityState={{ expanded: advancedOpen }}
              animation={reducedMotion ? "disable-all" : undefined}
              hitSlop={4}
              isIconOnly
              onPress={() => setAdvancedOpen(true)}
              size="sm"
              variant={advancedOpen ? "secondary" : "ghost"}
            >
              <Ionicons
                accessibilityElementsHidden
                color={accent}
                importantForAccessibility="no-hide-descendants"
                name={advancedOpen ? "options" : "options-outline"}
                size={18}
              />
            </Button>
          </Dialog.Trigger>
          <Dialog.Portal unstable_accessibilityContainerViewIsModal>
            <Dialog.Overlay
              animation={reducedMotion ? false : undefined}
              isCloseOnPress
            />
            <Dialog.Content
              animation={reducedMotion ? false : undefined}
              className="gap-5 bg-background"
            >
              <Dialog.Close className="absolute right-3 top-3 z-10" />
              <View className="gap-1 pr-12">
                <Dialog.Title>Order settings</Dialog.Title>
                <Dialog.Description>
                  Review leverage and adjust controls for this order.
                </Dialog.Description>
              </View>
              {controls.leverage ? (
                <View className="gap-1 rounded-xl bg-surface-secondary p-3">
                  <Text className="text-sm font-medium text-foreground">
                    Leverage
                  </Text>
                  <Text className="text-lg font-semibold tabular-nums text-foreground">
                    {leverage === null ? "Unavailable" : `${leverage}× current`}
                  </Text>
                  <Text className="text-xs leading-4 text-muted">
                    {market.family === "perp"
                      ? `${market.maxLeverage}× maximum · Changes require a separate review.`
                      : "Not applicable"}
                  </Text>
                </View>
              ) : null}
              {controls.timeInForce ? (
                <View className="gap-2">
                  <Text className="text-sm font-medium text-foreground">
                    Time in force
                  </Text>
                  <View className="flex-row flex-wrap gap-2">
                    {(["Gtc", "Ioc", "Alo"] as const).map((timeInForce) => (
                      <SelectorButton
                        key={timeInForce}
                        label={
                          compact
                            ? timeInForce === "Alo"
                              ? "Post"
                              : timeInForce.toUpperCase()
                            : timeInForce === "Gtc"
                              ? "Good till canceled"
                              : timeInForce === "Ioc"
                                ? "Immediate or cancel"
                                : "Post only"
                        }
                        compact={compact}
                        selected={draft.timeInForce === timeInForce}
                        onPress={() => update({ timeInForce })}
                      />
                    ))}
                  </View>
                </View>
              ) : null}
              {controls.reduceOnly ? (
                <Button
                  accessibilityState={{ checked: draft.reduceOnly }}
                  animation={reducedMotion ? "disable-all" : undefined}
                  className="min-h-12 w-full"
                  onPress={() => update({ reduceOnly: !draft.reduceOnly })}
                  variant={draft.reduceOnly ? "primary" : "secondary"}
                >
                  Reduce only · {draft.reduceOnly ? "On" : "Off"}
                </Button>
              ) : null}
              {controls.slippage ? (
                <View className="gap-2">
                  <Text className="text-sm font-medium text-foreground">
                    Maximum slippage · {slippagePercent(draft.slippageBps)}
                  </Text>
                  <View className="flex-row flex-wrap gap-2">
                    {SLIPPAGE_PRESETS.map((slippageBps) => (
                      <SelectorButton
                        compact
                        key={slippageBps}
                        label={slippagePercent(slippageBps)}
                        onPress={() =>
                          update({ slippageBps: String(slippageBps) })
                        }
                        selected={draft.slippageBps === String(slippageBps)}
                      />
                    ))}
                  </View>
                </View>
              ) : null}
              <Button
                animation={reducedMotion ? "disable-all" : undefined}
                className="min-h-12 w-full"
                onPress={() => setAdvancedOpen(false)}
                variant="secondary"
              >
                Done
              </Button>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog>
      </Card.Header>
      <Card.Body className={compact ? "gap-3" : "gap-5"}>
        {controls.price ? (
          <TextField animation={reducedMotion ? "disable-all" : undefined}>
            <Label>Limit price</Label>
            <Input
              accessibilityHint="Uses the selected market's current decimal and significant-figure limits."
              keyboardType="decimal-pad"
              onChangeText={(limitPrice) => update({ limitPrice })}
              placeholder="0"
              returnKeyType="next"
              value={draft.limitPrice}
            />
          </TextField>
        ) : null}

        <TextField animation={reducedMotion ? "disable-all" : undefined}>
          <Label>Size</Label>
          <Input
            accessibilityHint="Order size in base units. Precision is validated again before review."
            keyboardType="decimal-pad"
            onChangeText={(size) => update({ size })}
            placeholder="0"
            returnKeyType="done"
            value={draft.size}
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
                  compact
                    ? "h-10 min-h-10 min-w-0 flex-1 px-1"
                    : "min-h-12 min-w-20 flex-1"
                }
                hitSlop={compact ? COMPACT_SEGMENT_HIT_SLOP : undefined}
                isDisabled={
                  account === null ||
                  referencePrice === null ||
                  leverage === null
                }
                key={percentage}
                onPress={() => applyPreset(percentage)}
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
            Available {market.family === "spot" ? "funds" : "margin"}
          </Text>
          <Text className="shrink-0 text-right text-base tabular-nums text-foreground">
            {account?.availableFunds[draft.side] ?? "Unavailable"}
          </Text>
        </View>

        {invalidationMessage ? (
          <Text
            accessibilityRole="alert"
            className="text-sm leading-5 text-warning"
          >
            Draft reset · {invalidationMessage}
          </Text>
        ) : null}
        <Text
          accessibilityLiveRegion="polite"
          className={
            compact
              ? "text-xs leading-4 text-warning"
              : "text-sm leading-5 text-warning"
          }
        >
          {gate.reason}
        </Text>
        {formError ? (
          <Text
            accessibilityRole="alert"
            className="text-sm leading-5 text-danger"
          >
            {formError}
          </Text>
        ) : null}
        {!formReady && gate.enabled ? (
          <Text className="text-sm leading-5 text-muted">
            Enter all visible required values before review.
          </Text>
        ) : null}
      </Card.Body>
      <Card.Footer className="gap-2">
        <Button
          accessibilityHint="Opens a buy order review. Nothing is signed yet."
          animation={reducedMotion ? "disable-all" : undefined}
          className="min-h-12 w-full"
          isDisabled={!gate.enabled || !formReady || reviewingSide !== null}
          onPress={() => void review("buy")}
          variant="primary"
        >
          {reviewingSide === "buy"
            ? "Preparing review…"
            : market.family === "spot"
              ? "Buy"
              : "Buy / Long"}
        </Button>
        <Button
          accessibilityHint="Opens a sell order review. Nothing is signed yet."
          animation={reducedMotion ? "disable-all" : undefined}
          className="min-h-12 w-full"
          isDisabled={!gate.enabled || !formReady || reviewingSide !== null}
          onPress={() => void review("sell")}
          variant="danger"
        >
          {reviewingSide === "sell"
            ? "Preparing review…"
            : market.family === "spot"
              ? "Sell"
              : "Sell / Short"}
        </Button>
      </Card.Footer>
    </Card>
  );
}
