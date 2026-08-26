import type { Market } from "@hyper-trader/hyperliquid/public";
import { Button } from "heroui-native/button";
import { Card } from "heroui-native/card";
import { Chip } from "heroui-native/chip";
import { Input } from "heroui-native/input";
import { Label } from "heroui-native/label";
import { TextField } from "heroui-native/text-field";
import type { JSX, ReactNode } from "react";
import { useState } from "react";
import { View } from "react-native";

import { AppText as Text } from "../../components/app-text";
import { PriceInputWithMid } from "../../components/price-input-with-mid";
import { useReducedMotion } from "../../components/use-reduced-motion";
import {
  type CloseDraft,
  createCloseDraft,
  type NormalizedPortfolio,
  type PortfolioFilter,
  type PortfolioOpenOrderRow,
  type PortfolioPositionRow,
  portfolioFundingId,
  portfolioLimitCloseMidPrice,
} from "./portfolio-model";
import {
  formatPortfolioRecordTime,
  portfolioAmountTone,
  portfolioMarketLabel,
  portfolioSideColor,
  portfolioSideLabel,
} from "./portfolio-row-presentation";
import {
  boundedPortfolioRowLimit,
  nextPortfolioRowLimit,
  PORTFOLIO_ROW_BATCH_SIZE,
} from "./portfolio-row-window";

export type PortfolioEditor = {
  readonly kind: "limit_close";
  readonly positionId: string;
  readonly limitPrice: string;
  readonly size: string;
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
  tone = "default",
}: {
  readonly label: string;
  readonly value: string;
  readonly tone?: "danger" | "default" | "success";
}): JSX.Element {
  const valueClassName =
    tone === "danger"
      ? "text-sm font-medium tabular-nums text-danger"
      : tone === "success"
        ? "text-sm font-medium tabular-nums text-success"
        : "text-sm tabular-nums text-foreground";
  return (
    <View className="min-w-32 flex-1 gap-1">
      <Text className="text-xs uppercase tracking-wide text-muted">
        {label}
      </Text>
      <Text className={valueClassName}>{value}</Text>
    </View>
  );
}

function SideChip({ side }: { readonly side: string }): JSX.Element {
  const label = portfolioSideLabel(side);
  return (
    <Chip
      accessibilityLabel={`${label} side`}
      color={portfolioSideColor(side)}
      size="sm"
      variant="soft"
    >
      <Chip.Label>{label}</Chip.Label>
    </Chip>
  );
}

function RecordTypeChip({ label }: { readonly label: string }): JSX.Element {
  return (
    <Chip color="accent" size="sm" variant="soft">
      <Chip.Label>{label}</Chip.Label>
    </Chip>
  );
}

function RecordHeader({
  title,
  detail,
  badges,
}: {
  readonly title: string;
  readonly detail: string;
  readonly badges: ReactNode;
}): JSX.Element {
  return (
    <Card.Header className="flex-row flex-wrap items-start justify-between gap-3">
      <View className="min-w-40 flex-1 gap-1">
        <Card.Title numberOfLines={1}>{title}</Card.Title>
        <Card.Description>{detail}</Card.Description>
      </View>
      <View className="flex-row flex-wrap items-center justify-end gap-2">
        {badges}
      </View>
    </Card.Header>
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
      <Chip.Label>{label}</Chip.Label>
    </Chip>
  );
}

