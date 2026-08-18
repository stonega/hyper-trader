import { isDecimalString } from "@hyper-trader/hyperliquid/public";

import type { HyperliquidMonitorPayload } from "../monitor/hyperliquid-source";
import type {
  MonitorTarget,
  MonitorUpdate,
  SharedMonitorRegistry,
} from "../monitor/registry";
import {
  evaluateNotificationRule,
  type NotificationRuleEvent,
  type NotificationRuleRecord,
} from "./evaluator";

export interface ActiveNotificationRule extends NotificationRuleRecord {
  readonly accountAddress?: string;
}

export interface NotificationRuleWorkerStore {
  listActiveRules(
    limit: number,
    afterRuleId?: string,
  ): Promise<readonly ActiveNotificationRule[]>;
  createAlertForRuleMatch(input: {
    readonly ruleId: string;
    readonly identityDigest: string;
    readonly eventKey: string;
    readonly category: "execution" | "risk" | "price" | "funding";
    readonly routeHint: "trade" | "portfolio";
  }): Promise<
    | { readonly created: false }
    | {
        readonly created: true;
        readonly alertId: string;
        readonly outboxId: string;
      }
  >;
}

interface RuleState {
  readonly rule: ActiveNotificationRule;
  readonly metrics: Map<string, string>;
  unsubscribe: () => Promise<void>;
  queue: Promise<void>;
  pendingUpdates: number;
  degraded: boolean;
  detached: boolean;
  teardown?: Promise<void>;
}

const DEFAULT_MAX_PENDING_RULE_UPDATES = 128;

