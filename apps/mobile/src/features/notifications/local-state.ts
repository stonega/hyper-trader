import {
  CONTRACT_LIMITS,
  type CreateRuleRequest,
  parseCreateRuleRequest,
} from "@hyper-trader/notifications/mobile";

export const NOTIFICATION_LOCAL_STATE_KEY =
  "@hyper-trader/notification-local-state/v1";

const MAX_DOCUMENT_BYTES = 64 * 1024;
const MAX_HANDLED_ALERTS = 256;

export interface NotificationLocalStateSnapshot {
  readonly status: "loading" | "ready" | "error";
  readonly pendingPriceMutations: readonly CreateRuleRequest[];
  readonly handledAlertIds: readonly string[];
}

export interface NotificationLocalStateRepository {
  read(): NotificationLocalStateSnapshot;
  hydrate(): Promise<NotificationLocalStateSnapshot>;
  queuePriceRule(
    rule: CreateRuleRequest,
  ): Promise<NotificationLocalStateSnapshot>;
  removePendingPriceRules(
    ruleIds: readonly string[],
  ): Promise<NotificationLocalStateSnapshot>;
  markAlertHandled(alertId: string): Promise<NotificationLocalStateSnapshot>;
  hasHandledAlert(alertId: string): Promise<boolean>;
  clear(): Promise<NotificationLocalStateSnapshot>;
}

export interface NotificationLocalStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem?(key: string): Promise<void>;
}

interface PersistedNotificationLocalState {
  readonly version: 1;
  readonly pendingPriceMutations: readonly CreateRuleRequest[];
  readonly handledAlertIds: readonly string[];
}

const ALERT_ID = /^[0-9a-f]{32}$/;

function freezeSnapshot(
  snapshot: NotificationLocalStateSnapshot,
): NotificationLocalStateSnapshot {
  return Object.freeze({
    ...snapshot,
    pendingPriceMutations: Object.freeze([...snapshot.pendingPriceMutations]),
    handledAlertIds: Object.freeze([...snapshot.handledAlertIds]),
  });
}

function empty(
  status: NotificationLocalStateSnapshot["status"],
): NotificationLocalStateSnapshot {
  return freezeSnapshot({
    status,
    pendingPriceMutations: [],
    handledAlertIds: [],
  });
}

function parsePersisted(value: string | null): PersistedNotificationLocalState {
  if (value === null) {
    return { version: 1, pendingPriceMutations: [], handledAlertIds: [] };
  }
  if (new TextEncoder().encode(value).byteLength > MAX_DOCUMENT_BYTES) {
    throw new Error("notification local state exceeds its size limit");
  }
  const parsed = JSON.parse(value) as unknown;
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    Object.getPrototypeOf(parsed) !== Object.prototype
  ) {
    throw new Error("notification local state is malformed");
  }
  const input = parsed as Record<string, unknown>;
  const keys = Object.keys(input).sort();
  if (
    keys.length !== 3 ||
    keys[0] !== "handledAlertIds" ||
    keys[1] !== "pendingPriceMutations" ||
    keys[2] !== "version" ||
    input.version !== 1 ||
    !Array.isArray(input.pendingPriceMutations) ||
    input.pendingPriceMutations.length > CONTRACT_LIMITS.maxActiveRules ||
    !Array.isArray(input.handledAlertIds) ||
    input.handledAlertIds.length > MAX_HANDLED_ALERTS
  ) {
    throw new Error("notification local state is malformed");
  }
  const pendingPriceMutations = input.pendingPriceMutations.map((rule) => {
    const parsedRule = parseCreateRuleRequest(rule);
    if (parsedRule.scope !== "price") {
      throw new Error("account proof material cannot be queued offline");
    }
    return parsedRule;
  });
  const handledAlertIds = input.handledAlertIds.map((candidate) => {
    if (typeof candidate !== "string" || !ALERT_ID.test(candidate)) {
      throw new Error("notification alert history is malformed");
    }
    return candidate;
  });
  if (new Set(handledAlertIds).size !== handledAlertIds.length) {
    throw new Error("notification alert history is duplicated");
  }
  return { version: 1, pendingPriceMutations, handledAlertIds };
}

function serialize(document: PersistedNotificationLocalState): string {
  const value = JSON.stringify(document);
  if (new TextEncoder().encode(value).byteLength > MAX_DOCUMENT_BYTES) {
    throw new Error("notification local state exceeds its size limit");
  }
  return value;
}

