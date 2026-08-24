import type {
  AccountTarget,
  ClearinghouseState,
  LimitTimeInForce,
  OpenOrder,
  PortfolioPeriod,
  SpotClearinghouseState,
  TradingActionIntent,
  UserFill,
  UserFundingRecord,
} from "@hyper-trader/hyperliquid";
import type {
  DecimalString,
  HyperliquidNetwork,
  Market,
  PerpMarket,
} from "@hyper-trader/hyperliquid/public";
import { isDecimalString } from "@hyper-trader/hyperliquid/public";
import { aggressiveOrderPrice } from "../actions/aggressive-order-price";
import {
  type PerformanceSummary,
  percentageOf,
  summarizePerformanceSeries,
} from "./performance-model";

export type PortfolioRange = "24h" | "7d" | "30d" | "all";
export type PortfolioFilter =
  | "positions"
  | "open_orders"
  | "spot_balances"
  | "fills"
  | "funding"
  | "activity";

export interface PortfolioOwner {
  readonly network: HyperliquidNetwork;
  readonly masterAccount: string;
  readonly target: AccountTarget;
}

export interface PortfolioPerpSource {
  readonly dexName: string;
  readonly dexFullName: string | null;
  readonly state: ClearinghouseState;
  readonly openOrders: readonly OpenOrder[];
}

export interface PortfolioSourceSnapshot {
  readonly owner: PortfolioOwner;
  readonly markets: readonly Market[];
  readonly perpStates: readonly PortfolioPerpSource[];
  readonly spotState: SpotClearinghouseState;
  readonly fills: readonly UserFill[];
  readonly funding: readonly UserFundingRecord[];
  readonly periods: readonly PortfolioPeriod[];
  readonly observedAtMs: number;
  readonly sourceGaps?: readonly string[];
}

export interface PortfolioPositionRow {
  readonly id: string;
  readonly canonicalMarketId: string | null;
  readonly market: PerpMarket | null;
  readonly venue: string;
  readonly coin: string;
  readonly size: DecimalString;
  readonly absoluteSize: DecimalString;
  readonly side: "long" | "short";
  readonly entryPrice: DecimalString | null;
  readonly liquidationPrice: DecimalString | null;
  readonly positionValue: DecimalString;
  readonly unrealizedPnl: DecimalString;
  readonly returnOnEquity: DecimalString;
  readonly leverage: number;
  readonly marginMode: "cross" | "isolated" | null;
  readonly maxLeverage: number;
  readonly onlyIsolated: boolean;
  readonly availableMargin: DecimalString;
  readonly accountVersion: number;
  readonly actionsEnabled: boolean;
  readonly closeEnabled: boolean;
  readonly marginActionEnabled: boolean;
}

export interface PortfolioOpenOrderRow {
  readonly id: string;
  readonly canonicalMarketId: string | null;
  readonly market: Market | null;
  readonly venue: string;
  readonly coin: string;
  readonly limitPrice: DecimalString;
  readonly oid: number;
  readonly side: string;
  readonly size: DecimalString;
  readonly timestamp: number;
  readonly availableMargin: DecimalString;
  readonly accountVersion: number;
  readonly cancelEnabled: boolean;
}

export interface PortfolioRangeData {
  readonly range: PortfolioRange;
  readonly sourcePeriod: string;
  readonly accountValueHistory: PortfolioPeriod["accountValueHistory"];
  readonly pnlHistory: PortfolioPeriod["pnlHistory"];
  readonly accountValueSummary: PerformanceSummary | null;
  readonly accountValue: DecimalString | null;
  readonly absolutePnl: DecimalString | null;
  readonly percentagePnl: DecimalString | null;
  readonly gapCount: number;
}

export interface PortfolioActivityRow {
  readonly id: string;
  readonly kind: "fill" | "funding";
  readonly time: number;
  readonly coin: string;
  readonly side: string | null;
  readonly amount: DecimalString;
  readonly detail: string;
}

export function portfolioFundingId(
  funding: Pick<UserFundingRecord, "coin" | "hash" | "time">,
): string {
  return `funding:${funding.hash}:${funding.coin}:${funding.time}`;
}

export interface NormalizedPortfolio {
  readonly owner: PortfolioOwner;
  readonly ownerKey: string;
  readonly observedAtMs: number;
  readonly version: number;
  readonly ranges: Readonly<
    Partial<Record<PortfolioRange, PortfolioRangeData>>
  >;
  readonly positions: readonly PortfolioPositionRow[];
  readonly openOrders: readonly PortfolioOpenOrderRow[];
  readonly spotBalances: SpotClearinghouseState["balances"];
  readonly fills: readonly UserFill[];
  readonly funding: readonly UserFundingRecord[];
  readonly activity: readonly PortfolioActivityRow[];
  readonly gaps: readonly string[];
}