export class NotificationRuleWorker {
  readonly #store: NotificationRuleWorkerStore;
  readonly #registry: SharedMonitorRegistry;
  readonly #onError?: (
    kind: "decode" | "evaluate" | "persist" | "degraded",
  ) => void;
  readonly #maxPendingUpdates: number;
  readonly #states = new Map<string, RuleState>();
  readonly #statesByRuleId = new Map<
    string,
    { readonly key: string; readonly state: RuleState }
  >();

  constructor(input: {
    readonly store: NotificationRuleWorkerStore;
    readonly registry: SharedMonitorRegistry;
    readonly onError?: (
      kind: "decode" | "evaluate" | "persist" | "degraded",
    ) => void;
    readonly maxPendingUpdates?: number;
  }) {
    this.#store = input.store;
    this.#registry = input.registry;
    this.#onError = input.onError;
    const maxPendingUpdates =
      input.maxPendingUpdates ?? DEFAULT_MAX_PENDING_RULE_UPDATES;
    if (
      !Number.isSafeInteger(maxPendingUpdates) ||
      maxPendingUpdates < 1 ||
      maxPendingUpdates > 1_024
    ) {
      throw new Error("notification rule queue capacity is invalid");
    }
    this.#maxPendingUpdates = maxPendingUpdates;
  }

  async reconcileRules(
    authorizeEgress?: () => Promise<boolean>,
  ): Promise<void> {
    const rules: ActiveNotificationRule[] = [];
    let afterRuleId = "";
    let complete = false;
    for (let page = 0; page < 100; page += 1) {
      const batch = await this.#store.listActiveRules(1_000, afterRuleId);
      rules.push(...batch);
      if (batch.length < 1_000) {
        complete = true;
        break;
      }
      afterRuleId = batch.at(-1)?.ruleId ?? afterRuleId;
    }
    if (!complete) this.#report("degraded");
    const activeKeys = new Set(rules.map(ruleKey));
    const activeRuleIds = new Set(rules.map((rule) => rule.ruleId));
    if (complete) {
      for (const [key, state] of this.#states) {
        if (activeKeys.has(key) || activeRuleIds.has(state.rule.ruleId)) {
          continue;
        }
        this.#states.delete(key);
        this.#statesByRuleId.delete(state.rule.ruleId);
        await state.unsubscribe();
      }
    }
    for (const rule of rules) {
      const key = ruleKey(rule);
      const existing = this.#states.get(key);
      if (existing && !existing.degraded) continue;
      if (existing) {
        if (existing.pendingUpdates > 0 || !existing.detached) continue;
        this.#states.delete(key);
        if (this.#statesByRuleId.get(rule.ruleId)?.state === existing) {
          this.#statesByRuleId.delete(rule.ruleId);
        }
      }
      let target: MonitorTarget;
      try {
        target = monitorTarget(rule);
      } catch {
        this.#report("degraded");
        continue;
      }
      const metrics = new Map<string, string>();
      const state: RuleState = {
        rule,
        metrics,
        unsubscribe: async () => undefined,
        queue: Promise.resolve(),
        pendingUpdates: 0,
        degraded: false,
        detached: false,
      };
      try {
        state.unsubscribe = this.#registry.subscribe(target, (update) =>
          this.#enqueueUpdate(state, update),
        );
      } catch {
        this.#report("degraded");
        continue;
      }
      this.#states.set(key, state);
      const previous = this.#statesByRuleId.get(rule.ruleId);
      this.#statesByRuleId.set(rule.ruleId, { key, state });
      if (previous && previous.key !== key) {
        this.#states.delete(previous.key);
        await previous.state.unsubscribe();
      }
    }
    await this.#registry.reconcile(authorizeEgress);
  }

  async close(): Promise<void> {
    const states = [...this.#states.values()];
    this.#states.clear();
    this.#statesByRuleId.clear();
    await Promise.allSettled(states.map((state) => state.unsubscribe()));
    await Promise.allSettled(
      states.flatMap((state) => (state.teardown ? [state.teardown] : [])),
    );
    await Promise.all(states.map((state) => state.queue));
    await this.#registry.close();
  }

  #enqueueUpdate(state: RuleState, update: MonitorUpdate): void {
    if (state.degraded) return;
    if (state.pendingUpdates >= this.#maxPendingUpdates) {
      this.#degradeState(state);
      return;
    }
    state.pendingUpdates += 1;
    state.queue = state.queue
      .then(() => this.#handleUpdate(state, update))
      .catch(() => this.#report("evaluate"))
      .finally(() => {
        state.pendingUpdates -= 1;
      });
  }

  #degradeState(state: RuleState): void {
    if (state.degraded) return;
    state.degraded = true;
    this.#report("degraded");
    const teardown = state
      .unsubscribe()
      .catch(() => undefined)
      .finally(() => {
        state.detached = true;
      });
    state.teardown = teardown;
  }

  async #handleUpdate(state: RuleState, update: MonitorUpdate): Promise<void> {
    let events: readonly NotificationRuleEvent[];
    try {
      events = normalizeRuleUpdate(state.rule, state.metrics, update);
    } catch {
      this.#report("decode");
      return;
    }
    for (const event of events) {
      let match: Awaited<ReturnType<typeof evaluateNotificationRule>>;
      try {
        match = await evaluateNotificationRule(state.rule, event);
      } catch {
        this.#report("evaluate");
        continue;
      }
      if (!match) continue;
      try {
        await this.#store.createAlertForRuleMatch({
          ruleId: state.rule.ruleId,
          identityDigest: state.rule.identityDigest,
          ...match,
        });
      } catch {
        this.#report("persist");
      }
    }
  }

  #report(kind: "decode" | "evaluate" | "persist" | "degraded"): void {
    try {
      this.#onError?.(kind);
    } catch {
      // Bounded redacted telemetry cannot stop rule reconciliation.
    }
  }
}

