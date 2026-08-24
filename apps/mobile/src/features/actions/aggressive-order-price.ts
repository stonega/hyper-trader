import {
  type DecimalString,
  isDecimalString,
  type PricePrecisionInputs,
} from "@hyper-trader/hyperliquid/public";

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

/**
 * Derives the IOC limit used to implement a market order while keeping the
 * rounded price inside the user's maximum slippage.
 */
export function aggressiveOrderPrice(input: {
  readonly referencePrice: string;
  readonly side: "buy" | "sell";
  readonly slippageBps: number;
  readonly precision: PricePrecisionInputs;
}): DecimalString {
  if (
    !Number.isSafeInteger(input.slippageBps) ||
    input.slippageBps < 0 ||
    input.slippageBps > 500
  ) {
    throw new Error("Slippage must be whole basis points from 0 through 500.");
  }
  if (
    !isDecimalString(input.referencePrice) ||
    input.referencePrice.startsWith("-")
  ) {
    throw new Error("Reference price must be a positive decimal value.");
  }
  const [whole = "0", fraction = ""] = input.referencePrice.split(".");
  const reference = {
    coefficient: BigInt(`${whole}${fraction}`),
    scale: fraction.length,
  };
  if (reference.coefficient <= 0n) {
    throw new Error("Reference price must be greater than zero.");
  }
  const wholeDigits = Math.max(
    1,
    reference.coefficient.toString().length - reference.scale,
  );
  const targetScale = Math.max(
    0,
    Math.min(
      input.precision.maxDecimalPlaces,
      input.precision.maxSignificantFigures - wholeDigits,
    ),
  );
  const factor = BigInt(
    input.side === "buy"
      ? 10_000 + input.slippageBps
      : 10_000 - input.slippageBps,
  );
  const numerator = reference.coefficient * factor * powerOfTen(targetScale);
  const denominator = powerOfTen(reference.scale) * 10_000n;
  let coefficient = numerator / denominator;
  if (input.side === "sell" && numerator % denominator !== 0n) {
    coefficient += 1n;
  }
  if (coefficient <= 0n) {
    throw new Error("The slippage price bound is not positive.");
  }
  return formatCoefficient(coefficient, targetScale);
}
