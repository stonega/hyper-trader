import { createPublicHyperliquidClient } from "@hyper-trader/hyperliquid/public";
import type { MobileAlertResponse } from "@hyper-trader/notifications/mobile";

interface NotificationRefreshClient {
  getMarketCatalog(options?: { readonly signal?: AbortSignal }): Promise<{
    readonly markets: readonly {
      readonly canonicalId: string;
      readonly lifecycle: "active" | "delisted";
    }[];
  }>;
  getNotificationAccountGlobalSnapshot(
    input: { readonly user: string },
    options?: { readonly signal?: AbortSignal },
  ): Promise<unknown>;
}

export async function refreshAuthoritativeNotificationTarget(
  alert: MobileAlertResponse,
  options: {
    readonly client?: NotificationRefreshClient;
    readonly now?: () => number;
    readonly signal?: AbortSignal;
  } = {},
): Promise<{ readonly observedAtMs: number }> {
  if (alert.state !== "active" || alert.rule === null) {
    throw new Error("The notification target is unavailable.");
  }
  const client =
    options.client ?? createPublicHyperliquidClient({ network: alert.network });
  const catalog = await client.getMarketCatalog({ signal: options.signal });
  const market = catalog.markets.find(
    (candidate) => candidate.canonicalId === alert.rule?.marketId,
  );
  if (market?.lifecycle !== "active") {
    throw new Error("The notification market is unavailable.");
  }
  if (alert.rule.scope === "account") {
    if (alert.account === null) {
      throw new Error("The notification account target is unavailable.");
    }
    await client.getNotificationAccountGlobalSnapshot(
      { user: alert.account.targetAccount },
      { signal: options.signal },
    );
  }
  return { observedAtMs: (options.now ?? Date.now)() };
}
