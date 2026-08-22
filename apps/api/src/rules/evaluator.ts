import { isDecimalString } from "@hyper-trader/hyperliquid/public";
import {
  type NotificationEventType,
  type NotificationNetwork,
  sha256Hex,
} from "@hyper-trader/notifications";

const HEX_128 = /^[0-9a-f]{32}$/;
const HEX_256 = /^[0-9a-f]{64}$/;
const CANONICAL_MARKET =
  /^(?:perp:(?:0|[1-9][0-9]*):(?:0|[1-9][0-9]*)|spot:(?:0|[1-9][0-9]*)|outcome:(?:0|[1-9][0-9]*):[01])$/;
const SOURCE_ID = /^[\x21-\x7e]{1,256}$/;

export interface NotificationRuleRecord {
  readonly ruleId: string;
  readonly identityDigest: string;
  readonly installationId: string;
  readonly accountLinkId?: string;
  readonly scope: "price" | "account";
  readonly network: NotificationNetwork;
  readonly marketId: string;
  readonly eventType: NotificationEventType;
  readonly threshold: string;
}

export type NotificationRuleEvent =
  | {
      readonly kind: "execution";
      readonly eventType: "fill" | "cancellation" | "rejection";
      readonly network: NotificationNetwork;
      readonly marketId: string;
      readonly accountLinkId: string;
      readonly sourceId: string;
    }
  | {
      readonly kind: "metric";
      readonly metric: "price" | "funding" | "margin_risk" | "liquidation_risk";
      readonly network: NotificationNetwork;
      readonly marketId: string;
      readonly accountLinkId?: string;
      readonly previous: string | null;
      readonly current: string;
      readonly sourceId: string;
    };

export interface NotificationRuleMatch {
  readonly eventKey: string;
  readonly category: "execution" | "risk" | "price" | "funding";
  readonly routeHint: "trade" | "portfolio";
  readonly alertId?: never;
}

export async function evaluateNotificationRule(
  rule: NotificationRuleRecord,
  event: NotificationRuleEvent,
): Promise<NotificationRuleMatch | null> {
  validateRule(rule);
  validateEvent(event);
  if (
    rule.network !== event.network ||
    rule.marketId !== event.marketId ||
    (rule.scope === "account" && rule.accountLinkId !== event.accountLinkId) ||
    (rule.scope === "price" && event.accountLinkId !== undefined)
  ) {
    return null;
  }

  let category: NotificationRuleMatch["category"];
  let routeHint: NotificationRuleMatch["routeHint"];
  if (event.kind === "execution") {
    if (rule.eventType !== event.eventType) return null;
    category = "execution";
    routeHint = "portfolio";
  } else {
    if (event.previous === null) return null;
    const direction = ruleDirection(rule.eventType, event.metric);
    if (!direction) return null;
    const previous = compareExactDecimals(event.previous, rule.threshold);
    const current = compareExactDecimals(event.current, rule.threshold);
    const crossed =
      direction === "above"
        ? previous < 0 && current >= 0
        : previous > 0 && current <= 0;
    if (!crossed) return null;
    category =
      event.metric === "price"
        ? "price"
        : event.metric === "funding"
          ? "funding"
          : "risk";
    routeHint = event.metric === "price" ? "trade" : "portfolio";
  }

  return {
    eventKey: await sha256Hex(
      [
        "notification-event/v1",
        rule.ruleId,
        rule.identityDigest,
        event.network,
        event.marketId,
        event.accountLinkId ?? "public",
        event.sourceId,
      ].join("|"),
    ),
    category,
    routeHint,
  };
}

export function compareExactDecimals(left: string, right: string): -1 | 0 | 1 {
  const first = parseExactDecimal(left);
  const second = parseExactDecimal(right);
  if (first.sign !== second.sign) return first.sign < second.sign ? -1 : 1;
  if (first.sign === 0) return 0;
  const scale = Math.max(first.fraction.length, second.fraction.length);
  const firstDigits = `${first.integer}${first.fraction.padEnd(scale, "0")}`;
  const secondDigits = `${second.integer}${second.fraction.padEnd(scale, "0")}`;
  const magnitude = compareUnsignedDigits(firstDigits, secondDigits);
  return first.sign === 1 ? magnitude : invert(magnitude);
}

function parseExactDecimal(value: string): {
  readonly sign: -1 | 0 | 1;
  readonly integer: string;
  readonly fraction: string;
} {
  if (!isDecimalString(value)) {
    throw new Error("notification decimal is invalid");
  }
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [integerPart = "0", fractionPart = ""] = unsigned.split(".");
  const integer = integerPart.replace(/^0+(?=[0-9])/, "");
  const fraction = fractionPart.replace(/0+$/, "");
  const zero = integer === "0" && fraction.length === 0;
  return {
    sign: zero ? 0 : negative ? -1 : 1,
    integer,
    fraction,
  };
}

function compareUnsignedDigits(left: string, right: string): -1 | 0 | 1 {
  const first = left.replace(/^0+(?=[0-9])/, "");
  const second = right.replace(/^0+(?=[0-9])/, "");
  if (first.length !== second.length)
    return first.length < second.length ? -1 : 1;
  return first === second ? 0 : first < second ? -1 : 1;
}

function invert(value: -1 | 0 | 1): -1 | 0 | 1 {
  return value === 0 ? 0 : value === 1 ? -1 : 1;
}

function ruleDirection(
  eventType: NotificationEventType,
  metric: Extract<NotificationRuleEvent, { kind: "metric" }>["metric"],
): "above" | "below" | null {
  if (metric === "price") {
    if (eventType === "price_above") return "above";
    if (eventType === "price_below") return "below";
  }
  if (metric === "funding") {
    if (eventType === "funding_above") return "above";
    if (eventType === "funding_below") return "below";
  }
  if (metric === "margin_risk" && eventType === "margin_risk") return "above";
  if (metric === "liquidation_risk" && eventType === "liquidation_risk") {
    return "below";
  }
  return null;
}

function validateRule(rule: NotificationRuleRecord): void {
  if (
    !HEX_128.test(rule.ruleId) ||
    !HEX_256.test(rule.identityDigest) ||
    !HEX_128.test(rule.installationId) ||
    !CANONICAL_MARKET.test(rule.marketId) ||
    !isDecimalString(rule.threshold) ||
    (rule.scope === "account" &&
      (!rule.accountLinkId || !HEX_128.test(rule.accountLinkId))) ||
    (rule.scope === "price" && rule.accountLinkId !== undefined)
  ) {
    throw new Error("notification rule is invalid");
  }
}

function validateEvent(event: NotificationRuleEvent): void {
  if (
    !CANONICAL_MARKET.test(event.marketId) ||
    !SOURCE_ID.test(event.sourceId) ||
    (event.accountLinkId !== undefined && !HEX_128.test(event.accountLinkId))
  ) {
    throw new Error("notification event is invalid");
  }
  if (
    event.kind === "metric" &&
    (!isDecimalString(event.current) ||
      (event.previous !== null && !isDecimalString(event.previous)))
  ) {
    throw new Error("notification decimal is invalid");
  }
}
