import type { DecimalString } from "../numbers/decimal";

export type OrderSide = "buy" | "sell";
export type LimitTimeInForce = "Alo" | "Gtc" | "Ioc";

export type Cloid = `0x${string}`;

export interface MarketOrderIntent {
  readonly type: "market_order";
  readonly assetId: number;
  readonly side: OrderSide;
  readonly size: DecimalString;
  readonly aggressiveLimitPrice: DecimalString;
  readonly cloid: Cloid;
}

export interface LimitOrderIntent {
  readonly type: "limit_order";
  readonly assetId: number;
  readonly side: OrderSide;
  readonly size: DecimalString;
  readonly limitPrice: DecimalString;
  readonly timeInForce: LimitTimeInForce;
  readonly reduceOnly: boolean;
  readonly cloid: Cloid;
}

export interface ReduceOnlyCloseIntent {
  readonly type: "reduce_only_close";
  readonly assetId: number;
  readonly side: OrderSide;
  readonly size: DecimalString;
  readonly aggressiveLimitPrice: DecimalString;
  readonly cloid: Cloid;
}

export type PositionTpslKind = "take_profit" | "stop_loss";

export interface PositionTpslIntent {
  readonly type: "position_tpsl";
  readonly assetId: number;
  readonly side: OrderSide;
  readonly size: DecimalString;
  readonly triggerPrice: DecimalString;
  readonly aggressiveLimitPrice: DecimalString;
  readonly triggerKind: PositionTpslKind;
  readonly existingOid: number | null;
  readonly cloid: Cloid;
}

export type CancelTarget =
  | { readonly kind: "oid"; readonly oid: number }
  | { readonly kind: "cloid"; readonly cloid: Cloid };

export interface CancelIntent {
  readonly type: "cancel";
  readonly assetId: number;
  readonly target: CancelTarget;
}

export interface BulkCancelIntent {
  readonly type: "bulk_cancel";
  readonly cancels: readonly Omit<CancelIntent, "type">[];
}

export interface UpdateLeverageIntent {
  readonly type: "update_leverage";
  readonly assetId: number;
  readonly marginMode: "cross" | "isolated";
  readonly leverage: number;
}

export type TradingActionIntent =
  | MarketOrderIntent
  | LimitOrderIntent
  | ReduceOnlyCloseIntent
  | PositionTpslIntent
  | CancelIntent
  | BulkCancelIntent
  | UpdateLeverageIntent;

export interface LimitOrderWire {
  readonly a: number;
  readonly b: boolean;
  readonly p: DecimalString;
  readonly s: DecimalString;
  readonly r: boolean;
  readonly t: { readonly limit: { readonly tif: LimitTimeInForce } };
  readonly c: Cloid;
}

export interface TriggerOrderWire {
  readonly a: number;
  readonly b: boolean;
  readonly p: DecimalString;
  readonly s: DecimalString;
  readonly r: true;
  readonly t: {
    readonly trigger: {
      readonly isMarket: true;
      readonly triggerPx: DecimalString;
      readonly tpsl: "tp" | "sl";
    };
  };
  readonly c: Cloid;
}

export type OrderWire = LimitOrderWire | TriggerOrderWire;

export interface OrderAction {
  readonly type: "order";
  readonly orders: readonly OrderWire[];
  readonly grouping: "na" | "positionTpsl";
}

export interface ModifyOrderAction {
  readonly type: "modify";
  readonly oid: number;
  readonly order: TriggerOrderWire;
}

export interface CancelByOidAction {
  readonly type: "cancel";
  readonly cancels: readonly {
    readonly a: number;
    readonly o: number;
  }[];
}

export interface CancelByCloidAction {
  readonly type: "cancelByCloid";
  readonly cancels: readonly {
    readonly asset: number;
    readonly cloid: Cloid;
  }[];
}

export interface UpdateLeverageAction {
  readonly type: "updateLeverage";
  readonly asset: number;
  readonly isCross: boolean;
  readonly leverage: number;
}

export type ExchangeAction =
  | OrderAction
  | ModifyOrderAction
  | CancelByOidAction
  | CancelByCloidAction
  | UpdateLeverageAction;
