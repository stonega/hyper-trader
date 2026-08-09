import { HyperliquidValidationError } from "../errors";

export type DecimalString = string;

const DECIMAL_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

export function isDecimalString(value: unknown): value is DecimalString {
  return typeof value === "string" && DECIMAL_PATTERN.test(value);
}

export function parseDecimalString(
  value: unknown,
  path: string,
): DecimalString {
  if (!isDecimalString(value)) {
    throw new HyperliquidValidationError(path, "expected a decimal string");
  }
  return value;
}

export function parseNullableDecimalString(
  value: unknown,
  path: string,
): DecimalString | null {
  return value === null ? null : parseDecimalString(value, path);
}
