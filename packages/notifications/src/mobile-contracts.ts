import {
  CONTRACT_LIMITS,
  ContractError,
  type CreateRuleRequest,
  exactContractRecord,
  NOTIFICATION_EVENT_TYPES,
  NOTIFICATION_HEX_128,
  type NotificationEventType,
  type NotificationNetwork,
  parseCreateRuleRequest,
} from "./contracts";

export interface DeletePriceRuleRequest {
  readonly installationId: string;
  readonly ruleId: string;
}

export type MobileDeliveryHealth = "healthy" | "pending" | "attention";
export type MobilePushTokenState = "active" | "invalid";

export interface MobileAccountLinkSummary {
  readonly accountLinkId: string;
  readonly network: NotificationNetwork;
  readonly masterAccount: string;
  readonly targetAccount: string;
}

export interface MobileInstallationSnapshotResponse {
  readonly installationId: string;
  readonly state: "active";
  readonly tokenState: MobilePushTokenState;
  readonly deliveryHealth: MobileDeliveryHealth;
  readonly pendingDeliveryCount: number;
  readonly unknownDeliveryCount: number;
  readonly accountLinks: readonly MobileAccountLinkSummary[];
  readonly rules: readonly CreateRuleRequest[];
}

export type MobileAlertDeliveryState =
  | "pending"
  | "leased"
  | "provider_submission_started"
  | "provider_accepted"
  | "provider_rejected"
  | "provider_outcome_unknown"
  | "cancelled";

export interface MobileAlertResponse {
  readonly alertId: string;
  readonly state: "active" | "target_unavailable";
  readonly category: "execution" | "risk" | "price" | "funding";
  readonly network: NotificationNetwork;
  readonly routeHint: "trade" | "portfolio";
  readonly createdAtMs: number;
  readonly deliveryState: MobileAlertDeliveryState;
  readonly rule: {
    readonly ruleId: string;
    readonly scope: "price" | "account";
    readonly marketId: string;
    readonly eventType: NotificationEventType;
  } | null;
  readonly account: {
    readonly accountLinkId: string;
    readonly masterAccount: string;
    readonly targetAccount: string;
  } | null;
}

const ADDRESS = /^0x[0-9a-f]{40}$/;
const DELIVERY_STATES: ReadonlySet<MobileAlertDeliveryState> = new Set([
  "pending",
  "leased",
  "provider_submission_started",
  "provider_accepted",
  "provider_rejected",
  "provider_outcome_unknown",
  "cancelled",
]);

export function parseDeletePriceRuleRequest(
  value: unknown,
): DeletePriceRuleRequest {
  const input = exactRecord(value, ["installationId", "ruleId"], "request");
  return {
    installationId: hexId(input.installationId, "installationId"),
    ruleId: hexId(input.ruleId, "ruleId"),
  };
}

export function parseMobileInstallationSnapshotResponse(
  value: unknown,
): MobileInstallationSnapshotResponse {
  const input = exactRecord(
    value,
    [
      "installationId",
      "state",
      "tokenState",
      "deliveryHealth",
      "pendingDeliveryCount",
      "unknownDeliveryCount",
      "accountLinks",
      "rules",
    ],
    "response",
  );
  if (input.state !== "active")
    throw new ContractError("response state is invalid");
  if (input.tokenState !== "active" && input.tokenState !== "invalid") {
    throw new ContractError("response token state is invalid");
  }
  if (
    input.deliveryHealth !== "healthy" &&
    input.deliveryHealth !== "pending" &&
    input.deliveryHealth !== "attention"
  ) {
    throw new ContractError("response delivery health is invalid");
  }
  const accountLinks = boundedArray(
    input.accountLinks,
    CONTRACT_LIMITS.maxLinkedAccounts,
    "response account links",
  ).map(parseMobileAccountLink);
  const seenLinks = new Set<string>();
  for (const link of accountLinks) {
    if (seenLinks.has(link.accountLinkId)) {
      throw new ContractError("response account links are duplicated");
    }
    seenLinks.add(link.accountLinkId);
  }
  const rules = boundedArray(
    input.rules,
    CONTRACT_LIMITS.maxActiveRules,
    "response rules",
  ).map(parseCreateRuleRequest);
  const seenRules = new Set<string>();
  for (const rule of rules) {
    if (seenRules.has(rule.ruleId)) {
      throw new ContractError("response rules are duplicated");
    }
    if (
      rule.scope === "account" &&
      (!rule.accountLinkId || !seenLinks.has(rule.accountLinkId))
    ) {
      throw new ContractError("response account rule link is unavailable");
    }
    seenRules.add(rule.ruleId);
  }
  return {
    installationId: hexId(input.installationId, "installationId"),
    state: "active",
    tokenState: input.tokenState,
    deliveryHealth: input.deliveryHealth,
    pendingDeliveryCount: boundedCount(
      input.pendingDeliveryCount,
      "pendingDeliveryCount",
    ),
    unknownDeliveryCount: boundedCount(
      input.unknownDeliveryCount,
      "unknownDeliveryCount",
    ),
    accountLinks,
    rules,
  };
}

