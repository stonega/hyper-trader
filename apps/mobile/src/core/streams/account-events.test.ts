import { describe, expect, test } from "bun:test";

import {
  accountEventStreamKey,
  createAccountEventWire,
} from "./account-events";

const USER = `0x${"1".repeat(40)}`;

describe("account event stream wires", () => {
  test("uses account-scoped subscriptions and emits invalidation-only deltas", () => {
    const key = accountEventStreamKey(
      "testnet",
      USER,
      "allDexsClearinghouseState",
    );
    const wire = createAccountEventWire(key, USER, "allDexsClearinghouseState");

    expect(wire.subscription).toEqual({
      type: "allDexsClearinghouseState",
      user: USER,
    });
    expect(
      wire.decode({
        channel: "allDexsClearinghouseState",
        data: { user: USER, clearinghouseStates: {} },
      }),
    ).toEqual([
      expect.objectContaining({ key, data: null, isSnapshot: false }),
    ]);
  });

  test("ignores another account and rejects malformed exclusive updates", () => {
    const wire = createAccountEventWire("fills", USER, "userFills");
    expect(
      wire.decode({
        channel: "userFills",
        data: { user: `0x${"2".repeat(40)}`, fills: [] },
      }),
    ).toEqual([]);

    const orders = createAccountEventWire("orders", USER, "orderUpdates");
    expect(() => orders.decode({ channel: "orderUpdates", data: {} })).toThrow(
      "must be an array",
    );
  });

  test("marks server snapshots so the manager can discard them after REST baseline", () => {
    const wire = createAccountEventWire("fills", USER, "userFills");
    expect(
      wire.decode({
        channel: "userFills",
        data: { user: USER, isSnapshot: true, fills: [] },
      })[0]?.isSnapshot,
    ).toBe(true);
  });
});
