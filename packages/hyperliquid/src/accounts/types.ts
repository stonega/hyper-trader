import type { DecimalString } from "../numbers/decimal";

export type AccountTarget =
  | { readonly kind: "master"; readonly address: string }
  | {
      readonly kind: "subaccount";
      readonly address: string;
      readonly masterAddress: string;
    }
  | {
      readonly kind: "vault";
      readonly address: string;
      readonly masterAddress?: string;
    };

export interface AccountDataResult<T> {
  readonly target: AccountTarget;
  readonly sourceDex: string | null;
  readonly data: T;
}

export interface MarginSummary {
  readonly accountValue: DecimalString;
  readonly totalNtlPos: DecimalString;
  readonly totalRawUsd: DecimalString;
  readonly totalMarginUsed: DecimalString;
}

export interface PerpPosition {
  readonly coin: string;
  readonly size: DecimalString;
  readonly entryPrice: DecimalString | null;
  readonly liquidationPrice: DecimalString | null;
  readonly marginUsed: DecimalString;
  readonly positionValue: DecimalString;
  readonly returnOnEquity: DecimalString;
  readonly unrealizedPnl: DecimalString;
  readonly maxLeverage: number;
  readonly leverage: {
    readonly type: string;
    readonly value: number;
    readonly rawUsd?: DecimalString;
  };
  readonly cumulativeFunding: {
    readonly allTime: DecimalString;
    readonly sinceChange: DecimalString;
    readonly sinceOpen: DecimalString;
  };
}

export interface ClearinghouseState {
  readonly positions: readonly PerpPosition[];
  readonly crossMaintenanceMarginUsed: DecimalString;
  readonly crossMarginSummary: MarginSummary;
  readonly marginSummary: MarginSummary;
  readonly time: number;
  readonly withdrawable: DecimalString;
}

export interface SpotBalance {
  readonly coin: string;
  readonly token: number;
  readonly hold: DecimalString;
  readonly total: DecimalString;
  readonly entryNtl: DecimalString;
}

export interface SpotClearinghouseState {
  readonly balances: readonly SpotBalance[];
}

export interface OpenOrder {
  readonly coin: string;
  readonly limitPrice: DecimalString;
  readonly oid: number;
  readonly side: string;
  readonly size: DecimalString;
  readonly timestamp: number;
}

export interface HistoricalOrder {
  readonly order: OpenOrder & {
    readonly originalSize?: DecimalString;
    readonly reduceOnly?: boolean;
    readonly orderType?: string;
  };
  readonly status: string;
  readonly statusTimestamp: number;
}

export interface UserFill {
  readonly coin: string;
  readonly side: string;
  readonly price: DecimalString;
  readonly size: DecimalString;
  readonly closedPnl: DecimalString;
  readonly startPosition: DecimalString;
  readonly fee: DecimalString;
  readonly feeToken: string;
  readonly oid: number;
  readonly time: number;
  readonly hash: string;
}

export interface UserFundingRecord {
  readonly time: number;
  readonly hash: string;
  readonly coin: string;
  readonly usdc: DecimalString;
  readonly size: DecimalString;
  readonly fundingRate: DecimalString;
}

export interface PortfolioPeriod {
  readonly period: string;
  readonly accountValueHistory: readonly (readonly [number, DecimalString])[];
  readonly pnlHistory: readonly (readonly [number, DecimalString])[];
  readonly volume: DecimalString;
}

export interface SubaccountSummary {
  readonly name: string;
  readonly address: string;
  readonly masterAddress: string;
  readonly clearinghouseState: ClearinghouseState;
  readonly spotState: SpotClearinghouseState;
}

export interface VaultDetails {
  readonly name: string;
  readonly vaultAddress: string;
  readonly leader: string;
  readonly description: string;
  readonly raw: Readonly<Record<string, unknown>>;
}

export interface OrderStatus {
  readonly status: string;
  readonly raw: Readonly<Record<string, unknown>>;
}