export function createNotificationLocalStateRepository(
  storage: NotificationLocalStorage,
): NotificationLocalStateRepository {
  let snapshot = empty("loading");
  let hydrated = false;
  let queue = Promise.resolve();

  const commit = async (
    pendingPriceMutations: readonly CreateRuleRequest[],
    handledAlertIds: readonly string[],
  ) => {
    const document: PersistedNotificationLocalState = {
      version: 1,
      pendingPriceMutations,
      handledAlertIds,
    };
    await storage.setItem(NOTIFICATION_LOCAL_STATE_KEY, serialize(document));
    snapshot = freezeSnapshot({
      status: "ready",
      pendingPriceMutations,
      handledAlertIds,
    });
    return snapshot;
  };
  const serialized = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = queue.then(operation, operation);
    queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  const requireReady = () => {
    if (!hydrated || snapshot.status !== "ready") {
      throw new Error("notification local state is not ready");
    }
  };

  return {
    read: () => snapshot,
    hydrate: () =>
      serialized(async () => {
        if (hydrated) return snapshot;
        try {
          const document = parsePersisted(
            await storage.getItem(NOTIFICATION_LOCAL_STATE_KEY),
          );
          hydrated = true;
          snapshot = freezeSnapshot({
            status: "ready",
            pendingPriceMutations: document.pendingPriceMutations,
            handledAlertIds: document.handledAlertIds,
          });
        } catch {
          hydrated = false;
          snapshot = empty("error");
        }
        return snapshot;
      }),
    queuePriceRule: (rule) =>
      serialized(async () => {
        requireReady();
        const parsed = parseCreateRuleRequest(rule);
        if (parsed.scope !== "price") {
          throw new Error("account proof material cannot be queued offline");
        }
        const existing = snapshot.pendingPriceMutations.find(
          (candidate) => candidate.ruleId === parsed.ruleId,
        );
        if (existing && sameRule(existing, parsed)) return snapshot;
        const next = [
          ...snapshot.pendingPriceMutations.filter(
            (candidate) => candidate.ruleId !== parsed.ruleId,
          ),
          parsed,
        ];
        if (next.length > CONTRACT_LIMITS.maxActiveRules) {
          throw new Error("notification pending rule limit has been reached");
        }
        return commit(next, snapshot.handledAlertIds);
      }),
    removePendingPriceRules: (ruleIds) =>
      serialized(async () => {
        requireReady();
        if (ruleIds.length > CONTRACT_LIMITS.maxActiveRules) {
          throw new Error("rule ID batch is malformed");
        }
        const removed = new Set(ruleIds);
        if (
          removed.size !== ruleIds.length ||
          ruleIds.some((ruleId) => !ALERT_ID.test(ruleId))
        ) {
          throw new Error("rule ID batch is malformed");
        }
        const next = snapshot.pendingPriceMutations.filter(
          (candidate) => !removed.has(candidate.ruleId),
        );
        return next.length === snapshot.pendingPriceMutations.length
          ? snapshot
          : commit(next, snapshot.handledAlertIds);
      }),
    markAlertHandled: (alertId) =>
      serialized(async () => {
        requireReady();
        if (!ALERT_ID.test(alertId)) throw new Error("alert ID is malformed");
        if (snapshot.handledAlertIds.includes(alertId)) return snapshot;
        const handledAlertIds = [...snapshot.handledAlertIds, alertId].slice(
          -MAX_HANDLED_ALERTS,
        );
        return commit(snapshot.pendingPriceMutations, handledAlertIds);
      }),
    hasHandledAlert: async (alertId) => {
      if (!ALERT_ID.test(alertId)) return true;
      return snapshot.handledAlertIds.includes(alertId);
    },
    clear: () =>
      serialized(async () => {
        if (storage.removeItem) {
          await storage.removeItem(NOTIFICATION_LOCAL_STATE_KEY);
        } else {
          await storage.setItem(
            NOTIFICATION_LOCAL_STATE_KEY,
            serialize({
              version: 1,
              pendingPriceMutations: [],
              handledAlertIds: [],
            }),
          );
        }
        hydrated = true;
        snapshot = empty("ready");
        return snapshot;
      }),
  };
}

function sameRule(left: CreateRuleRequest, right: CreateRuleRequest): boolean {
  return (
    left.ruleId === right.ruleId &&
    left.scope === right.scope &&
    left.network === right.network &&
    left.marketId === right.marketId &&
    left.eventType === right.eventType &&
    left.threshold === right.threshold &&
    left.accountLinkId === right.accountLinkId
  );
}
