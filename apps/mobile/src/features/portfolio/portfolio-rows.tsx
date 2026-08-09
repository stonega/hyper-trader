import { Button } from "heroui-native/button";
import { Card } from "heroui-native/card";
import { Chip } from "heroui-native/chip";
import { Input } from "heroui-native/input";
import { Label } from "heroui-native/label";
import { TextField } from "heroui-native/text-field";
import type { JSX } from "react";
import { Text, View } from "react-native";

import { useReducedMotion } from "../../components/use-reduced-motion";
import {
  type CloseDraft,
  createCloseDraft,
  type NormalizedPortfolio,
  type PortfolioFilter,
  type PortfolioOpenOrderRow,
  type PortfolioPositionRow,
} from "./portfolio-model";

export type PortfolioEditor =
  | {
      readonly kind: "close";
      readonly positionId: string;
      readonly draft: CloseDraft;
    }
  | {
      readonly kind: "margin";
      readonly positionId: string;
      readonly leverage: string;
      readonly marginMode: "cross" | "isolated";
    };

export type PortfolioActionAccess =
  | { readonly allowed: true; readonly message: string }
  | { readonly allowed: false; readonly reason: string };

function EmptyFilter({ label }: { readonly label: string }): JSX.Element {
  return (
    <Card variant="tertiary">
      <Card.Body className="gap-2">
        <Card.Title>No {label}</Card.Title>
        <Card.Description>
          The latest account snapshot returned no rows for this filter.
        </Card.Description>
      </Card.Body>
    </Card>
  );
}

function Value({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}): JSX.Element {
  return (
    <View className="min-w-32 flex-1 gap-1">
      <Text className="text-xs uppercase tracking-wide text-muted">
        {label}
      </Text>
      <Text className="text-sm tabular-nums text-foreground">{value}</Text>
    </View>
  );
}

export function PortfolioSelectionChip({
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
    <Chip
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      animation={reducedMotion ? "disable-all" : undefined}
      className="min-h-12 px-3"
      color={selected ? "accent" : "default"}
      onPress={onPress}
      variant={selected ? "primary" : "secondary"}
    >
      {label}
    </Chip>
  );
}