export type PortfolioLiveSourceSnapshot = Omit<
  PortfolioSourceSnapshot,
  "fills" | "funding" | "periods"
>;

export interface PortfolioHistorySourceSnapshot {
  readonly fills: PortfolioSourceSnapshot["fills"];
  readonly funding: PortfolioSourceSnapshot["funding"];
  readonly periods: PortfolioSourceSnapshot["periods"];
  readonly sourceGaps?: readonly string[];
}

export type NormalizedPortfolioLive = Pick<
  NormalizedPortfolio,
  | "owner"
  | "ownerKey"
  | "observedAtMs"
  | "version"
  | "positions"
  | "openOrders"
  | "spotBalances"
  | "gaps"
>;

export type NormalizedPortfolioHistory = Pick<
  NormalizedPortfolio,
  "ranges" | "fills" | "funding" | "activity" | "gaps"
>;

export interface CloseDraft {
  readonly positionId: string;
  readonly behavior: "market" | "limit";
  readonly size: string;
  readonly limitPrice: string;
  readonly timeInForce: LimitTimeInForce;
  readonly slippageBps: string;
}

const PERIODS: Readonly<Record<string, PortfolioRange>> = {
  day: "24h",
  week: "7d",
  month: "30d",
  allTime: "all",
  all: "all",
};

const RANGE_LABELS: Readonly<Record<PortfolioRange, string>> = {
  "24h": "24 hours",
  "7d": "7 days",
  "30d": "30 days",
  all: "all history",
};

const RANGE_CADENCE: Readonly<Record<PortfolioRange, number | null>> = {
  "24h": 60 * 60 * 1_000,
  "7d": 6 * 60 * 60 * 1_000,
  "30d": 24 * 60 * 60 * 1_000,
  all: null,
};

function normalizedAddress(value: string): string {
  return value.trim().toLowerCase();
}

export function portfolioOwnerKey(owner: PortfolioOwner): string {
  return JSON.stringify([
    owner.network,
    normalizedAddress(owner.masterAccount),
    ...accountTargetIdentity(owner.target),
  ]);
}

function accountTargetIdentity(target: AccountTarget): readonly unknown[] {
  return [
    target.kind,
    normalizedAddress(target.address),
    target.kind === "master"
      ? null
      : normalizedAddress(target.masterAddress ?? ""),
  ];
}

export function accountTargetIdentityKey(target: AccountTarget): string {
  return JSON.stringify(accountTargetIdentity(target));
}

function absoluteDecimal(value: DecimalString): DecimalString {
  if (!isDecimalString(value)) throw new Error("Position size is invalid.");
  return value.startsWith("-") ? value.slice(1) : value;
}

function zero(value: DecimalString): boolean {
  if (!isDecimalString(value)) return false;
  return BigInt(value.replace("-", "").replace(".", "")) === 0n;
}

function venue(source: PortfolioPerpSource): string {
  return source.dexName === ""
    ? "Hyperliquid"
    : (source.dexFullName ?? source.dexName);
}

interface MarketLookups {
  readonly perp: ReadonlyMap<string, PerpMarket | null>;
  readonly orders: ReadonlyMap<string, Market | null>;
}

function uniqueMarket<T extends Market>(
  map: Map<string, T | null>,
  key: string,
  market: T,
): void {
  map.set(key, map.has(key) ? null : market);
}

function marketLookups(markets: readonly Market[]): MarketLookups {
  const perp = new Map<string, PerpMarket | null>();
  const orders = new Map<string, Market | null>();
  for (const market of markets) {
    if (market.family === "perp") {
      uniqueMarket(perp, `${market.dexName}:${market.coin}`, market);
      uniqueMarket(orders, `${market.dexName}:${market.coin}`, market);
    } else if (market.family === "spot") {
      uniqueMarket(orders, `spot:${market.coin}`, market);
    }
  }
  return { perp, orders };
}

function immutableMarket<T extends Market>(market: T | null): T | null {
  if (market === null) return null;
  return Object.freeze({
    ...market,
    pricePrecision:
      market.pricePrecision === null
        ? null
        : Object.freeze({ ...market.pricePrecision }),
  }) as unknown as T;
}

function marketFor(
  lookups: MarketLookups,
  dexName: string,
  coin: string,
): PerpMarket | null {
  return lookups.perp.get(`${dexName}:${coin}`) ?? null;
}

