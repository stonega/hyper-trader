import { describe, expect, test } from "bun:test";

import {
  accountEventStreamKey,
  activeAssetDataStreamKey,
  createAccountEventWire,
  createActiveAssetDataWire,
  createSpotStateWire,
  spotStateStreamKey,
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

  test("invalidates the exact perp account and coin from active asset data", () => {
    const key = activeAssetDataStreamKey("testnet", USER, "BTC");
    const wire = createActiveAssetDataWire(key, USER, "BTC");

    expect(wire.subscription).toEqual({
      type: "activeAssetData",
      user: USER,
      coin: "BTC",
    });
    expect(
      wire.decode({
        channel: "activeAssetData",
        data: { user: USER, coin: "BTC", leverage: { value: 5 } },
      }),
    ).toEqual([
      expect.objectContaining({ key, data: null, isSnapshot: false }),
    ]);
    expect(
      wire.decode({
        channel: "activeAssetData",
        data: { user: USER, coin: "ETH" },
      }),
    ).toEqual([]);
  });

  test("invalidates spot balances from the exact account state", () => {
    const key = spotStateStreamKey("testnet", USER, false);
    const wire = createSpotStateWire(key, USER, false);

    expect(wire.subscription).toEqual({
      type: "spotState",
      user: USER,
      isPortfolioMargin: false,
    });
    expect(
      wire.decode({
        channel: "spotState",
        data: { user: USER, balances: [] },
      }),
    ).toEqual([
      expect.objectContaining({ key, data: null, isSnapshot: false }),
    ]);
    expect(
      wire.decode({
        channel: "spotState",
        data: { user: `0x${"2".repeat(40)}`, balances: [] },
      }),
    ).toEqual([]);
  });
});