export function normalizeRuleUpdate(
  rule: ActiveNotificationRule,
  metrics: Map<string, string>,
  update: MonitorUpdate,
): readonly NotificationRuleEvent[] {
  const payload = monitorPayload(update.value);
  if (!payload) return [];
  if (update.kind === "baseline") {
    const value = metricFromBaseline(rule, payload);
    if (value !== null) metrics.set(rule.eventType, value);
    return [];
  }
  if (payload.kind !== "stream-delta") return [];
  const execution = executionEvents(rule, payload);
  if (execution.length > 0) return execution;
  const metric = metricFromDelta(rule, payload);
  if (!metric) return [];
  const key = rule.eventType;
  const previous = metrics.get(key) ?? null;
  metrics.set(key, metric.value);
  return [
    {
      kind: "metric",
      metric: metric.metric,
      network: rule.network,
      marketId: rule.marketId,
      ...(rule.accountLinkId ? { accountLinkId: rule.accountLinkId } : {}),
      previous,
      current: metric.value,
      sourceId: `${payload.message.channel}:${payload.receivedAt}`,
    },
  ];
}

function executionEvents(
  rule: ActiveNotificationRule,
  payload: Extract<HyperliquidMonitorPayload, { kind: "stream-delta" }>,
): readonly NotificationRuleEvent[] {
  if (
    rule.eventType !== "fill" &&
    rule.eventType !== "cancellation" &&
    rule.eventType !== "rejection"
  ) {
    return [];
  }
  if (!rule.accountLinkId) return [];
  if (payload.message.channel === "userFills") {
    if (rule.eventType !== "fill") return [];
    const data = record(payload.message.data);
    const fills = Array.isArray(data?.fills) ? data.fills : [];
    return fills.flatMap((value) => {
      const fill = record(value);
      const coin = boundedText(fill?.coin);
      const marketId = coin ? payload.coinToMarketId[coin] : undefined;
      if (marketId !== rule.marketId) return [];
      const sourceId =
        boundedText(fill?.hash) ?? joinedSource(fill?.oid, fill?.time, "fill");
      if (!sourceId) return [];
      return [executionEvent(rule, "fill", sourceId)];
    });
  }
  if (payload.message.channel !== "orderUpdates") return [];
  const updates = Array.isArray(payload.message.data)
    ? payload.message.data
    : [];
  return updates.flatMap((value) => {
    const wrapper = record(value);
    const order = record(wrapper?.order);
    const coin = boundedText(order?.coin);
    const marketId = coin ? payload.coinToMarketId[coin] : undefined;
    const status = boundedText(wrapper?.status)?.toLowerCase();
    const eventType = status?.includes("cancel")
      ? "cancellation"
      : status?.includes("reject")
        ? "rejection"
        : null;
    if (marketId !== rule.marketId || eventType !== rule.eventType) return [];
    const sourceId = joinedSource(order?.oid, wrapper?.statusTimestamp, status);
    return sourceId ? [executionEvent(rule, eventType, sourceId)] : [];
  });
}

function metricFromBaseline(
  rule: ActiveNotificationRule,
  payload: HyperliquidMonitorPayload,
): string | null {
  if (payload.kind === "market-snapshot") {
    if (rule.eventType === "price_above" || rule.eventType === "price_below") {
      return decimal(payload.market.markPx) ?? decimal(payload.market.midPx);
    }
    return null;
  }
  if (payload.kind !== "account-snapshot") return null;
  const coin = Object.entries(payload.coinToMarketId).find(
    ([, marketId]) => marketId === rule.marketId,
  )?.[0];
  if (!coin) return null;
  if (
    rule.eventType === "funding_above" ||
    rule.eventType === "funding_below"
  ) {
    const funding = (payload.snapshots[0]?.funding ?? [])
      .filter((entry) => entry.coin === coin)
      .sort((left, right) => right.time - left.time)[0];
    return funding?.fundingRate ?? null;
  }
  const clearinghouse = payload.snapshots.find((snapshot) =>
    snapshot.clearinghouse.positions.some((position) => position.coin === coin),
  )?.clearinghouse;
  if (!clearinghouse) return null;
  if (rule.eventType === "margin_risk") {
    return clearinghouse.marginSummary.totalMarginUsed;
  }
  if (rule.eventType === "liquidation_risk") {
    return (
      clearinghouse.positions.find((position) => position.coin === coin)
        ?.liquidationPrice ?? null
    );
  }
  return null;
}

