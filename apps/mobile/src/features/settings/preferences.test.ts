import { describe, expect, test } from "bun:test";

import {
  DEFAULT_SCOPED_TRADING_PREFERENCES,
  preferenceStorageKey,
  resetScopedTradingPreferences,
  updateScopedTradingPreferences,
} from "./preferences";

const SCOPE = {
  network: "testnet" as const,
  masterAccount: "0x1111111111111111111111111111111111111111",
  target: {
    kind: "vault" as const,
    address: "0x2222222222222222222222222222222222222222",
    masterAddress: "0x1111111111111111111111111111111111111111",
  },
};

describe("scoped trading preferences", () => {
  test("includes network, master, target kind, and target address in storage keys", () => {
    const base = preferenceStorageKey(SCOPE);
    expect(base).not.toBe(
      preferenceStorageKey({ ...SCOPE, network: "mainnet" }),
    );
    expect(base).not.toBe(
      preferenceStorageKey({
        ...SCOPE,
        target: { kind: "master", address: SCOPE.masterAccount },
      }),
    );
  });

  test("validates safe defaults and never stores a review or validation bypass", () => {
    const updated = updateScopedTradingPreferences(
      DEFAULT_SCOPED_TRADING_PREFERENCES,
      {
        defaultOrderType: "limit",
        defaultSlippageBps: 25,
        defaultChartRange: "7d",
      },
    );
    expect(updated).toEqual({
      version: 1,
      defaultOrderType: "limit",
      defaultSlippageBps: 25,
      defaultChartRange: "7d",
    });
    expect(JSON.stringify(updated)).not.toMatch(/skip|review|validation/i);
    expect(() =>
      updateScopedTradingPreferences(updated, { defaultSlippageBps: 501 }),
    ).toThrow("slippage");
  });

  test("reset returns a fresh exact default record", () => {
    const reset = resetScopedTradingPreferences();
    expect(reset).toEqual(DEFAULT_SCOPED_TRADING_PREFERENCES);
    expect(reset).not.toBe(DEFAULT_SCOPED_TRADING_PREFERENCES);
  });

  test("corrupt and unknown-version storage fails closed to safe defaults", async () => {
    const { parseScopedTradingPreferences } = await import("./preferences");
    expect(parseScopedTradingPreferences("not-json")).toEqual(
      DEFAULT_SCOPED_TRADING_PREFERENCES,
    );
    expect(
      parseScopedTradingPreferences(
        JSON.stringify({
          version: 2,
          defaultOrderType: "limit",
          defaultSlippageBps: 0,
          defaultChartRange: "all",
          skipReview: true,
        }),
      ),
    ).toEqual(DEFAULT_SCOPED_TRADING_PREFERENCES);
  });
});