function PositionCard({
  position,
  editor,
  setEditor,
  actionAccess,
  error,
  onReviewClose,
  onReviewMargin,
}: {
  readonly position: PortfolioPositionRow;
  readonly editor: PortfolioEditor | null;
  readonly setEditor: (editor: PortfolioEditor | null) => void;
  readonly actionAccess: PortfolioActionAccess;
  readonly error: string | null;
  readonly onReviewClose: (
    position: PortfolioPositionRow,
    draft: CloseDraft,
  ) => void;
  readonly onReviewMargin: (
    position: PortfolioPositionRow,
    leverage: number,
    marginMode: "cross" | "isolated",
  ) => void;
}): JSX.Element {
  const reducedMotion = useReducedMotion();
  const active = editor?.positionId === position.id ? editor : null;
  const closeReason = !actionAccess.allowed
    ? actionAccess.reason
    : position.closeEnabled
      ? actionAccess.message
      : position.market === null
        ? "This position could not be matched to a current market."
        : position.market.dexIndex !== 0
          ? "Closing builder-venue positions is unavailable in this build."
          : "Current market data does not allow this position to be closed.";
  const marginReason = !actionAccess.allowed
    ? actionAccess.reason
    : position.marginActionEnabled
      ? actionAccess.message
      : position.market === null
        ? "This position could not be matched to a current market."
        : "Margin changes are unavailable for this position.";
  const closeEnabled = actionAccess.allowed && position.closeEnabled;
  const marginEnabled = actionAccess.allowed && position.marginActionEnabled;
  return (
    <Card variant="default" className="gap-4">
      <Card.Header className="flex-row flex-wrap items-start justify-between gap-3">
        <View className="min-w-40 flex-1 gap-1">
          <Card.Title>
            {position.coin} · {position.side}
          </Card.Title>
          <Card.Description>
            {position.venue} ·{" "}
            {position.canonicalMarketId ?? "unmatched market"}
          </Card.Description>
        </View>
        <Chip
          color={position.unrealizedPnl.startsWith("-") ? "danger" : "success"}
          size="sm"
          variant="soft"
        >
          PnL {position.unrealizedPnl}
        </Chip>
      </Card.Header>
      <Card.Body className="gap-4">
        <View className="flex-row flex-wrap gap-x-5 gap-y-3">
          <Value label="Size" value={position.size} />
          <Value label="Entry" value={position.entryPrice ?? "Unavailable"} />
          <Value label="Value" value={position.positionValue} />
          <Value label="Leverage" value={`${position.leverage}×`} />
          <Value
            label="Liquidation"
            value={position.liquidationPrice ?? "Unavailable"}
          />
          <Value label="Margin" value={position.marginMode ?? "Unavailable"} />
        </View>
        <Text className="text-sm leading-5 text-muted">
          TP/SL is unavailable in this build. Hyper Trader will not create or
          change a protective order from this screen.
        </Text>
        <View className="flex-row flex-wrap gap-2">
          <Button
            accessibilityHint={
              closeEnabled
                ? "Edit a full-size reduce-only close before review."
                : closeReason
            }
            animation={reducedMotion ? "disable-all" : undefined}
            className="min-h-12 min-w-28 flex-1"
            isDisabled={!closeEnabled}
            onPress={() => {
              setEditor({
                kind: "close",
                positionId: position.id,
                draft: createCloseDraft(position),
              });
            }}
            variant="primary"
          >
            Close
          </Button>
          <Button
            accessibilityHint="Protective-order editing is unavailable in this build."
            animation={reducedMotion ? "disable-all" : undefined}
            className="min-h-12 min-w-28 flex-1"
            isDisabled
            variant="secondary"
          >
            TP / SL unavailable
          </Button>
          <Button
            accessibilityHint={
              marginEnabled
                ? "Edit leverage and margin mode before review."
                : marginReason
            }
            animation={reducedMotion ? "disable-all" : undefined}
            className="min-h-12 min-w-28 flex-1"
            isDisabled={!marginEnabled}
            onPress={() =>
              setEditor({
                kind: "margin",
                positionId: position.id,
                leverage: String(position.leverage),
                marginMode: position.onlyIsolated
                  ? "isolated"
                  : (position.marginMode ?? "cross"),
              })
            }
            variant="secondary"
          >
            Margin
          </Button>
        </View>
        {!closeEnabled ? (
          <Text className="text-sm leading-5 text-muted">
            Close unavailable · {closeReason}
          </Text>
        ) : null}
        {!marginEnabled ? (
          <Text className="text-sm leading-5 text-muted">
            Margin unavailable · {marginReason}
          </Text>
        ) : null}

        {active?.kind === "close" ? (
          <View
            accessibilityLabel={`Edit close for ${position.coin}`}
            className="gap-4 border-t border-divider pt-4"
          >
            <Text className="text-base font-medium text-foreground">
              Edit reduce-only close
            </Text>
            <View className="flex-row flex-wrap gap-2">
              <PortfolioSelectionChip
                label="Full market close"
                onPress={() =>
                  setEditor({
                    ...active,
                    draft: {
                      ...active.draft,
                      behavior: "market",
                      size: position.absoluteSize,
                    },
                  })
                }
                selected={active.draft.behavior === "market"}
              />
              <PortfolioSelectionChip
                label="Reduce-only limit"
                onPress={() =>
                  setEditor({
                    ...active,
                    draft: { ...active.draft, behavior: "limit" },
                  })
                }
                selected={active.draft.behavior === "limit"}
              />
            </View>
            <TextField animation={reducedMotion ? "disable-all" : undefined}>
              <Label>Close size</Label>
              <Input
                accessibilityHint={
                  active.draft.behavior === "market"
                    ? "Full size is required for a market close. Choose reduce-only limit to edit a partial size."
                    : "May be reduced, but cannot exceed the current position."
                }
                editable={active.draft.behavior === "limit"}
                keyboardType="decimal-pad"
                onChangeText={(size) =>
                  setEditor({
                    ...active,
                    draft: { ...active.draft, size },
                  })
                }
                value={active.draft.size}
              />
            </TextField>
            {active.draft.behavior === "limit" ? (
              <TextField animation={reducedMotion ? "disable-all" : undefined}>
                <Label>Limit price</Label>
                <Input
                  keyboardType="decimal-pad"
                  onChangeText={(limitPrice) =>
                    setEditor({
                      ...active,
                      draft: { ...active.draft, limitPrice },
                    })
                  }
                  value={active.draft.limitPrice}
                />
              </TextField>
            ) : (
              <TextField animation={reducedMotion ? "disable-all" : undefined}>
                <Label>Maximum slippage, basis points (0–500)</Label>
                <Input
                  accessibilityHint="Sets the worst acceptable price bound for this full market close."
                  keyboardType="number-pad"
                  onChangeText={(slippageBps) =>
                    setEditor({
                      ...active,
                      draft: { ...active.draft, slippageBps },
                    })
                  }
                  value={active.draft.slippageBps}
                />
              </TextField>
            )}
            {error ? (
              <Text
                accessibilityRole="alert"
                className="text-sm leading-5 text-danger"
              >
                {error}
              </Text>
            ) : null}
            <View className="flex-row flex-wrap gap-2">
              <Button
                animation={reducedMotion ? "disable-all" : undefined}
                className="min-h-12 min-w-32 flex-1"
                onPress={() => onReviewClose(position, active.draft)}
                variant="primary"
              >
                Review close
              </Button>
              <Button
                animation={reducedMotion ? "disable-all" : undefined}
                className="min-h-12 min-w-32 flex-1"
                onPress={() => setEditor(null)}
                variant="tertiary"
              >
                Keep position
              </Button>
            </View>
          </View>
        ) : active?.kind === "margin" ? (
          <View
            accessibilityLabel={`Edit margin for ${position.coin}`}
            className="gap-4 border-t border-divider pt-4"
          >
            <Text className="text-base font-medium text-foreground">
              Edit margin action
            </Text>
            <View className="flex-row flex-wrap gap-2">
              <PortfolioSelectionChip
                label="Cross margin"
                onPress={() => setEditor({ ...active, marginMode: "cross" })}
                selected={active.marginMode === "cross"}
              />
              <PortfolioSelectionChip
                label="Isolated margin"
                onPress={() => setEditor({ ...active, marginMode: "isolated" })}
                selected={active.marginMode === "isolated"}
              />
            </View>
            <TextField animation={reducedMotion ? "disable-all" : undefined}>
              <Label>Leverage, maximum {position.maxLeverage}×</Label>
              <Input
                keyboardType="number-pad"
                onChangeText={(leverage) => setEditor({ ...active, leverage })}
                value={active.leverage}
              />
            </TextField>
            {error ? (
              <Text
                accessibilityRole="alert"
                className="text-sm leading-5 text-danger"
              >
                {error}
              </Text>
            ) : null}
            <View className="flex-row flex-wrap gap-2">
              <Button
                animation={reducedMotion ? "disable-all" : undefined}
                className="min-h-12 min-w-32 flex-1"
                onPress={() =>
                  onReviewMargin(
                    position,
                    Number(active.leverage),
                    active.marginMode,
                  )
                }
                variant="primary"
              >
                Review margin
              </Button>
              <Button
                animation={reducedMotion ? "disable-all" : undefined}
                className="min-h-12 min-w-32 flex-1"
                onPress={() => setEditor(null)}
                variant="tertiary"
              >
                Keep current margin
              </Button>
            </View>
          </View>
        ) : null}
      </Card.Body>
    </Card>
  );
}

