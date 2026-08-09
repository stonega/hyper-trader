import { describe, expect, test } from "bun:test";

import {
  compareExactDecimals,
  evaluateNotificationRule,
  type NotificationRuleRecord,
} from "./evaluator";

const accountRule: NotificationRuleRecord = {
  ruleId: "11".repeat(16),
  identityDigest: "12".repeat(32),
  installationId: "13".repeat(16),
  accountLinkId: "14".repeat(16),
  scope: "account",
  network: "testnet",
  marketId: "perp:0:4",
  eventType: "margin_risk",
  threshold: "0.1250000000000000001",
};

describe("notification rule evaluation", () => {
  test("compares arbitrary-size decimals without binary floating point", () => {
    expect(
      compareExactDecimals(
        "900719925474099312345678.0000000000000000002",
        "900719925474099312345678.0000000000000000001",
      ),
    ).toBe(1);
    expect(compareExactDecimals("-0.000", "0")).toBe(0);
    expect(() => compareExactDecimals("1e-8", "0")).toThrow("decimal");
  });

  test("evaluates every execution, risk, price, and funding family on a crossing", async () => {
    const cases = [
      {
        rule: { ...accountRule, eventType: "fill" as const, threshold: "0" },
        event: {
          kind: "execution" as const,
          eventType: "fill" as const,
          network: "testnet" as const,
          marketId: "perp:0:4",
          accountLinkId: accountRule.accountLinkId,
          sourceId: "fill:42",
        },
        category: "execution",
      },
      {
        rule: {
          ...accountRule,
          eventType: "cancellation" as const,
          threshold: "0",
        },
        event: {
          kind: "execution" as const,
          eventType: "cancellation" as const,
          network: "testnet" as const,
          marketId: "perp:0:4",
          accountLinkId: accountRule.accountLinkId,
          sourceId: "order:42:canceled",
        },
        category: "execution",
      },
      {
        rule: {
          ...accountRule,
          eventType: "rejection" as const,
          threshold: "0",
        },
        event: {
          kind: "execution" as const,
          eventType: "rejection" as const,
          network: "testnet" as const,
          marketId: "perp:0:4",
          accountLinkId: accountRule.accountLinkId,
          sourceId: "order:43:rejected",
        },
        category: "execution",
      },
      {
        rule: accountRule,
        event: {
          kind: "metric" as const,
          metric: "margin_risk" as const,
          network: "testnet" as const,
          marketId: "perp:0:4",
          accountLinkId: accountRule.accountLinkId,
          previous: "0.12",
          current: "0.1250000000000000001",
          sourceId: "account:100",
        },
        category: "risk",
      },
      {
        rule: {
          ...accountRule,
          eventType: "liquidation_risk" as const,
          threshold: "0.05",
        },
        event: {
          kind: "metric" as const,
          metric: "liquidation_risk" as const,
          network: "testnet" as const,
          marketId: "perp:0:4",
          accountLinkId: accountRule.accountLinkId,
          previous: "0.06",
          current: "0.05",
          sourceId: "account:101",
        },
        category: "risk",
      },
      {
        rule: {
          ...accountRule,
          scope: "price" as const,
          accountLinkId: undefined,
          eventType: "price_above" as const,
          threshold: "3000.0000000000000001",
        },
        event: {
          kind: "metric" as const,
          metric: "price" as const,
          network: "testnet" as const,
          marketId: "perp:0:4",
          previous: "3000.0000000000000000",
          current: "3000.0000000000000001",
          sourceId: "block:102",
        },
        category: "price",
      },
      {
        rule: {
          ...accountRule,
          eventType: "funding_below" as const,
          threshold: "-0.0001",
        },
        event: {
          kind: "metric" as const,
          metric: "funding" as const,
          network: "testnet" as const,
          marketId: "perp:0:4",
          accountLinkId: accountRule.accountLinkId,
          previous: "-0.00009",
          current: "-0.0001",
          sourceId: "funding:103",
        },
        category: "funding",
      },
    ];

    for (const item of cases) {
      const result = await evaluateNotificationRule(item.rule, item.event);
      expect(result?.category).toBe(item.category);
      expect(result?.eventKey).toMatch(/^[0-9a-f]{64}$/);
      expect(result?.alertId).toBeUndefined();
    }
  });

  test("fails closed on baselines, stale scope, non-crossings, and malformed values", async () => {
    expect(
      await evaluateNotificationRule(accountRule, {
        kind: "metric",
        metric: "margin_risk",
        network: "testnet",
        marketId: "perp:0:4",
        accountLinkId: accountRule.accountLinkId,
        previous: null,
        current: "0.2",
        sourceId: "baseline:1",
      }),
    ).toBeNull();
    expect(
      await evaluateNotificationRule(accountRule, {
        kind: "metric",
        metric: "margin_risk",
        network: "mainnet",
        marketId: "perp:0:4",
        accountLinkId: accountRule.accountLinkId,
        previous: "0.1",
        current: "0.2",
        sourceId: "wrong-network",
      }),
    ).toBeNull();
    expect(
      await evaluateNotificationRule(accountRule, {
        kind: "metric",
        metric: "margin_risk",
        network: "testnet",
        marketId: "perp:0:4",
        accountLinkId: accountRule.accountLinkId,
        previous: "0.13",
        current: "0.14",
        sourceId: "already-above",
      }),
    ).toBeNull();
    await expect(
      evaluateNotificationRule(accountRule, {
        kind: "metric",
        metric: "margin_risk",
        network: "testnet",
        marketId: "perp:0:4",
        accountLinkId: accountRule.accountLinkId,
        previous: "0.1",
        current: "NaN",
        sourceId: "invalid",
      }),
    ).rejects.toThrow("decimal");
  });

  test("derives a stable secret-free dedupe key", async () => {
    const event = {
      kind: "execution" as const,
      eventType: "fill" as const,
      network: "testnet" as const,
      marketId: "perp:0:4",
      accountLinkId: accountRule.accountLinkId,
      sourceId: "fill:42",
    };
    const first = await evaluateNotificationRule(
      { ...accountRule, eventType: "fill", threshold: "0" },
      event,
    );
    const second = await evaluateNotificationRule(
      { ...accountRule, eventType: "fill", threshold: "0" },
      event,
    );
    expect(first?.eventKey).toBe(second?.eventKey);
    expect(JSON.stringify(first)).not.toContain("0x");
  });
});
