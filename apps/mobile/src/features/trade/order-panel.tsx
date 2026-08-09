import type { Market } from "@hyper-trader/hyperliquid/public";
import { Button } from "heroui-native/button";
import { Card } from "heroui-native/card";
import { Chip } from "heroui-native/chip";
import { Input } from "heroui-native/input";
import { Label } from "heroui-native/label";
import { TextField } from "heroui-native/text-field";
import type { JSX } from "react";
import { useState } from "react";
import { Text, View } from "react-native";
import Animated, { FadeIn, ReduceMotion } from "react-native-reanimated";

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

function SelectorButton({
  label,
  selected,
  onPress,
}: {
  readonly label: string;
  readonly selected: boolean;
  readonly onPress: () => void;
}): JSX.Element {
  const reducedMotion = useReducedMotion();
  return (
    <Button
      accessibilityState={{ selected }}
      animation={reducedMotion ? "disable-all" : undefined}
      className="min-h-12 min-w-28 flex-1"
      onPress={onPress}
      variant={selected ? "primary" : "secondary"}
    >
      {selected ? `Selected · ${label}` : label}
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
}: {
  readonly market: Market;
  readonly authority: TradeAuthority;
  readonly draft: TradeDraft;
  readonly gate: TradeGate;
  readonly invalidationMessage: string | null;
  readonly onDraftChange: (draft: TradeDraft) => void;
  readonly onReview: () => Promise<void>;
}): JSX.Element {
  const reducedMotion = useReducedMotion();
  const [reviewing, setReviewing] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
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
          availableFunds: account.availableFunds,
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
  const review = async () => {
    if (reviewing) return;
    setFormError(null);
    setReviewing(true);
    try {
      await onReview();
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : "Order review could not be opened safely.",
      );
    } finally {
      setReviewing(false);
    }
  };

  if (!structurallyOrderable) {
    return (
      <Card variant="secondary" className="gap-3">
        <Card.Body className="gap-2">
          <Card.Title>Browse-only market</Card.Title>
          <Card.Description>
            Market identity and public data remain available, but order fields
            are hidden because current validated metadata cannot support a safe
            draft.
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
    <Card variant="default" className="gap-4">
      <Card.Header className="flex-row flex-wrap items-start justify-between gap-3">
        <View className="min-w-52 flex-1 gap-1">
          <Card.Title>Order entry</Card.Title>
          <Card.Description>
            Draft here, then inspect the immutable review overlay before any
            protected action.
          </Card.Description>
        </View>
        <Chip
          size="sm"
          variant="soft"
          color={gate.enabled ? "success" : "warning"}
        >
          {gate.enabled ? "Review ready" : "Review gated"}
        </Chip>
      </Card.Header>
      <Card.Body className="gap-5">
        <View className="gap-2">
          <Text className="text-sm font-medium text-foreground">Side</Text>
          <View className="flex-row flex-wrap gap-2">
            <SelectorButton
              label="Buy"
              selected={draft.side === "buy"}
              onPress={() => update({ side: "buy" })}
            />
            <SelectorButton
              label="Sell"
              selected={draft.side === "sell"}
              onPress={() => update({ side: "sell" })}
            />
          </View>
        </View>

        <View className="gap-2">
          <Text className="text-sm font-medium text-foreground">
            Order type
          </Text>
          <View className="flex-row flex-wrap gap-2">
            <SelectorButton
              label="Market"
              selected={draft.orderType === "market"}
              onPress={() => update({ orderType: "market", reduceOnly: false })}
            />
            <SelectorButton
              label="Limit"
              selected={draft.orderType === "limit"}
              onPress={() => update({ orderType: "limit" })}
            />
          </View>
        </View>

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
                className="min-h-12 min-w-20 flex-1"
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

        <View className="flex-row flex-wrap gap-4">
          <View className="min-w-36 flex-1 gap-1">
            <Text className="text-xs uppercase tracking-wide text-muted">
              Available {market.family === "spot" ? "funds" : "margin"}
            </Text>
            <Text className="text-base tabular-nums text-foreground">
              {account?.availableFunds ?? "Unavailable"}
            </Text>
          </View>
          {controls.leverage ? (
            <View className="min-w-36 flex-1 gap-1">
              <Text className="text-xs uppercase tracking-wide text-muted">
                Current leverage
              </Text>
              <Text className="text-base text-foreground">
                {leverage === null ? "Unavailable" : `${leverage}×`}
              </Text>
              <Text className="text-xs leading-4 text-muted">
                Display-only · maximum{" "}
                {market.family === "perp"
                  ? `${market.maxLeverage}×`
                  : "not applicable"}
              </Text>
            </View>
          ) : null}
        </View>

        <Button
          accessibilityState={{ expanded: advancedOpen }}
          animation={reducedMotion ? "disable-all" : undefined}
          className="min-h-12 w-full"
          onPress={() => setAdvancedOpen((open) => !open)}
          variant="tertiary"
        >
          {advancedOpen ? "Hide advanced controls" : "Show advanced controls"}
        </Button>

        {advancedOpen ? (
          <Animated.View
            className="gap-4"
            entering={FadeIn.duration(reducedMotion ? 0 : 160).reduceMotion(
              ReduceMotion.System,
            )}
          >
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
                        timeInForce === "Gtc"
                          ? "Good till canceled"
                          : timeInForce === "Ioc"
                            ? "Immediate or cancel"
                            : "Post only"
                      }
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
              <TextField animation={reducedMotion ? "disable-all" : undefined}>
                <Label>Maximum slippage · basis points</Label>
                <Input
                  accessibilityHint="Whole basis points from zero through five hundred."
                  keyboardType="number-pad"
                  onChangeText={(slippageBps) => update({ slippageBps })}
                  placeholder="50"
                  returnKeyType="done"
                  value={draft.slippageBps}
                />
              </TextField>
            ) : null}
          </Animated.View>
        ) : null}

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
          className="text-sm leading-5 text-warning"
        >
          {gate.enabled
            ? "Ready for a fresh immutable testnet review."
            : `${gate.code.replaceAll("_", " ")} · ${gate.reason}`}
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
      <Card.Footer>
        <Button
          accessibilityHint="Builds an immutable review payload. It does not sign or submit on entry."
          animation={reducedMotion ? "disable-all" : undefined}
          className="min-h-12 w-full"
          isDisabled={!gate.enabled || !formReady || reviewing}
          onPress={() => void review()}
          variant="primary"
        >
          {reviewing ? "Preparing review…" : `Review ${draft.side} order`}
        </Button>
      </Card.Footer>
    </Card>
  );
}
