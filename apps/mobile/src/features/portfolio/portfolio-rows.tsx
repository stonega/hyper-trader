import { Button } from "heroui-native/button";
import { Card } from "heroui-native/card";
import { Chip } from "heroui-native/chip";
import { Input } from "heroui-native/input";
import { Label } from "heroui-native/label";
import { TextField } from "heroui-native/text-field";
import type { JSX } from "react";
import { useState } from "react";
import { View } from "react-native";

import { AppText as Text } from "../../components/app-text";
import { useReducedMotion } from "../../components/use-reduced-motion";
import {
  type CloseDraft,
  createCloseDraft,
  type NormalizedPortfolio,
  type PortfolioFilter,
  type PortfolioOpenOrderRow,
  type PortfolioPositionRow,
} from "./portfolio-model";
import {
  boundedPortfolioRowLimit,
  nextPortfolioRowLimit,
  PORTFOLIO_ROW_BATCH_SIZE,
} from "./portfolio-row-window";

export type PortfolioEditor = {
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
  const closeEnabled = actionAccess.allowed && position.closeEnabled;
  const marginEnabled = actionAccess.allowed && position.marginActionEnabled;
  return (
    <Card variant="default" className="gap-4">
      <Card.Header className="flex-row flex-wrap items-start justify-between gap-3">
        <View className="min-w-40 flex-1 gap-1">
          <Card.Title>
            {position.coin} · {position.side}
          </Card.Title>
          <Card.Description>{position.venue}</Card.Description>
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
        {closeEnabled || marginEnabled ? (
          <View className="flex-row flex-wrap gap-2">
            {closeEnabled ? (
              <Button
                accessibilityHint="Opens a review for a full reduce-only market close."
                animation={reducedMotion ? "disable-all" : undefined}
                className="min-h-12 min-w-28 flex-1"
                onPress={() =>
                  onReviewClose(position, createCloseDraft(position))
                }
                variant="primary"
              >
                Review full close
              </Button>
            ) : null}
            {marginEnabled ? (
              <Button
                accessibilityHint="Edit leverage and margin mode before review."
                animation={reducedMotion ? "disable-all" : undefined}
                className="min-h-12 min-w-28 flex-1"
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
            ) : null}
          </View>
        ) : null}

        {active?.kind === "margin" ? (
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
  const cancelEnabled = actionAccess.allowed && order.cancelEnabled;
  return (
    <Card variant="default" className="gap-3">
      <Card.Body className="gap-3">
        <View className="flex-row flex-wrap items-start justify-between gap-3">
          <View className="gap-1">
            <Card.Title>
              {order.coin} · order {order.oid}
            </Card.Title>
            <Card.Description>{order.venue}</Card.Description>
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
        {cancelEnabled ? (
          <Button
            accessibilityHint="Review this order cancellation."
            animation={reducedMotion ? "disable-all" : undefined}
            className="min-h-12 w-full"
            onPress={() => onCancel(order)}
            variant="danger-soft"
          >
            Review cancel
          </Button>
        ) : null}
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
            editor={editor}
            error={editor?.positionId === position.id ? error : null}
            key={position.id}
            onReviewClose={onReviewClose}
            onReviewMargin={onReviewMargin}
            position={position}
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
            key={order.id}
            onCancel={onCancel}
            order={order}
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
  const rows =
    filter === "fills"
      ? portfolio.fills.slice(0, visible).map((fill) => ({
          id: `fill:${fill.hash}:${fill.oid}`,
          title: `${fill.coin} · ${fill.side}`,
          detail: `${fill.size} at ${fill.price} · fee ${fill.fee} ${fill.feeToken}`,
          amount: `Closed PnL ${fill.closedPnl}`,
        }))
      : filter === "funding"
        ? portfolio.funding.slice(0, visible).map((funding) => ({
            id: `funding:${funding.hash}:${funding.coin}`,
            title: `${funding.coin} · funding`,
            detail: `Rate ${funding.fundingRate} · size ${funding.size}`,
            amount: `${funding.usdc} USDC`,
          }))
        : portfolio.activity.slice(0, visible).map((activity) => ({
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
      <RowWindowFooter
        onShowMore={() => showMore(sourceLength)}
        total={sourceLength}
        visible={visible}
      />
    </View>
  );
}
