import { HyperliquidValidationError } from "../errors";
import {
  type DecimalString,
  parseDecimalString,
  parseNullableDecimalString,
} from "../numbers/decimal";
import type {
  ClearinghouseState,
  HistoricalOrder,
  MarginSummary,
  OpenOrder,
  OrderStatus,
  PortfolioPeriod,
  SpotClearinghouseState,
  SubaccountSummary,
  UserFill,
  UserFundingRecord,
  VaultDetails,
} from "./types";

function object(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HyperliquidValidationError(path, "expected an object");
  }
  return value as Record<string, unknown>;
}

function list(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new HyperliquidValidationError(path, "expected an array");
  }
  return value;
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new HyperliquidValidationError(path, "expected a non-empty string");
  }
  return value;
}

function integer(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new HyperliquidValidationError(
      path,
      "expected a non-negative integer",
    );
  }
  return value as number;
}

function number(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new HyperliquidValidationError(path, "expected a finite number");
  }
  return value;
}

function marginSummary(value: unknown, path: string): MarginSummary {
  const source = object(value, path);
  return {
    accountValue: parseDecimalString(
      source.accountValue,
      `${path}.accountValue`,
    ),
    totalNtlPos: parseDecimalString(source.totalNtlPos, `${path}.totalNtlPos`),
    totalRawUsd: parseDecimalString(source.totalRawUsd, `${path}.totalRawUsd`),
    totalMarginUsed: parseDecimalString(
      source.totalMarginUsed,
      `${path}.totalMarginUsed`,
    ),
  };
}

export function parseClearinghouseState(
  payload: unknown,
  path = "clearinghouseState",
): ClearinghouseState {
  const source = object(payload, path);
  return {
    positions: list(source.assetPositions, `${path}.assetPositions`).map(
      (rawPosition, index) => {
        const wrapper = object(rawPosition, `${path}.assetPositions[${index}]`);
        const position = object(
          wrapper.position,
          `${path}.assetPositions[${index}].position`,
        );
        const leverage = object(
          position.leverage,
          `${path}.assetPositions[${index}].position.leverage`,
        );
        const funding = object(
          position.cumFunding,
          `${path}.assetPositions[${index}].position.cumFunding`,
        );
        return {
          coin: text(position.coin, `${path}.assetPositions[${index}].coin`),
          size: parseDecimalString(
            position.szi,
            `${path}.assetPositions[${index}].szi`,
          ),
          entryPrice: parseNullableDecimalString(
            position.entryPx,
            `${path}.assetPositions[${index}].entryPx`,
          ),
          liquidationPrice: parseNullableDecimalString(
            position.liquidationPx,
            `${path}.assetPositions[${index}].liquidationPx`,
          ),
          marginUsed: parseDecimalString(
            position.marginUsed,
            `${path}.assetPositions[${index}].marginUsed`,
          ),
          positionValue: parseDecimalString(
            position.positionValue,
            `${path}.assetPositions[${index}].positionValue`,
          ),
          returnOnEquity: parseDecimalString(
            position.returnOnEquity,
            `${path}.assetPositions[${index}].returnOnEquity`,
          ),
          unrealizedPnl: parseDecimalString(
            position.unrealizedPnl,
            `${path}.assetPositions[${index}].unrealizedPnl`,
          ),
          maxLeverage: number(
            position.maxLeverage,
            `${path}.assetPositions[${index}].maxLeverage`,
          ),
          leverage: {
            type: text(
              leverage.type,
              `${path}.assetPositions[${index}].leverage.type`,
            ),
            value: number(
              leverage.value,
              `${path}.assetPositions[${index}].leverage.value`,
            ),
            ...(leverage.rawUsd === undefined
              ? {}
              : {
                  rawUsd: parseDecimalString(
                    leverage.rawUsd,
                    `${path}.assetPositions[${index}].leverage.rawUsd`,
                  ),
                }),
          },
          cumulativeFunding: {
            allTime: parseDecimalString(
              funding.allTime,
              `${path}.assetPositions[${index}].cumFunding.allTime`,
            ),
            sinceChange: parseDecimalString(
              funding.sinceChange,
              `${path}.assetPositions[${index}].cumFunding.sinceChange`,
            ),
            sinceOpen: parseDecimalString(
              funding.sinceOpen,
              `${path}.assetPositions[${index}].cumFunding.sinceOpen`,
            ),
          },
        };
      },
    ),
    crossMaintenanceMarginUsed: parseDecimalString(
      source.crossMaintenanceMarginUsed,
      `${path}.crossMaintenanceMarginUsed`,
    ),
    crossMarginSummary: marginSummary(
      source.crossMarginSummary,
      `${path}.crossMarginSummary`,
    ),
    marginSummary: marginSummary(source.marginSummary, `${path}.marginSummary`),
    time: integer(source.time, `${path}.time`),
    withdrawable: parseDecimalString(
      source.withdrawable,
      `${path}.withdrawable`,
    ),
  };
}