function orderMarketFor(
  lookups: MarketLookups,
  dexName: string,
  coin: string,
): Market | null {
  const perp = lookups.orders.get(`${dexName}:${coin}`);
  const spot = lookups.orders.get(`spot:${coin}`);
  if (perp !== undefined && spot !== undefined) return null;
  return perp ?? spot ?? null;
}

function marginMode(value: string): "cross" | "isolated" | null {
  return value === "cross" || value === "isolated" ? value : null;
}

function performanceRanges(
  periods: readonly PortfolioPeriod[],
  gaps: string[],
): Partial<Record<PortfolioRange, PortfolioRangeData>> {
  const ranges: Partial<Record<PortfolioRange, PortfolioRangeData>> = {};
  for (const period of periods) {
    const range = PERIODS[period.period];
    if (!range || ranges[range]) {
      gaps.push(
        `Unsupported or duplicate performance period ${period.period} was retained as a source gap.`,
      );
      continue;
    }
    let summary: ReturnType<typeof summarizePerformanceSeries> = null;
    try {
      summary = summarizePerformanceSeries(period.accountValueHistory, {
        label: RANGE_LABELS[range],
        expectedCadenceMs: RANGE_CADENCE[range],
      });
    } catch {
      gaps.push(
        `Performance range ${range} contains invalid or non-monotonic account-value history.`,
      );
    }
    let pnlSummary: ReturnType<typeof summarizePerformanceSeries> = null;
    try {
      pnlSummary = summarizePerformanceSeries(period.pnlHistory, {
        label: `${RANGE_LABELS[range]} PnL`,
        expectedCadenceMs: RANGE_CADENCE[range],
      });
    } catch {
      gaps.push(
        `Performance range ${range} contains invalid or non-monotonic PnL history.`,
      );
    }
    if (summary === null) {
      gaps.push(`Performance range ${range} has no account-value history.`);
    } else if (summary.gapCount > 0) {
      gaps.push(
        `Performance range ${range} contains ${summary.gapCount} source gap${summary.gapCount === 1 ? "" : "s"}.`,
      );
    }
    if (pnlSummary === null) {
      gaps.push(`Performance range ${range} has no valid PnL history.`);
    }
    const absolutePnl = pnlSummary?.end ?? null;
    ranges[range] = {
      range,
      sourcePeriod: period.period,
      accountValueHistory: period.accountValueHistory,
      pnlHistory: period.pnlHistory,
      accountValueSummary: summary,
      accountValue: summary?.end ?? null,
      absolutePnl,
      percentagePnl:
        summary === null || absolutePnl === null
          ? null
          : percentageOf(absolutePnl, summary.start),
      gapCount: summary?.gapCount ?? 0,
    };
  }
  for (const range of ["24h", "7d", "30d", "all"] as const) {
    if (!ranges[range])
      gaps.push(`Performance range ${range} was not returned.`);
  }
  return ranges;
}