function OrderCard({
  order,
  actionAccess,
  onCancel,
}: {
  readonly order: PortfolioOpenOrderRow;
  readonly actionAccess: PortfolioActionAccess;
  readonly onCancel: (order: PortfolioOpenOrderRow) => void;
}): JSX.Element {
  const reducedMotion = useReducedMotion();
  const cancelReason = !actionAccess.allowed
    ? actionAccess.reason
    : order.cancelEnabled
      ? actionAccess.message
      : order.market === null
        ? "This order could not be matched to a current market."
        : "Cancellation is unavailable for this order.";
  const cancelEnabled = actionAccess.allowed && order.cancelEnabled;
  return (
    <Card variant="default" className="gap-3">
      <Card.Body className="gap-3">
        <View className="flex-row flex-wrap items-start justify-between gap-3">
          <View className="gap-1">
            <Card.Title>
              {order.coin} · order {order.oid}
            </Card.Title>
            <Card.Description>
              {order.venue} · {order.canonicalMarketId ?? "unmatched market"}
            </Card.Description>
          </View>
          <Chip size="sm" variant="soft" color="accent">
            Open
          </Chip>
        </View>
        <View className="flex-row flex-wrap gap-x-5 gap-y-3">
          <Value label="Side" value={order.side} />
          <Value label="Size" value={order.size} />
          <Value label="Limit" value={order.limitPrice} />
        </View>
        <Button
          accessibilityHint={
            cancelEnabled
              ? "Review the exact current order cancellation."
              : cancelReason
          }
          animation={reducedMotion ? "disable-all" : undefined}
          className="min-h-12 w-full"
          isDisabled={!cancelEnabled}
          onPress={() => onCancel(order)}
          variant="danger-soft"
        >
          Review cancel
        </Button>
        {!cancelEnabled ? (
          <Text className="text-sm leading-5 text-muted">
            Cancel unavailable · {cancelReason}
          </Text>
        ) : null}
      </Card.Body>
    </Card>
  );
}