export function parseSpotClearinghouseState(
  payload: unknown,
  path = "spotClearinghouseState",
): SpotClearinghouseState {
  const source = object(payload, path);
  return {
    balances: list(source.balances, `${path}.balances`).map((value, index) => {
      const balance = object(value, `${path}.balances[${index}]`);
      return {
        coin: text(balance.coin, `${path}.balances[${index}].coin`),
        token: integer(balance.token, `${path}.balances[${index}].token`),
        hold: parseDecimalString(
          balance.hold,
          `${path}.balances[${index}].hold`,
        ),
        total: parseDecimalString(
          balance.total,
          `${path}.balances[${index}].total`,
        ),
        entryNtl: parseDecimalString(
          balance.entryNtl,
          `${path}.balances[${index}].entryNtl`,
        ),
      };
    }),
  };
}

function parseOpenOrder(value: unknown, path: string): OpenOrder {
  const order = object(value, path);
  return {
    coin: text(order.coin, `${path}.coin`),
    limitPrice: parseDecimalString(order.limitPx, `${path}.limitPx`),
    oid: integer(order.oid, `${path}.oid`),
    side: text(order.side, `${path}.side`),
    size: parseDecimalString(order.sz, `${path}.sz`),
    timestamp: integer(order.timestamp, `${path}.timestamp`),
  };
}

export function parseOpenOrders(payload: unknown): OpenOrder[] {
  return list(payload, "openOrders").map((value, index) =>
    parseOpenOrder(value, `openOrders[${index}]`),
  );
}

export function parseHistoricalOrders(payload: unknown): HistoricalOrder[] {
  return list(payload, "historicalOrders").map((value, index) => {
    const wrapper = object(value, `historicalOrders[${index}]`);
    const rawOrder = object(wrapper.order, `historicalOrders[${index}].order`);
    return {
      order: {
        ...parseOpenOrder(rawOrder, `historicalOrders[${index}].order`),
        ...(rawOrder.origSz === undefined
          ? {}
          : {
              originalSize: parseDecimalString(
                rawOrder.origSz,
                `historicalOrders[${index}].order.origSz`,
              ),
            }),
        ...(typeof rawOrder.reduceOnly === "boolean"
          ? { reduceOnly: rawOrder.reduceOnly }
          : {}),
        ...(typeof rawOrder.orderType === "string"
          ? { orderType: rawOrder.orderType }
          : {}),
      },
      status: text(wrapper.status, `historicalOrders[${index}].status`),
      statusTimestamp: integer(
        wrapper.statusTimestamp,
        `historicalOrders[${index}].statusTimestamp`,
      ),
    };
  });
}

export function parseUserFills(payload: unknown): UserFill[] {
  return list(payload, "userFills").map((value, index) => {
    const fill = object(value, `userFills[${index}]`);
    return {
      coin: text(fill.coin, `userFills[${index}].coin`),
      side: text(fill.side, `userFills[${index}].side`),
      price: parseDecimalString(fill.px, `userFills[${index}].px`),
      size: parseDecimalString(fill.sz, `userFills[${index}].sz`),
      closedPnl: parseDecimalString(
        fill.closedPnl,
        `userFills[${index}].closedPnl`,
      ),
      startPosition: parseDecimalString(
        fill.startPosition,
        `userFills[${index}].startPosition`,
      ),
      fee: parseDecimalString(fill.fee, `userFills[${index}].fee`),
      feeToken: text(fill.feeToken, `userFills[${index}].feeToken`),
      oid: integer(fill.oid, `userFills[${index}].oid`),
      time: integer(fill.time, `userFills[${index}].time`),
      hash: text(fill.hash, `userFills[${index}].hash`),
    };
  });
}