export function normalizePortfolioLiveSnapshot(
  source: PortfolioLiveSourceSnapshot,
): NormalizedPortfolioLive {
  if (!Number.isSafeInteger(source.observedAtMs) || source.observedAtMs < 0) {
    throw new Error("Portfolio observation time is invalid.");
  }
  const owner = Object.freeze({
    ...source.owner,
    target: Object.freeze({ ...source.owner.target }),
  });
  const gaps: string[] = [...(source.sourceGaps ?? [])];
  const positions: PortfolioPositionRow[] = [];
  const openOrders: PortfolioOpenOrderRow[] = [];
  const lookups = marketLookups(source.markets);
  let version = 0;
  for (const perp of source.perpStates) {
    if (!Number.isSafeInteger(perp.state.time) || perp.state.time < 0) {
      throw new Error("Perpetual account version is invalid.");
    }
    version = Math.max(version, perp.state.time);
    for (const position of perp.state.positions) {
      if (zero(position.size)) continue;
      const market = immutableMarket(
        marketFor(lookups, perp.dexName, position.coin),
      );
      if (market === null) {
        gaps.push(
          `No validated market matched perpetual position ${position.coin} on ${venue(perp)}.`,
        );
      }
      const active =
        market !== null &&
        market.lifecycle === "active" &&
        market.orderAvailability === "enabled";
      positions.push(
        Object.freeze({
          id: `${perp.dexName}:${position.coin}`,
          canonicalMarketId: market?.canonicalId ?? null,
          market,
          venue: venue(perp),
          coin: position.coin,
          size: position.size,
          absoluteSize: absoluteDecimal(position.size),
          side: position.size.startsWith("-") ? "short" : "long",
          entryPrice: position.entryPrice,
          liquidationPrice: position.liquidationPrice,
          positionValue: position.positionValue,
          unrealizedPnl: position.unrealizedPnl,
          returnOnEquity: position.returnOnEquity,
          leverage: position.leverage.value,
          marginMode: marginMode(position.leverage.type),
          maxLeverage: position.maxLeverage,
          onlyIsolated: market?.onlyIsolated ?? false,
          availableMargin: perp.state.withdrawable,
          accountVersion: perp.state.time,
          actionsEnabled: active,
          closeEnabled: active && market?.dexIndex === 0,
          marginActionEnabled: active,
        }),
      );
    }
    for (const order of perp.openOrders) {
      const market = immutableMarket(
        orderMarketFor(lookups, perp.dexName, order.coin),
      );
      if (market === null) {
        gaps.push(
          `No validated market matched open order ${order.oid} for ${order.coin} on ${venue(perp)}.`,
        );
      }
      openOrders.push(
        Object.freeze({
          id: `${perp.dexName}:${order.oid}`,
          canonicalMarketId: market?.canonicalId ?? null,
          market,
          venue: venue(perp),
          coin: order.coin,
          limitPrice: order.limitPrice,
          oid: order.oid,
          side: order.side,
          size: order.size,
          timestamp: order.timestamp,
          availableMargin: perp.state.withdrawable,
          accountVersion: perp.state.time,
          cancelEnabled:
            market !== null &&
            market.lifecycle === "active" &&
            market.orderAvailability === "enabled",
        }),
      );
    }
  }
  openOrders.sort((left, right) => right.timestamp - left.timestamp);
  return Object.freeze({
    owner,
    ownerKey: portfolioOwnerKey(owner),
    observedAtMs: source.observedAtMs,
    version,
    positions: Object.freeze(positions),
    openOrders: Object.freeze(openOrders),
    spotBalances: source.spotState.balances
      .filter((balance) => !zero(balance.total))
      .sort((left, right) => left.coin.localeCompare(right.coin)),
    gaps: [...new Set(gaps)],
  });
}

export function normalizePortfolioHistorySnapshot(
  source: PortfolioHistorySourceSnapshot,
): NormalizedPortfolioHistory {
  const gaps: string[] = [...(source.sourceGaps ?? [])];
  const activity: PortfolioActivityRow[] = [
    ...source.fills.map((fill) => ({
      id: `fill:${fill.hash}:${fill.oid}`,
      kind: "fill" as const,
      time: fill.time,
      coin: fill.coin,
      side: fill.side,
      amount: fill.closedPnl,
      detail: `Size ${fill.size} · Price ${fill.price}`,
    })),
    ...source.funding.map((funding) => ({
      id: portfolioFundingId(funding),
      kind: "funding" as const,
      time: funding.time,
      coin: funding.coin,
      side: null,
      amount: funding.usdc,
      detail: `Rate ${funding.fundingRate} · Position size ${funding.size}`,
    })),
  ].sort((left, right) => right.time - left.time);
  return Object.freeze({
    ranges: performanceRanges(source.periods, gaps),
    fills: [...source.fills].sort((left, right) => right.time - left.time),
    funding: [...source.funding].sort((left, right) => right.time - left.time),
    activity,
    gaps: [...new Set(gaps)],
  });
}

export function combineNormalizedPortfolio(
  live: NormalizedPortfolioLive,
  history: NormalizedPortfolioHistory | null,
): NormalizedPortfolio {
  return Object.freeze({
    ...live,
    ranges: history?.ranges ?? {},
    fills: history?.fills ?? [],
    funding: history?.funding ?? [],
    activity: history?.activity ?? [],
    gaps: [...new Set([...live.gaps, ...(history?.gaps ?? [])])],
  });
}

export function normalizePortfolioSnapshot(
  source: PortfolioSourceSnapshot,
): NormalizedPortfolio {
  return combineNormalizedPortfolio(
    normalizePortfolioLiveSnapshot(source),
    normalizePortfolioHistorySnapshot(source),
  );
}

export function createCloseDraft(position: PortfolioPositionRow): CloseDraft {
  if (!position.closeEnabled) {
    throw new Error("This position does not have current close authority.");
  }
  return {
    positionId: position.id,
    behavior: "market",
    size: position.absoluteSize,
    limitPrice: position.market?.markPx ?? position.entryPrice ?? "",
    timeInForce: "Gtc",
    slippageBps: "50",
  };
}