function PositionCard({
  position,
  markets,
  editor,
  setEditor,
  actionAccess,
  closePending,
  error,
  reviewingCloseBehavior,
  onReviewClose,
}: {
  readonly position: PortfolioPositionRow;
  readonly markets: readonly Market[];
  readonly editor: PortfolioEditor | null;
  readonly setEditor: (editor: PortfolioEditor | null) => void;
  readonly actionAccess: PortfolioActionAccess;
  readonly closePending: boolean;
  readonly error: string | null;
  readonly reviewingCloseBehavior: CloseDraft["behavior"] | null;
  readonly onReviewClose: (
    position: PortfolioPositionRow,
    draft: CloseDraft,
  ) => Promise<void>;
}): JSX.Element {
  const reducedMotion = useReducedMotion();
  const active = editor?.positionId === position.id ? editor : null;
  const closeEnabled = actionAccess.allowed && position.closeEnabled;
  const midPrice = portfolioLimitCloseMidPrice(position);
  const positionSide = position.side === "long" ? "Long" : "Short";
  const positionSideColor = position.side === "long" ? "success" : "danger";
  const pnlTone = portfolioAmountTone(position.unrealizedPnl);
  return (
    <Card variant="default" className="gap-4">
      <RecordHeader
        badges={
          <>
            <Chip color={positionSideColor} size="sm" variant="soft">
              <Chip.Label>{positionSide}</Chip.Label>
            </Chip>
            <Chip color={pnlTone} size="sm" variant="soft">
              <Chip.Label>PnL {position.unrealizedPnl} USDC</Chip.Label>
            </Chip>
          </>
        }
        detail={position.venue}
        title={portfolioMarketLabel(position.coin, markets, position.market)}
      />
      <Card.Body className="gap-4">
        <View className="flex-row flex-wrap gap-x-5 gap-y-3">
          <Value label="Position size" value={position.absoluteSize} />
          <Value label="Entry" value={position.entryPrice ?? "Unavailable"} />
          <Value label="Position value" value={position.positionValue} />
          <Value label="Leverage" value={`${position.leverage}×`} />
          <Value
            label="Liquidation"
            value={position.liquidationPrice ?? "Unavailable"}
          />
          <Value label="Margin" value={position.marginMode ?? "Unavailable"} />
        </View>
        {closeEnabled ? (
          <View className="flex-row flex-wrap gap-2">
            <Button
              accessibilityHint="Reviews a full reduce-only market close, then requests device verification before submission."
              animation={reducedMotion ? "disable-all" : undefined}
              className="min-h-12 min-w-28 flex-1"
              isDisabled={closePending}
              onPress={() => {
                setEditor(null);
                void onReviewClose(position, createCloseDraft(position));
              }}
              variant="primary"
            >
              <Button.Label>
                {reviewingCloseBehavior === "market" ? "Reviewing…" : "Market"}
              </Button.Label>
            </Button>
            <Button
              accessibilityHint="Opens a reduce-only limit close form for this position."
              accessibilityState={{ expanded: active !== null }}
              animation={reducedMotion ? "disable-all" : undefined}
              className="min-h-12 min-w-28 flex-1"
              isDisabled={closePending}
              onPress={() => {
                if (active !== null) {
                  setEditor(null);
                  return;
                }
                const draft = createCloseDraft(position);
                setEditor({
                  kind: "limit_close",
                  positionId: position.id,
                  limitPrice: draft.limitPrice,
                  size: draft.size,
                });
              }}
              variant="secondary"
            >
              <Button.Label>Limit</Button.Label>
            </Button>
          </View>
        ) : null}

        {active?.kind === "limit_close" ? (
          <View
            accessibilityLabel={`Limit close for ${position.coin}`}
            className="gap-4 border-t border-divider pt-4"
          >
            <View className="gap-1">
              <Text className="text-base font-medium text-foreground">
                Limit close
              </Text>
              <Text className="text-sm leading-5 text-muted">
                Place a reduce-only order to close at your price.
              </Text>
            </View>
            <TextField
              animation={reducedMotion ? "disable-all" : undefined}
              isDisabled={closePending}
              isInvalid={error !== null}
            >
              <Label>Limit price (USDC)</Label>
              <PriceInputWithMid
                accessibilityHint="Uses this market's current decimal and significant-figure limits."
                accessibilityLabel={`Limit price for ${position.coin}`}
                isDisabled={closePending}
                midButtonAccessibilityLabel={`Use current mid price for ${position.coin}`}
                midPrice={midPrice}
                onChangeText={(limitPrice) =>
                  setEditor({ ...active, limitPrice })
                }
                returnKeyType="next"
                value={active.limitPrice}
              />
            </TextField>
            <TextField
              animation={reducedMotion ? "disable-all" : undefined}
              isDisabled={closePending}
              isInvalid={error !== null}
            >
              <Label>Size ({position.coin})</Label>
              <Input
                accessibilityLabel={`Close size for ${position.coin}`}
                keyboardType="decimal-pad"
                onChangeText={(size) => setEditor({ ...active, size })}
                value={active.size}
              />
            </TextField>
            <View className="flex-row items-center justify-between gap-3">
              <Text className="flex-1 text-xs leading-4 text-muted">
                Position size {position.absoluteSize} {position.coin}
              </Text>
              <Button
                animation={reducedMotion ? "disable-all" : undefined}
                isDisabled={closePending}
                onPress={() =>
                  setEditor({ ...active, size: position.absoluteSize })
                }
                size="sm"
                variant="tertiary"
              >
                <Button.Label>Use full size</Button.Label>
              </Button>
            </View>
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
                accessibilityHint="Validates this reduce-only limit close, then requests device verification before submission."
                animation={reducedMotion ? "disable-all" : undefined}
                className="min-h-12 min-w-32 flex-1"
                isDisabled={closePending}
                onPress={() =>
                  void onReviewClose(position, {
                    ...createCloseDraft(position),
                    behavior: "limit",
                    limitPrice: active.limitPrice,
                    size: active.size,
                  })
                }
                variant="primary"
              >
                <Button.Label>
                  {reviewingCloseBehavior === "limit" ? "Reviewing…" : "Close"}
                </Button.Label>
              </Button>
              <Button
                animation={reducedMotion ? "disable-all" : undefined}
                className="min-h-12 min-w-32 flex-1"
                isDisabled={closePending}
                onPress={() => setEditor(null)}
                variant="tertiary"
              >
                <Button.Label>Cancel</Button.Label>
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
  markets,
  actionAccess,
  cancelPending,
  reviewingCancel,
  onCancel,
}: {
  readonly order: PortfolioOpenOrderRow;
  readonly markets: readonly Market[];
  readonly actionAccess: PortfolioActionAccess;
  readonly cancelPending: boolean;
  readonly reviewingCancel: boolean;
  readonly onCancel: (order: PortfolioOpenOrderRow) => Promise<void>;
}): JSX.Element {
  const reducedMotion = useReducedMotion();
  const cancelEnabled = actionAccess.allowed && order.cancelEnabled;
  return (
    <Card variant="default" className="gap-3">
      <RecordHeader
        badges={
          <>
            <RecordTypeChip label="Open" />
            <SideChip side={order.side} />
          </>
        }
        detail={`${order.venue} · Order #${order.oid} · ${formatPortfolioRecordTime(order.timestamp)}`}
        title={portfolioMarketLabel(order.coin, markets, order.market)}
      />
      <Card.Body className="gap-3">
        <View className="flex-row flex-wrap gap-x-5 gap-y-3">
          <Value label="Order size" value={order.size} />
          <Value label="Limit price" value={order.limitPrice} />
        </View>
        {cancelEnabled ? (
          <Button
            accessibilityHint="Validates this cancellation, then requests device verification before submission."
            animation={reducedMotion ? "disable-all" : undefined}
            className="min-h-12 w-full"
            isDisabled={cancelPending}
            onPress={() => void onCancel(order)}
            variant="danger-soft"
          >
            <Button.Label>
              {reviewingCancel ? "Reviewing…" : "Cancel"}
            </Button.Label>
          </Button>
        ) : null}
      </Card.Body>
    </Card>
  );
}

interface HistoryMetric {
  readonly label: string;
  readonly value: string;
  readonly tone?: "danger" | "default" | "success";
}

interface HistoryRecord {
  readonly id: string;
  readonly coin: string;
  readonly type: "Fill" | "Funding";
  readonly time: number;
  readonly side: string | null;
  readonly detail?: string;
  readonly metrics: readonly HistoryMetric[];
}

function HistoryRecordCard({
  markets,
  record,
}: {
  readonly markets: readonly Market[];
  readonly record: HistoryRecord;
}): JSX.Element {
  return (
    <Card variant="default" className="gap-3">
      <RecordHeader
        badges={
          <>
            <RecordTypeChip label={record.type} />
            {record.side === null ? null : <SideChip side={record.side} />}
          </>
        }
        detail={formatPortfolioRecordTime(record.time)}
        title={portfolioMarketLabel(record.coin, markets)}
      />
      <Card.Body className="gap-3">
        {record.detail ? (
          <Card.Description>{record.detail}</Card.Description>
        ) : null}
        <View className="flex-row flex-wrap gap-x-5 gap-y-3">
          {record.metrics.map((metric) => (
            <Value
              key={metric.label}
              label={metric.label}
              tone={metric.tone}
              value={metric.value}
            />
          ))}
        </View>
      </Card.Body>
    </Card>
  );
}

function RowWindowFooter({
  total,
  visible,
  onShowMore,
}: {
  readonly total: number;
  readonly visible: number;
  readonly onShowMore: () => void;
}): JSX.Element | null {
  const reducedMotion = useReducedMotion();
  const remaining = Math.max(0, total - visible);
  if (remaining === 0) return null;
  const nextCount = Math.min(PORTFOLIO_ROW_BATCH_SIZE, remaining);
  return (
    <Button
      accessibilityHint={`${remaining} portfolio rows remain hidden.`}
      animation={reducedMotion ? "disable-all" : undefined}
      className="min-h-12 w-full"
      onPress={onShowMore}
      variant="tertiary"
    >
      <Button.Label>
        Show {nextCount} more · {remaining} remaining
      </Button.Label>
    </Button>
  );
}

export function PortfolioRows({
  portfolio,
  markets,
  filter,
  editor,
  setEditor,
  actionAccess,
  error,
  onCancel,
  onReviewClose,
}: {
  readonly portfolio: NormalizedPortfolio;
  readonly markets: readonly Market[];
  readonly filter: PortfolioFilter;
  readonly editor: PortfolioEditor | null;
  readonly setEditor: (editor: PortfolioEditor | null) => void;
  readonly actionAccess: PortfolioActionAccess;
  readonly error: string | null;
  readonly onCancel: (order: PortfolioOpenOrderRow) => Promise<void>;
  readonly onReviewClose: (
    position: PortfolioPositionRow,
    draft: CloseDraft,
  ) => Promise<void>;
}): JSX.Element {
  const [reviewingClose, setReviewingClose] = useState<{
    readonly behavior: CloseDraft["behavior"];
    readonly positionId: string;
  } | null>(null);
  const [reviewingCancelOrderId, setReviewingCancelOrderId] = useState<
    string | null
  >(null);
  const rowScope = `${portfolio.ownerKey}:${filter}`;
  const [rowWindow, setRowWindow] = useState({
    scope: rowScope,
    limit: PORTFOLIO_ROW_BATCH_SIZE,
  });
  const requestedLimit =
    rowWindow.scope === rowScope ? rowWindow.limit : PORTFOLIO_ROW_BATCH_SIZE;
  const showMore = (total: number) => {
    setRowWindow((current) => ({
      scope: rowScope,
      limit: nextPortfolioRowLimit(
        current.scope === rowScope ? current.limit : PORTFOLIO_ROW_BATCH_SIZE,
        total,
      ),
    }));
  };
  const reviewClose = async (
    position: PortfolioPositionRow,
    draft: CloseDraft,
  ) => {
    if (reviewingClose !== null) return;
    setReviewingClose({ behavior: draft.behavior, positionId: position.id });
    try {
      await onReviewClose(position, draft);
    } finally {
      setReviewingClose(null);
    }
  };
  const cancelOrder = async (order: PortfolioOpenOrderRow) => {
    if (reviewingCancelOrderId !== null) return;
    setReviewingCancelOrderId(order.id);
    try {
      await onCancel(order);
    } finally {
      setReviewingCancelOrderId(null);
    }
  };
  if (filter === "positions") {
    const visible = boundedPortfolioRowLimit(
      requestedLimit,
      portfolio.positions.length,
    );
    return portfolio.positions.length === 0 ? (
      <EmptyFilter label="positions" />
    ) : (
      <View className="gap-3">
        {portfolio.positions.slice(0, visible).map((position) => (
          <PositionCard
            actionAccess={actionAccess}
            closePending={reviewingClose !== null}
            editor={editor}
            error={editor?.positionId === position.id ? error : null}
            key={position.id}
            markets={markets}
            onReviewClose={reviewClose}
            position={position}
            reviewingCloseBehavior={
              reviewingClose?.positionId === position.id
                ? reviewingClose.behavior
                : null
            }
            setEditor={setEditor}
          />
        ))}
        <RowWindowFooter
          onShowMore={() => showMore(portfolio.positions.length)}
          total={portfolio.positions.length}
          visible={visible}
        />
      </View>
    );
  }
  if (filter === "open_orders") {
    const visible = boundedPortfolioRowLimit(
      requestedLimit,
      portfolio.openOrders.length,
    );
    return portfolio.openOrders.length === 0 ? (
      <EmptyFilter label="open orders" />
    ) : (
      <View className="gap-3">
        {portfolio.openOrders.slice(0, visible).map((order) => (
          <OrderCard
            actionAccess={actionAccess}
            cancelPending={reviewingCancelOrderId !== null}
            key={order.id}
            markets={markets}
            onCancel={cancelOrder}
            order={order}
            reviewingCancel={reviewingCancelOrderId === order.id}
          />
        ))}
        <RowWindowFooter
          onShowMore={() => showMore(portfolio.openOrders.length)}
          total={portfolio.openOrders.length}
          visible={visible}
        />
      </View>
    );
  }
  if (filter === "spot_balances") {
    const visible = boundedPortfolioRowLimit(
      requestedLimit,
      portfolio.spotBalances.length,
    );
    return portfolio.spotBalances.length === 0 ? (
      <EmptyFilter label="spot balances" />
    ) : (
      <View className="gap-3">
        {portfolio.spotBalances.slice(0, visible).map((balance) => (
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
        <RowWindowFooter
          onShowMore={() => showMore(portfolio.spotBalances.length)}
          total={portfolio.spotBalances.length}
          visible={visible}
        />
      </View>
    );
  }
  const sourceLength =
    filter === "fills"
      ? portfolio.fills.length
      : filter === "funding"
        ? portfolio.funding.length
        : portfolio.activity.length;
  const visible = boundedPortfolioRowLimit(requestedLimit, sourceLength);
  const rows: readonly HistoryRecord[] =
    filter === "fills"
      ? portfolio.fills.slice(0, visible).map((fill) => ({
          id: `fill:${fill.hash}:${fill.oid}`,
          coin: fill.coin,
          type: "Fill" as const,
          time: fill.time,
          side: fill.side,
          metrics: [
            { label: "Price", value: fill.price },
            { label: "Size", value: fill.size },
            { label: "Fee", value: `${fill.fee} ${fill.feeToken}` },
            {
              label: "Closed PnL",
              value: `${fill.closedPnl} USDC`,
              tone: portfolioAmountTone(fill.closedPnl),
            },
          ],
        }))
      : filter === "funding"
        ? portfolio.funding.slice(0, visible).map((funding) => ({
            id: portfolioFundingId(funding),
            coin: funding.coin,
            type: "Funding" as const,
            time: funding.time,
            side: null,
            metrics: [
              {
                label: "Payment",
                value: `${funding.usdc} USDC`,
                tone: portfolioAmountTone(funding.usdc),
              },
              { label: "Funding rate", value: funding.fundingRate },
              { label: "Position size", value: funding.size },
            ],
          }))
        : portfolio.activity.slice(0, visible).map((activity) => ({
            id: activity.id,
            coin: activity.coin,
            type: activity.kind === "fill" ? "Fill" : "Funding",
            time: activity.time,
            side: activity.side,
            detail: activity.detail,
            metrics: [
              {
                label: activity.kind === "fill" ? "Closed PnL" : "Payment",
                value: `${activity.amount} USDC`,
                tone: portfolioAmountTone(activity.amount),
              },
            ],
          }));
  return rows.length === 0 ? (
    <EmptyFilter label={filter.replaceAll("_", " ")} />
  ) : (
    <View className="gap-3">
      {rows.map((row) => (
        <HistoryRecordCard key={row.id} markets={markets} record={row} />
      ))}
      <RowWindowFooter
        onShowMore={() => showMore(sourceLength)}
        total={sourceLength}
        visible={visible}
      />
    </View>
  );
}
