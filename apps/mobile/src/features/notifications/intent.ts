import type { MobileAlertResponse } from "@hyper-trader/notifications/mobile";

export interface MinimalNotificationPayload {
  readonly alertId: string;
  readonly category: "execution" | "risk" | "price" | "funding";
  readonly network: "testnet" | "mainnet";
  readonly routeHint: "trade" | "portfolio";
}

export type NotificationEntryResult =
  | { readonly state: "duplicate" }
  | { readonly state: "target_unavailable"; readonly message: string }
  | { readonly state: "declined" }
  | { readonly state: "context_change_failed" }
  | { readonly state: "refresh_failed"; readonly message: string }
  | {
      readonly state: "ready";
      readonly destination: "trade" | "portfolio";
      readonly marketId: string;
      readonly observedAtMs: number;
      readonly alert: MobileAlertResponse;
    };

export interface NotificationEntryCoordinator {
  open(alertId: string, signal?: AbortSignal): Promise<NotificationEntryResult>;
}

const ALERT_ID = /^[0-9a-f]{32}$/;

export function parseNotificationPayload(
  value: unknown,
): MinimalNotificationPayload | null {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return null;
  }
  const input = value as Record<string, unknown>;
  const keys = Object.keys(input).sort();
  if (
    keys.length !== 4 ||
    keys[0] !== "alertId" ||
    keys[1] !== "category" ||
    keys[2] !== "network" ||
    keys[3] !== "routeHint" ||
    typeof input.alertId !== "string" ||
    !ALERT_ID.test(input.alertId) ||
    (input.category !== "execution" &&
      input.category !== "risk" &&
      input.category !== "price" &&
      input.category !== "funding") ||
    (input.network !== "testnet" && input.network !== "mainnet") ||
    (input.routeHint !== "trade" && input.routeHint !== "portfolio")
  ) {
    return null;
  }
  return {
    alertId: input.alertId,
    category: input.category,
    network: input.network,
    routeHint: input.routeHint,
  };
}

export function parseNotificationSystemPath(path: string): string | null {
  if (!path.startsWith("hypertrader://notification")) return null;
  try {
    const url = new URL(path);
    if (
      url.protocol !== "hypertrader:" ||
      url.hostname !== "notification" ||
      url.pathname !== "" ||
      url.hash !== "" ||
      [...url.searchParams.keys()].length !== 1
    ) {
      return "/notification?invalid=1";
    }
    const alertId = url.searchParams.get("alertId");
    return alertId !== null && ALERT_ID.test(alertId)
      ? `/notification?alertId=${alertId}`
      : "/notification?invalid=1";
  } catch {
    return "/notification?invalid=1";
  }
}

function sameContext(
  alert: MobileAlertResponse,
  current: {
    readonly network: "testnet" | "mainnet";
    readonly masterAccount: string | null;
    readonly targetAccount: string | null;
  },
): boolean {
  if (current.network !== alert.network) return false;
  if (alert.account === null) return true;
  return (
    current.masterAccount === alert.account.masterAccount &&
    current.targetAccount === alert.account.targetAccount
  );
}

export function createNotificationEntryCoordinator(options: {
  readonly dedupe: {
    claim(alertId: string): Promise<boolean>;
    commit(alertId: string): Promise<unknown>;
    release(alertId: string): Promise<unknown>;
  };
  readonly service: {
    fetchAlert(
      alertId: string,
      signal?: AbortSignal,
    ): Promise<MobileAlertResponse>;
  };
  readonly context: {
    current(): {
      readonly network: "testnet" | "mainnet";
      readonly masterAccount: string | null;
      readonly targetAccount: string | null;
    };
    targetExists(alert: MobileAlertResponse): boolean;
    confirmSwitch(alert: MobileAlertResponse): Promise<boolean>;
    activate(alert: MobileAlertResponse): Promise<boolean>;
  };
  readonly authoritative: {
    refresh(
      alert: MobileAlertResponse,
      signal?: AbortSignal,
    ): Promise<{ readonly observedAtMs: number }>;
  };
}): NotificationEntryCoordinator {
  let generation = 0;
  return {
    async open(alertId, signal) {
      if (!ALERT_ID.test(alertId)) {
        return {
          state: "target_unavailable",
          message: "The alert link is malformed.",
        };
      }
      try {
        if (!(await options.dedupe.claim(alertId))) {
          return { state: "duplicate" };
        }
      } catch {
        return {
          state: "target_unavailable",
          message: "Alert history is unavailable on this device.",
        };
      }
      const operation = ++generation;
      try {
        let alert: MobileAlertResponse;
        try {
          alert = await options.service.fetchAlert(alertId, signal);
        } catch {
          return {
            state: "target_unavailable",
            message: "The alert record is unavailable or no longer authorized.",
          };
        }
        if (operation !== generation || signal?.aborted) {
          return {
            state: "refresh_failed",
            message: "Alert entry was interrupted.",
          };
        }
        if (
          alert.state !== "active" ||
          alert.rule === null ||
          !options.context.targetExists(alert)
        ) {
          return {
            state: "target_unavailable",
            message:
              "The alert target was removed, revoked, or is no longer available.",
          };
        }
        if (!sameContext(alert, options.context.current())) {
          if (!(await options.context.confirmSwitch(alert))) {
            return { state: "declined" };
          }
          if (operation !== generation || signal?.aborted) {
            return {
              state: "refresh_failed",
              message: "Alert entry was interrupted.",
            };
          }
          if (!(await options.context.activate(alert))) {
            return { state: "context_change_failed" };
          }
        }
        let refreshed: { readonly observedAtMs: number };
        try {
          refreshed = await options.authoritative.refresh(alert, signal);
        } catch {
          return {
            state: "refresh_failed",
            message: "Current Hyperliquid state could not be refreshed.",
          };
        }
        if (operation !== generation || signal?.aborted) {
          return {
            state: "refresh_failed",
            message: "Alert entry was interrupted.",
          };
        }
        try {
          await options.dedupe.commit(alertId);
        } catch {
          return {
            state: "refresh_failed",
            message: "Alert history could not be saved on this device.",
          };
        }
        return {
          state: "ready",
          destination: alert.routeHint,
          marketId: alert.rule.marketId,
          observedAtMs: refreshed.observedAtMs,
          alert,
        };
      } finally {
        await options.dedupe.release(alertId).catch(() => undefined);
      }
    },
  };
}