function parsedPositive(value: string, label: string): bigint {
  if (!isDecimalString(value) || value.startsWith("-")) {
    throw new Error(`${label} must be a positive decimal value.`);
  }
  const coefficient = BigInt(value.replace(".", ""));
  if (coefficient <= 0n) throw new Error(`${label} must be greater than zero.`);
  return coefficient;
}

function compareDecimal(left: string, right: string): number {
  parsedPositive(left, "Close size");
  parsedPositive(right, "Position size");
  const leftFraction = left.split(".")[1]?.length ?? 0;
  const rightFraction = right.split(".")[1]?.length ?? 0;
  const scale = Math.max(leftFraction, rightFraction);
  const a = BigInt(left.replace(".", "")) * 10n ** BigInt(scale - leftFraction);
  const b =
    BigInt(right.replace(".", "")) * 10n ** BigInt(scale - rightFraction);
  return a < b ? -1 : a > b ? 1 : 0;
}

export function buildCloseIntent(
  draft: CloseDraft,
  position: PortfolioPositionRow,
  prices: {
    readonly cloid: `0x${string}`;
    readonly aggressiveLimitPrice: DecimalString;
  },
): TradingActionIntent {
  if (!position.closeEnabled) {
    throw new Error("Closing this position is not currently available.");
  }
  if (
    position.market === null ||
    position.market.family !== "perp" ||
    position.market.dexIndex !== 0 ||
    position.market.lifecycle !== "active" ||
    position.market.orderAvailability !== "enabled"
  ) {
    throw new Error("A current validated market is required to close.");
  }
  if (draft.positionId !== position.id) {
    throw new Error("The close draft no longer matches this position.");
  }
  const comparison = compareDecimal(draft.size, position.absoluteSize);
  if (comparison > 0) {
    throw new Error("Close size cannot exceed the current position size.");
  }
  const side = position.side === "long" ? "sell" : "buy";
  if (draft.behavior === "market") {
    if (comparison !== 0) {
      throw new Error("Market close must use the full current position size.");
    }
    return {
      type: "reduce_only_close",
      assetId: position.market.orderAssetId,
      side,
      size: draft.size,
      aggressiveLimitPrice: prices.aggressiveLimitPrice,
      cloid: prices.cloid,
    };
  }
  parsedPositive(draft.limitPrice, "Limit price");
  return {
    type: "limit_order",
    assetId: position.market.orderAssetId,
    side,
    size: draft.size,
    limitPrice: draft.limitPrice,
    timeInForce: draft.timeInForce,
    reduceOnly: true,
    cloid: prices.cloid,
  };
}

export function portfolioMarketClosePrice(input: {
  readonly market: PerpMarket;
  readonly side: "buy" | "sell";
  readonly slippageBps: string;
}): DecimalString {
  if (!/^\d+$/.test(input.slippageBps)) {
    throw new Error("Slippage must be whole basis points from 0 through 500.");
  }
  const slippageBps = Number(input.slippageBps);
  if (!Number.isSafeInteger(slippageBps) || slippageBps > 500) {
    throw new Error("Slippage must be whole basis points from 0 through 500.");
  }
  const referencePrice = input.market.midPx ?? input.market.markPx;
  const precision = input.market.pricePrecision;
  if (referencePrice == null || precision == null) {
    throw new Error("A current market price and precision are required.");
  }
  return aggressiveOrderPrice({
    referencePrice,
    side: input.side,
    slippageBps,
    precision,
  });
}

export function buildCancelIntent(
  order: PortfolioOpenOrderRow,
): TradingActionIntent {
  if (!order.cancelEnabled || order.market === null) {
    throw new Error(
      "This exact open order cannot be canceled from current data.",
    );
  }
  return {
    type: "cancel",
    assetId: order.market.orderAssetId,
    target: { kind: "oid", oid: order.oid },
  };
}

export function buildLeverageIntent(
  position: PortfolioPositionRow,
  leverage: number,
  mode: "cross" | "isolated",
): TradingActionIntent {
  if (!position.marginActionEnabled || position.market === null) {
    throw new Error("Margin changes are unavailable for this position.");
  }
  if (
    !Number.isSafeInteger(leverage) ||
    leverage < 1 ||
    leverage > Math.min(position.maxLeverage, 100)
  ) {
    throw new Error("Leverage exceeds the current market maximum.");
  }
  if (position.onlyIsolated && mode !== "isolated") {
    throw new Error("This market requires isolated margin.");
  }
  return {
    type: "update_leverage",
    assetId: position.market.orderAssetId,
    leverage,
    marginMode: mode,
  };
}
