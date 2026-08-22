import type { FrontendOpenOrder, OpenOrder } from "@hyper-trader/hyperliquid";
import { isDecimalString, type Market } from "@hyper-trader/hyperliquid/public";

import type { TradeAccountSnapshot, TradeDraft } from "./trade-model";

export type TradeChartOverlayKind =
  | "last"
  | "mid"
  | "mark"
  | "entry"
  | "liquidation"
  | "open_order"
  | "trigger_order"
  | "draft";

export type TradeChartOverlayTone =
  | "accent"
  | "muted"
  | "success"
  | "danger"
  | "warning";

export interface TradeChartOverlay {
  readonly id: string;
  readonly kind: TradeChartOverlayKind;
  readonly label: string;
  readonly price: string;
  readonly numericPrice: number;
  readonly tone: TradeChartOverlayTone;
  readonly accessibilityLabel: string;
}

type TradeChartOpenOrder = OpenOrder &
  Partial<
    Pick<
      FrontendOpenOrder,
      | "isPositionTpsl"
      | "isTrigger"
      | "orderType"
      | "reduceOnly"
      | "triggerCondition"
      | "triggerPrice"
    >
  >;

function price(value: string | null | undefined): number | null {
  if (value === null || value === undefined || !isDecimalString(value)) {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function nonZero(value: string): boolean {
  if (!isDecimalString(value)) return false;
  const digits = value.replace(/[-.]/g, "");
  return digits.length > 0 && /[1-9]/.test(digits);
}

function overlay(input: {
  readonly id: string;
  readonly kind: TradeChartOverlayKind;
  readonly label: string;
  readonly price: string | null | undefined;
  readonly tone: TradeChartOverlayTone;
  readonly accessibilityLabel?: string;
}): TradeChartOverlay | null {
  const numericPrice = price(input.price);
  if (
    numericPrice === null ||
    input.price === null ||
    input.price === undefined
  ) {
    return null;
  }
  return {
    id: input.id,
    kind: input.kind,
    label: input.label,
    price: input.price,
    numericPrice,
    tone: input.tone,
    accessibilityLabel:
      input.accessibilityLabel ?? `${input.label} at ${input.price}`,
  };
}

export function buildTradeChartOverlays(input: {
  readonly market: Market;
  readonly lastPrice?: string | null;
  readonly account: TradeAccountSnapshot | null;
  readonly draft: TradeDraft | null;
  readonly openOrders: readonly TradeChartOpenOrder[];
}): TradeChartOverlay[] {
  const result: TradeChartOverlay[] = [];
  const lastPrice = price(input.lastPrice) === null ? null : input.lastPrice;
  const current = overlay({
    id: lastPrice === null ? "mid" : "last",
    kind: lastPrice === null ? "mid" : "last",
    label: lastPrice === null ? "Mid" : "Last",
    price: lastPrice ?? input.market.midPx,
    tone: "accent",
  });
  if (current) result.push(current);

  if (
    input.market.family === "perp" &&
    input.market.markPx !== (lastPrice ?? input.market.midPx)
  ) {
    const mark = overlay({
      id: "mark",
      kind: "mark",
      label: "Mark",
      price: input.market.markPx,
      tone: "muted",
    });
    if (mark) result.push(mark);
  }

  if (input.account !== null && nonZero(input.account.positionSize)) {
    const entry = overlay({
      id: "position-entry",
      kind: "entry",
      label: "Entry",
      price: input.account.entryPrice,
      tone: "success",
    });
    const liquidation = overlay({
      id: "position-liquidation",
      kind: "liquidation",
      label: "Liq",
      price: input.account.liquidationPrice,
      tone: "danger",
      accessibilityLabel:
        input.account.liquidationPrice === null ||
        input.account.liquidationPrice === undefined
          ? undefined
          : `Liquidation price ${input.account.liquidationPrice}`,
    });
    if (entry) result.push(entry);
    if (liquidation) result.push(liquidation);
  }

  for (const order of input.openOrders) {
    if (order.coin !== input.market.coin) continue;
    const side = order.side.toUpperCase() === "B" ? "Buy" : "Sell";
    const normalizedOrderType = order.orderType?.toLowerCase() ?? "";
    const triggerLabel = normalizedOrderType.includes("take profit")
      ? "TP"
      : normalizedOrderType.includes("stop")
        ? "SL"
        : "Trigger";
    const isTrigger =
      order.isTrigger === true && price(order.triggerPrice) !== null;
    const label = isTrigger ? triggerLabel : `${side} ${order.size}`;
    const orderOverlay = overlay({
      id: `open-order:${order.oid}`,
      kind: isTrigger ? "trigger_order" : "open_order",
      label,
      price: isTrigger ? order.triggerPrice : order.limitPrice,
      tone: isTrigger
        ? triggerLabel === "TP"
          ? "success"
          : triggerLabel === "SL"
            ? "danger"
            : "warning"
        : side === "Buy"
          ? "success"
          : "danger",
      accessibilityLabel: isTrigger
        ? `${triggerLabel} order for ${order.size} triggers at ${order.triggerPrice}. ${order.triggerCondition ?? ""}`.trim()
        : `${side} open order for ${order.size} at ${order.limitPrice}`,
    });
    if (orderOverlay) result.push(orderOverlay);
  }

  if (
    input.draft !== null &&
    input.draft.binding.marketCanonicalId === input.market.canonicalId &&
    input.draft.orderType === "limit"
  ) {
    const draft = overlay({
      id: "draft-limit",
      kind: "draft",
      label: "Draft",
      price: input.draft.limitPrice,
      tone: "warning",
      accessibilityLabel: `Draft limit price ${input.draft.limitPrice}`,
    });
    if (draft) result.push(draft);
  }

  return result;
}