export function PortfolioRows({
  portfolio,
  filter,
  editor,
  setEditor,
  actionAccess,
  error,
  onCancel,
  onReviewClose,
  onReviewMargin,
}: {
  readonly portfolio: NormalizedPortfolio;
  readonly filter: PortfolioFilter;
  readonly editor: PortfolioEditor | null;
  readonly setEditor: (editor: PortfolioEditor | null) => void;
  readonly actionAccess: PortfolioActionAccess;
  readonly error: string | null;
  readonly onCancel: (order: PortfolioOpenOrderRow) => void;
  readonly onReviewClose: (
    position: PortfolioPositionRow,
    draft: CloseDraft,
  ) => void;
  readonly onReviewMargin: (
    position: PortfolioPositionRow,
    leverage: number,
    marginMode: "cross" | "isolated",
  ) => void;
}): JSX.Element {
  if (filter === "positions") {
    return portfolio.positions.length === 0 ? (
      <EmptyFilter label="positions" />
    ) : (
      <View className="gap-3">
        {portfolio.positions.map((position) => (
          <PositionCard
            actionAccess={actionAccess}
            editor={editor}
            error={editor?.positionId === position.id ? error : null}
            key={position.id}
            onReviewClose={onReviewClose}
            onReviewMargin={onReviewMargin}
            position={position}
            setEditor={setEditor}
          />
        ))}
      </View>
    );
  }
  if (filter === "open_orders") {
    return portfolio.openOrders.length === 0 ? (
      <EmptyFilter label="open orders" />
    ) : (
      <View className="gap-3">
        {portfolio.openOrders.map((order) => (
          <OrderCard
            actionAccess={actionAccess}
            key={order.id}
            onCancel={onCancel}
            order={order}
          />
        ))}
      </View>
    );
  }
  if (filter === "spot_balances") {
    return portfolio.spotBalances.length === 0 ? (
      <EmptyFilter label="spot balances" />
    ) : (
      <View className="gap-3">
        {portfolio.spotBalances.map((balance) => (
          <Card key={balance.token} variant="default">
            <Card.Body className="gap-3">
              <Card.Title>{balance.coin}</Card.Title>
              <View className="flex-row flex-wrap gap-x-5 gap-y-3">
                <Value label="Total" value={balance.total} />
                <Value label="On hold" value={balance.hold} />
                <Value label="Entry notional" value={balance.entryNtl} />
              </View>
            </Card.Body>
          </Card>
        ))}
      </View>
    );
  }
  const rows =
    filter === "fills"
      ? portfolio.fills.map((fill) => ({
          id: `fill:${fill.hash}:${fill.oid}`,
          title: `${fill.coin} · ${fill.side}`,
          detail: `${fill.size} at ${fill.price} · fee ${fill.fee} ${fill.feeToken}`,
          amount: `Closed PnL ${fill.closedPnl}`,
        }))
      : filter === "funding"
        ? portfolio.funding.map((funding) => ({
            id: `funding:${funding.hash}:${funding.coin}`,
            title: `${funding.coin} · funding`,
            detail: `Rate ${funding.fundingRate} · size ${funding.size}`,
            amount: `${funding.usdc} USDC`,
          }))
        : portfolio.activity.map((activity) => ({
            id: activity.id,
            title: `${activity.coin} · ${activity.kind}`,
            detail: activity.detail,
            amount: activity.amount,
          }));
  return rows.length === 0 ? (
    <EmptyFilter label={filter.replaceAll("_", " ")} />
  ) : (
    <View className="gap-3">
      {rows.map((row) => (
        <Card key={row.id} variant="default">
          <Card.Body className="gap-2">
            <Card.Title>{row.title}</Card.Title>
            <Card.Description>{row.detail}</Card.Description>
            <Text className="text-sm tabular-nums text-foreground">
              {row.amount}
            </Text>
          </Card.Body>
        </Card>
      ))}
    </View>
  );
}
