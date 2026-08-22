import { describe, expect, test } from "bun:test";

import { CapacityGovernor } from "./capacity";

describe("notification capacity governor", () => {
  test("reserves at least thirty percent of current documented limits", () => {
    const governor = new CapacityGovernor();
    expect(governor.limits()).toEqual({
      restWeightPerMinute: 840,
      websocketConnections: 7,
      websocketConnectionsPerMinute: 21,
      websocketSubscriptions: 700,
      uniqueUsers: 7,
      websocketMessagesPerMinute: 1400,
      websocketInflightPosts: 70,
      expoNotificationsPerSecond: 420,
      expoBatchSize: 70,
      expoConnections: 4,
    });
  });

  test("stops admission and sheds noncritical refresh before projected exhaustion", () => {
    const governor = new CapacityGovernor();
    governor.observe("restWeightPerMinute", 830);
    expect(governor.canReserve("restWeightPerMinute", 11)).toBe(false);
    expect(governor.shouldRunNoncriticalRefresh()).toBe(false);
    governor.observe("restWeightPerMinute", 300);
    expect(governor.shouldRunNoncriticalRefresh()).toBe(true);
  });

  test("bounds abusive subscription churn and recovers after release", () => {
    const governor = new CapacityGovernor();
    for (let index = 0; index < 7; index += 1) {
      expect(governor.reserveUniqueUser(`account-${index}`)).toBe(true);
    }
    expect(governor.reserveUniqueUser("account-overflow")).toBe(false);
    expect(governor.reserveUniqueUser("account-0")).toBe(true);
    governor.releaseUniqueUser("account-0");
    expect(governor.reserveUniqueUser("account-overflow")).toBe(true);
  });

  test("atomically reserves shared capacity and rolls it back exactly once", () => {
    const governor = new CapacityGovernor();
    const first = governor.tryReserve("websocketInflightPosts", 69);
    expect(first).not.toBeNull();
    expect(governor.tryReserve("websocketInflightPosts", 2)).toBeNull();
    const last = governor.tryReserve("websocketInflightPosts", 1);
    expect(last).not.toBeNull();
    expect(governor.tryReserve("websocketInflightPosts", 1)).toBeNull();
    expect(governor.maximumUtilizationPercent()).toBe(70);
    first?.();
    first?.();
    expect(governor.tryReserve("websocketInflightPosts", 69)).not.toBeNull();
    last?.();
  });
});