export function parseUserFunding(payload: unknown): UserFundingRecord[] {
  return list(payload, "userFunding").map((value, index) => {
    const entry = object(value, `userFunding[${index}]`);
    const delta = object(entry.delta, `userFunding[${index}].delta`);
    return {
      time: integer(entry.time, `userFunding[${index}].time`),
      hash: text(entry.hash, `userFunding[${index}].hash`),
      coin: text(delta.coin, `userFunding[${index}].delta.coin`),
      usdc: parseDecimalString(delta.usdc, `userFunding[${index}].delta.usdc`),
      size: parseDecimalString(delta.szi, `userFunding[${index}].delta.szi`),
      fundingRate: parseDecimalString(
        delta.fundingRate,
        `userFunding[${index}].delta.fundingRate`,
      ),
    };
  });
}

function historyPoints(
  value: unknown,
  path: string,
): (readonly [number, DecimalString])[] {
  return list(value, path).map((rawPoint, index) => {
    const point = list(rawPoint, `${path}[${index}]`);
    if (point.length !== 2) {
      throw new HyperliquidValidationError(
        `${path}[${index}]`,
        "expected timestamp and value",
      );
    }
    return [
      integer(point[0], `${path}[${index}][0]`),
      parseDecimalString(point[1], `${path}[${index}][1]`),
    ] as const;
  });
}

export function parsePortfolio(payload: unknown): PortfolioPeriod[] {
  return list(payload, "portfolio").map((rawPeriod, index) => {
    const tuple = list(rawPeriod, `portfolio[${index}]`);
    if (tuple.length !== 2) {
      throw new HyperliquidValidationError(
        `portfolio[${index}]`,
        "expected period and history",
      );
    }
    const history = object(tuple[1], `portfolio[${index}][1]`);
    return {
      period: text(tuple[0], `portfolio[${index}][0]`),
      accountValueHistory: historyPoints(
        history.accountValueHistory,
        `portfolio[${index}].accountValueHistory`,
      ),
      pnlHistory: historyPoints(
        history.pnlHistory,
        `portfolio[${index}].pnlHistory`,
      ),
      volume: parseDecimalString(history.vlm, `portfolio[${index}].vlm`),
    };
  });
}

export function parseSubaccounts(payload: unknown): SubaccountSummary[] {
  if (payload === null) {
    return [];
  }
  return list(payload, "subAccounts").map((value, index) => {
    const subaccount = object(value, `subAccounts[${index}]`);
    return {
      name: text(subaccount.name, `subAccounts[${index}].name`),
      address: text(
        subaccount.subAccountUser,
        `subAccounts[${index}].subAccountUser`,
      ),
      masterAddress: text(subaccount.master, `subAccounts[${index}].master`),
      clearinghouseState: parseClearinghouseState(
        subaccount.clearinghouseState,
        `subAccounts[${index}].clearinghouseState`,
      ),
      spotState: parseSpotClearinghouseState(
        subaccount.spotState,
        `subAccounts[${index}].spotState`,
      ),
    };
  });
}

export function parseVaultDetails(payload: unknown): VaultDetails {
  const source = object(payload, "vaultDetails");
  return {
    name: text(source.name, "vaultDetails.name"),
    vaultAddress: text(source.vaultAddress, "vaultDetails.vaultAddress"),
    leader: text(source.leader, "vaultDetails.leader"),
    description: text(source.description, "vaultDetails.description"),
    raw: source,
  };
}

export function parseOrderStatus(payload: unknown): OrderStatus {
  const source = object(payload, "orderStatus");
  return { status: text(source.status, "orderStatus.status"), raw: source };
}