function metricFromDelta(
  rule: ActiveNotificationRule,
  payload: Extract<HyperliquidMonitorPayload, { kind: "stream-delta" }>,
): {
  readonly metric: "price" | "funding" | "margin_risk" | "liquidation_risk";
  readonly value: string;
} | null {
  const data = record(payload.message.data);
  if (payload.message.channel === "activeAssetCtx") {
    const coin = boundedText(data?.coin);
    if (!coin || payload.coinToMarketId[coin] !== rule.marketId) return null;
    const context = record(data?.ctx);
    if (rule.eventType === "price_above" || rule.eventType === "price_below") {
      const value = decimal(context?.markPx) ?? decimal(context?.midPx);
      return value ? { metric: "price", value } : null;
    }
  }
  if (
    payload.message.channel === "userFundings" &&
    (rule.eventType === "funding_above" || rule.eventType === "funding_below")
  ) {
    const values = Array.isArray(data?.fundings) ? data.fundings : [];
    for (const value of values) {
      const delta = record(record(value)?.delta);
      const coin = boundedText(delta?.coin);
      const rate = decimal(delta?.fundingRate);
      if (coin && payload.coinToMarketId[coin] === rule.marketId && rate) {
        return { metric: "funding", value: rate };
      }
    }
  }
  if (payload.message.channel !== "allDexsClearinghouseState") return null;
  const states = record(data?.clearinghouseStates);
  if (!states) return null;
  for (const candidate of Object.values(states)) {
    const clearinghouse = record(candidate);
    if (!clearinghouse) continue;
    const positions = Array.isArray(clearinghouse.assetPositions)
      ? clearinghouse.assetPositions
      : [];
    const matchingPosition = positions
      .map((wrapper) => record(record(wrapper)?.position))
      .find((position) => {
        const coin = boundedText(position?.coin);
        return coin && payload.coinToMarketId[coin] === rule.marketId;
      });
    if (!matchingPosition) continue;
    if (rule.eventType === "margin_risk") {
      const summary = record(clearinghouse.marginSummary);
      const value = decimal(summary?.totalMarginUsed);
      return value ? { metric: "margin_risk", value } : null;
    }
    if (rule.eventType === "liquidation_risk") {
      const value = decimal(matchingPosition.liquidationPx);
      return value ? { metric: "liquidation_risk", value } : null;
    }
  }
  return null;
}

function executionEvent(
  rule: ActiveNotificationRule,
  eventType: "fill" | "cancellation" | "rejection",
  sourceId: string,
): NotificationRuleEvent {
  return {
    kind: "execution",
    eventType,
    network: rule.network,
    marketId: rule.marketId,
    accountLinkId: rule.accountLinkId as string,
    sourceId,
  };
}

function monitorTarget(rule: ActiveNotificationRule): MonitorTarget {
  if (rule.scope === "price") {
    return { kind: "market", network: rule.network, marketId: rule.marketId };
  }
  if (!rule.accountAddress) {
    throw new Error("active account notification rule has no exact address");
  }
  return {
    kind: "account",
    network: rule.network,
    address: rule.accountAddress,
  };
}

function ruleKey(rule: ActiveNotificationRule): string {
  return `${rule.ruleId}:${rule.identityDigest}`;
}

function monitorPayload(value: unknown): HyperliquidMonitorPayload | null {
  const source = record(value);
  if (
    source?.kind !== "market-snapshot" &&
    source?.kind !== "account-snapshot" &&
    source?.kind !== "stream-delta"
  ) {
    return null;
  }
  return value as HyperliquidMonitorPayload;
}

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function boundedText(value: unknown): string | null {
  return typeof value === "string" && /^[\x21-\x7e]{1,256}$/.test(value)
    ? value
    : null;
}

function decimal(value: unknown): string | null {
  return isDecimalString(value) ? value : null;
}

function joinedSource(...values: readonly unknown[]): string | null {
  const source = values.map(String).join(":");
  return /^[\x21-\x7e]{1,256}$/.test(source) ? source : null;
}
