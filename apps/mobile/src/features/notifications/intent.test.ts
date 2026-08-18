import { describe, expect, test } from "bun:test";
import type { MobileAlertResponse } from "@hyper-trader/notifications/mobile";

import {
  createNotificationEntryCoordinator,
  parseNotificationPayload,
  parseNotificationSystemPath,
} from "./intent";

const alertId = "11".repeat(16);
const account = {
  accountLinkId: "22".repeat(16),
  masterAccount: `0x${"33".repeat(20)}`,
  targetAccount: `0x${"44".repeat(20)}`,
} as const;
const activeAlert = {
  alertId,
  state: "active",
  category: "execution",
  network: "testnet",
  routeHint: "portfolio",
  createdAtMs: 1_800_000_000_000,
  deliveryState: "provider_accepted",
  rule: {
    ruleId: "55".repeat(16),
    scope: "account",
    marketId: "perp:BTC",
    eventType: "fill",
  },
  account,
} as const;

describe("safe notification entry", () => {
  test("accepts only the minimal provider payload and rewrites only an opaque alert path", () => {
    expect(
      parseNotificationPayload({
        alertId,
        category: "execution",
        network: "testnet",
        routeHint: "portfolio",
      }),
    ).toEqual({
      alertId,
      category: "execution",
      network: "testnet",
      routeHint: "portfolio",
    });
    expect(
      parseNotificationPayload({
        alertId,
        category: "execution",
        network: "testnet",
        routeHint: "portfolio",
        account: account.targetAccount,
      }),
    ).toBeNull();
    expect(
      parseNotificationSystemPath(
        `hypertrader://notification?alertId=${alertId}`,
      ),
    ).toBe(`/notification?alertId=${alertId}`);
    expect(
      parseNotificationSystemPath(
        `hypertrader://notification?alertId=${alertId}&network=mainnet`,
      ),
    ).toBe("/notification?invalid=1");
  });

  test("fetches the alert first, asks before context change, then performs authoritative refresh", async () => {
    const events: string[] = [];
    const coordinator = createNotificationEntryCoordinator({
      dedupe: {
        claim: async () => true,
        commit: async () => events.push("dedupe"),
        release: async () => events.push("release"),
      },
      service: {
        fetchAlert: async () => {
          events.push("alert");
          return activeAlert;
        },
      },
      context: {
        current: () => ({
          network: "mainnet",
          masterAccount: null,
          targetAccount: null,
        }),
        targetExists: () => true,
        confirmSwitch: async () => {
          events.push("confirm");
          return true;
        },
        activate: async () => {
          events.push("activate");
          return true;
        },
      },
      authoritative: {
        refresh: async () => {
          events.push("refresh");
          return { observedAtMs: 1_800_000_000_010 };
        },
      },
    });
    const result = await coordinator.open(alertId);
    expect(result).toMatchObject({ state: "ready", destination: "portfolio" });
    expect(events).toEqual([
      "alert",
      "confirm",
      "activate",
      "refresh",
      "dedupe",
      "release",
    ]);
  });

  test("decline, removed targets, delisted markets, and duplicates never mutate context or refresh", async () => {
    let activations = 0;
    let refreshes = 0;
    const make = (input: {
      readonly duplicate?: boolean;
      readonly targetExists?: boolean;
      readonly confirm?: boolean;
      readonly alert?: MobileAlertResponse;
    }) =>
      createNotificationEntryCoordinator({
        dedupe: {
          claim: async () => !(input.duplicate ?? false),
          commit: async () => undefined,
          release: async () => undefined,
        },
        service: { fetchAlert: async () => input.alert ?? activeAlert },
        context: {
          current: () => ({
            network: "mainnet",
            masterAccount: null,
            targetAccount: null,
          }),
          targetExists: () => input.targetExists ?? true,
          confirmSwitch: async () => input.confirm ?? true,
          activate: async () => {
            activations += 1;
            return true;
          },
        },
        authoritative: {
          refresh: async () => {
            refreshes += 1;
            return { observedAtMs: 1_800_000_000_010 };
          },
        },
      });

    expect((await make({ duplicate: true }).open(alertId)).state).toBe(
      "duplicate",
    );
    expect((await make({ targetExists: false }).open(alertId)).state).toBe(
      "target_unavailable",
    );
    expect((await make({ confirm: false }).open(alertId)).state).toBe(
      "declined",
    );
    expect(
      (
        await make({
          alert: {
            ...activeAlert,
            state: "target_unavailable",
            rule: null,
            account: null,
          },
        }).open(alertId)
      ).state,
    ).toBe("target_unavailable");
    expect(activations).toBe(0);
    expect(refreshes).toBe(0);
  });

  test("admits one concurrent entry per stable alert ID and releases failed work", async () => {
    const claims = new Set<string>();
    let fetches = 0;
    let releases = 0;
    const coordinator = createNotificationEntryCoordinator({
      dedupe: {
        claim: async (candidate) => {
          if (claims.has(candidate)) return false;
          claims.add(candidate);
          return true;
        },
        commit: async (candidate) => {
          claims.delete(candidate);
        },
        release: async (candidate) => {
          releases += 1;
          claims.delete(candidate);
        },
      },
      service: {
        fetchAlert: async () => {
          fetches += 1;
          return activeAlert;
        },
      },
      context: {
        current: () => ({
          network: "mainnet",
          masterAccount: null,
          targetAccount: null,
        }),
        targetExists: () => true,
        confirmSwitch: async () => false,
        activate: async () => true,
      },
      authoritative: {
        refresh: async () => ({ observedAtMs: 1_800_000_000_010 }),
      },
    });

    const outcomes = await Promise.all([
      coordinator.open(alertId),
      coordinator.open(alertId),
    ]);
    expect(outcomes.map((outcome) => outcome.state).sort()).toEqual([
      "declined",
      "duplicate",
    ]);
    expect(fetches).toBe(1);
    expect(releases).toBe(1);
    await expect(coordinator.open(alertId)).resolves.toMatchObject({
      state: "declined",
    });
  });
});
