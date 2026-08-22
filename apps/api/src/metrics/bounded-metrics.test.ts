import { describe, expect, test } from "bun:test";

import { BoundedNotificationMetrics } from "./bounded-metrics";

describe("bounded notification metrics", () => {
  test("accepts only fixed metric names and redacted finite dimensions", () => {
    const metrics = new BoundedNotificationMetrics();
    metrics.increment("delivery_attempts", { network: "testnet" });
    metrics.set("upstream_utilization_percent", 69, {
      network: "mainnet",
    });
    expect(metrics.snapshot()).toEqual([
      {
        name: "delivery_attempts",
        value: 1,
        labels: { network: "testnet" },
      },
      {
        name: "upstream_utilization_percent",
        value: 69,
        labels: { network: "mainnet" },
      },
    ]);
    expect(() =>
      metrics.increment("delivery_attempts", {
        account: `0x${"11".repeat(20)}`,
      } as never),
    ).toThrow("label");
    expect(() => metrics.set("raw_payload" as never, 1)).toThrow("metric");
  });
});