export function parseMobileAlertResponse(value: unknown): MobileAlertResponse {
  const input = exactRecord(
    value,
    [
      "alertId",
      "state",
      "category",
      "network",
      "routeHint",
      "createdAtMs",
      "deliveryState",
      "rule",
      "account",
    ],
    "response",
  );
  if (input.state !== "active" && input.state !== "target_unavailable") {
    throw new ContractError("response alert state is invalid");
  }
  if (
    input.category !== "execution" &&
    input.category !== "risk" &&
    input.category !== "price" &&
    input.category !== "funding"
  ) {
    throw new ContractError("response alert category is invalid");
  }
  const network = notificationNetwork(input.network, "response network");
  if (input.routeHint !== "trade" && input.routeHint !== "portfolio") {
    throw new ContractError("response route hint is invalid");
  }
  if (!DELIVERY_STATES.has(input.deliveryState as MobileAlertDeliveryState)) {
    throw new ContractError("response delivery state is invalid");
  }
  const rule = input.rule === null ? null : parseMobileAlertRule(input.rule);
  const account =
    input.account === null ? null : parseMobileAlertAccount(input.account);
  if (
    input.state === "active" &&
    (rule === null || (rule.scope === "account" && account === null))
  ) {
    throw new ContractError("response active target is incomplete");
  }
  if (rule?.scope === "price" && account !== null) {
    throw new ContractError("response price alert has account authority");
  }
  return {
    alertId: hexId(input.alertId, "alertId"),
    state: input.state,
    category: input.category,
    network,
    routeHint: input.routeHint,
    createdAtMs: timestamp(input.createdAtMs, "createdAtMs"),
    deliveryState: input.deliveryState as MobileAlertDeliveryState,
    rule,
    account,
  };
}

function parseMobileAccountLink(value: unknown): MobileAccountLinkSummary {
  const input = exactRecord(
    value,
    ["accountLinkId", "network", "masterAccount", "targetAccount"],
    "response",
  );
  return {
    accountLinkId: hexId(input.accountLinkId, "accountLinkId"),
    network: notificationNetwork(input.network, "account link network"),
    masterAccount: address(input.masterAccount, "masterAccount"),
    targetAccount: address(input.targetAccount, "targetAccount"),
  };
}

function parseMobileAlertRule(
  value: unknown,
): NonNullable<MobileAlertResponse["rule"]> {
  const input = exactRecord(
    value,
    ["ruleId", "scope", "marketId", "eventType"],
    "response",
  );
  if (input.scope !== "price" && input.scope !== "account") {
    throw new ContractError("response rule scope is invalid");
  }
  if (
    typeof input.marketId !== "string" ||
    input.marketId.length < 1 ||
    input.marketId.length > CONTRACT_LIMITS.maxMarketIdChars ||
    !/^[\x21-\x7e]+$/.test(input.marketId)
  ) {
    throw new ContractError("response market ID is invalid");
  }
  if (!NOTIFICATION_EVENT_TYPES.has(input.eventType as NotificationEventType)) {
    throw new ContractError("response event type is invalid");
  }
  return {
    ruleId: hexId(input.ruleId, "ruleId"),
    scope: input.scope,
    marketId: input.marketId,
    eventType: input.eventType as NotificationEventType,
  };
}

function parseMobileAlertAccount(
  value: unknown,
): NonNullable<MobileAlertResponse["account"]> {
  const input = exactRecord(
    value,
    ["accountLinkId", "masterAccount", "targetAccount"],
    "response",
  );
  return {
    accountLinkId: hexId(input.accountLinkId, "accountLinkId"),
    masterAccount: address(input.masterAccount, "masterAccount"),
    targetAccount: address(input.targetAccount, "targetAccount"),
  };
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
  label: "request" | "response",
): Record<string, unknown> {
  return exactContractRecord(value, keys, { label, requireAll: true });
}

function hexId(value: unknown, field: string): string {
  if (typeof value !== "string" || !NOTIFICATION_HEX_128.test(value)) {
    throw new ContractError(`${field} must be 128-bit lowercase hex`);
  }
  return value;
}

function address(value: unknown, field: string): string {
  if (typeof value !== "string" || !ADDRESS.test(value)) {
    throw new ContractError(`${field} must be a lowercase account address`);
  }
  return value;
}

function notificationNetwork(
  value: unknown,
  field: string,
): NotificationNetwork {
  if (value !== "testnet" && value !== "mainnet") {
    throw new ContractError(`${field} is invalid`);
  }
  return value;
}

function boundedArray(
  value: unknown,
  max: number,
  field: string,
): readonly unknown[] {
  if (!Array.isArray(value) || value.length > max) {
    throw new ContractError(`${field} is invalid`);
  }
  return value;
}

function boundedCount(value: unknown, field: string): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 0 ||
    (value as number) > 1_000_000
  ) {
    throw new ContractError(`${field} is invalid`);
  }
  return value as number;
}

function timestamp(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new ContractError(`${field} is invalid`);
  }
  return value as number;
}
