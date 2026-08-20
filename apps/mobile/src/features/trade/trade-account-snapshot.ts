import type {
  ActiveAssetData,
  ClearinghouseState,
  SpotClearinghouseState,
} from "@hyper-trader/hyperliquid";
import {
  type DecimalString,
  isDecimalString,
  type Market,
} from "@hyper-trader/hyperliquid/public";

import type { TradeAccountSnapshot } from "./trade-model";

function decimalParts(value: DecimalString): {
  readonly coefficient: bigint;
  readonly scale: number;
} {
  if (!isDecimalString(value)) throw new Error("Account balance is invalid.");
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  const coefficient = BigInt(`${whole}${fraction}`);
  return {
    coefficient: negative ? -coefficient : coefficient,
    scale: fraction.length,
  };
}

function formatUnsignedDecimal(
  coefficient: bigint,
  scale: number,
): DecimalString | null {
  if (coefficient < 0n) return null;
  if (scale === 0) return coefficient.toString() as DecimalString;
  const digits = coefficient.toString().padStart(scale + 1, "0");
  const split = digits.length - scale;
  const fraction = digits.slice(split).replace(/0+$/, "");
  return (
    fraction === ""
      ? digits.slice(0, split)
      : `${digits.slice(0, split)}.${fraction}`
  ) as DecimalString;
}

function availableSpotFunds(
  total: DecimalString,
  hold: DecimalString,
): DecimalString | null {
  const parsedTotal = decimalParts(total);
  const parsedHold = decimalParts(hold);
  const scale = Math.max(parsedTotal.scale, parsedHold.scale);
  const totalCoefficient =
    parsedTotal.coefficient * 10n ** BigInt(scale - parsedTotal.scale);
  const holdCoefficient =
    parsedHold.coefficient * 10n ** BigInt(scale - parsedHold.scale);
  return formatUnsignedDecimal(totalCoefficient - holdCoefficient, scale);
}

function validObservationTime(observedAtMs: number): boolean {
  return Number.isSafeInteger(observedAtMs) && observedAtMs >= 0;
}

export function tradePerpAccountSnapshot(input: {
  readonly state: ClearinghouseState;
  readonly activeAsset: ActiveAssetData;
  readonly market: Extract<Market, { readonly family: "perp" }>;
  readonly observedAtMs: number;
}): TradeAccountSnapshot | null {
  if (
    !validObservationTime(input.observedAtMs) ||
    !Number.isSafeInteger(input.state.time) ||
    input.state.time < 0 ||
    input.activeAsset.coin !== input.market.coin ||
    !isDecimalString(input.activeAsset.availableToTrade[0]) ||
    input.activeAsset.availableToTrade[0].startsWith("-") ||
    !isDecimalString(input.activeAsset.availableToTrade[1]) ||
    input.activeAsset.availableToTrade[1].startsWith("-") ||
    !Number.isSafeInteger(input.activeAsset.leverage.value) ||
    input.activeAsset.leverage.value < 1
  ) {
    return null;
  }
  const positions = input.state.positions.filter(
    (position) => position.coin === input.market.coin,
  );
  if (positions.length > 1) return null;
  const position = positions[0] ?? null;
  if (
    position !== null &&
    (!isDecimalString(position.size) ||
      !Number.isSafeInteger(position.leverage.value) ||
      position.leverage.value < 1 ||
      position.leverage.value !== input.activeAsset.leverage.value ||
      position.leverage.type !== input.activeAsset.leverage.type)
  ) {
    return null;
  }
  return Object.freeze({
    availableFunds: Object.freeze({
      buy: input.activeAsset.availableToTrade[0],
      sell: input.activeAsset.availableToTrade[1],
    }),
    leverage: input.activeAsset.leverage.value,
    marginMode: input.activeAsset.leverage.type,
    positionSize: position?.size ?? ("0" as DecimalString),
    version: input.state.time,
    observedAtMs: input.observedAtMs,
  });
}

export function tradeSpotAccountSnapshot(input: {
  readonly state: SpotClearinghouseState;
  readonly market: Extract<Market, { readonly family: "spot" }>;
  readonly observedAtMs: number;
}): TradeAccountSnapshot | null {
  if (!validObservationTime(input.observedAtMs)) return null;
  const quoteBalances = input.state.balances.filter(
    (balance) => balance.token === input.market.quoteToken.index,
  );
  const baseBalances = input.state.balances.filter(
    (balance) => balance.token === input.market.baseToken.index,
  );
  if (quoteBalances.length !== 1 || baseBalances.length > 1) return null;
  const quoteBalance = quoteBalances[0];
  if (!quoteBalance) return null;
  const availableFunds = availableSpotFunds(
    quoteBalance.total,
    quoteBalance.hold,
  );
  const positionSize = baseBalances[0]?.total ?? ("0" as DecimalString);
  if (availableFunds === null || !isDecimalString(positionSize)) return null;
  return Object.freeze({
    availableFunds: Object.freeze({
      buy: availableFunds,
      sell: availableFunds,
    }),
    leverage: null,
    marginMode: null,
    positionSize,
    version: input.observedAtMs,
    observedAtMs: input.observedAtMs,
  });
}
