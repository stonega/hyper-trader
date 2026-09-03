import {
  type DecimalString,
  isDecimalString,
  type PricePrecisionInputs,
} from "@hyper-trader/hyperliquid/public";

import { roundedPriceInputValue } from "../actions/aggressive-order-price";

type PositionSide = "long" | "short";
type PositionTpslKind = "stop_loss" | "take_profit";

interface DecimalParts {
  readonly coefficient: bigint;
  readonly scale: number;
}

const PERCENTAGE_DISPLAY_DECIMALS = 4;

function decimalParts(value: string | null | undefined): DecimalParts | null {
  if (
    value === null ||
    value === undefined ||
    !isDecimalString(value) ||
    value.startsWith("-")
  ) {
    return null;
  }
  const [whole = "0", fraction = ""] = value.split(".");
  const coefficient = BigInt(`${whole}${fraction}`);
  return coefficient > 0n ? { coefficient, scale: fraction.length } : null;
}

function percentageParts(value: string): DecimalParts | null {
  if (!/^(?:(?:0|[1-9]\d*)(?:\.\d*)?|\.\d+)$/.test(value)) return null;
  const [whole = "", fraction = ""] = value.split(".");
  const coefficient = BigInt(`${whole}${fraction}`);
  return coefficient > 0n ? { coefficient, scale: fraction.length } : null;
}

function powerOfTen(scale: number): bigint {
  return 10n ** BigInt(scale);
}

function formatCoefficient(coefficient: bigint, scale: number): DecimalString {
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

function triggerIncreasesFromEntry(
  side: PositionSide,
  kind: PositionTpslKind,
): boolean {
  return (
    (side === "long" && kind === "take_profit") ||
    (side === "short" && kind === "stop_loss")
  );
}

export function positionTpslPriceFromPercentage(input: {
  readonly entryPrice: string | null;
  readonly kind: PositionTpslKind;
  readonly percentage: string;
  readonly precision: PricePrecisionInputs | null;
  readonly side: PositionSide;
}): DecimalString | null {
  const entry = decimalParts(input.entryPrice);
  const percentage = percentageParts(input.percentage);
  if (entry === null || percentage === null || input.precision === null) {
    return null;
  }

  const percentageBase = 100n * powerOfTen(percentage.scale);
  const increases = triggerIncreasesFromEntry(input.side, input.kind);
  if (!increases && percentage.coefficient >= percentageBase) return null;
  const factor = increases
    ? percentageBase + percentage.coefficient
    : percentageBase - percentage.coefficient;
  const unroundedPrice = formatCoefficient(
    entry.coefficient * factor,
    entry.scale + percentage.scale + 2,
  );
  const roundedPrice = roundedPriceInputValue({
    price: unroundedPrice,
    precision: input.precision,
  });
  if (
    roundedPrice === null ||
    positionTpslPercentageFromPrice({
      entryPrice: input.entryPrice,
      kind: input.kind,
      side: input.side,
      triggerPrice: roundedPrice,
    }) === null
  ) {
    return null;
  }
  return roundedPrice;
}

export function positionTpslPercentageFromPrice(input: {
  readonly entryPrice: string | null;
  readonly kind: PositionTpslKind;
  readonly side: PositionSide;
  readonly triggerPrice: string;
}): DecimalString | null {
  const entry = decimalParts(input.entryPrice);
  const trigger = decimalParts(input.triggerPrice);
  if (entry === null || trigger === null) return null;

  const commonScale = Math.max(entry.scale, trigger.scale);
  const entryCoefficient =
    entry.coefficient * powerOfTen(commonScale - entry.scale);
  const triggerCoefficient =
    trigger.coefficient * powerOfTen(commonScale - trigger.scale);
  const increases = triggerIncreasesFromEntry(input.side, input.kind);
  if (
    (increases && triggerCoefficient <= entryCoefficient) ||
    (!increases && triggerCoefficient >= entryCoefficient)
  ) {
    return null;
  }

  const difference =
    triggerCoefficient > entryCoefficient
      ? triggerCoefficient - entryCoefficient
      : entryCoefficient - triggerCoefficient;
  const numerator = difference * 100n * powerOfTen(PERCENTAGE_DISPLAY_DECIMALS);
  let percentageCoefficient = numerator / entryCoefficient;
  if ((numerator % entryCoefficient) * 2n >= entryCoefficient) {
    percentageCoefficient += 1n;
  }
  return formatCoefficient(percentageCoefficient, PERCENTAGE_DISPLAY_DECIMALS);
}
