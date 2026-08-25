import { describe, expect, test } from "bun:test";

import { MAINNET_TRADING_RELEASE_STAGE } from "@hyper-trader/hyperliquid";

import {
  RELEASE_ACTION_RUNTIME_ENABLED,
  signingRuntimeEnabled,
  tradingRuntimeEnabled,
} from "./development-capability";

describe("compile-owned trading runtime capability", () => {
  test("derives release runtime and network capability from one source stage", () => {
    const candidate = MAINNET_TRADING_RELEASE_STAGE === "candidate";
    expect(RELEASE_ACTION_RUNTIME_ENABLED).toBe(candidate);
    expect(signingRuntimeEnabled(true)).toBe(true);
    expect(signingRuntimeEnabled(false)).toBe(candidate);
    expect(
      tradingRuntimeEnabled({
        isDevelopmentBuild: true,
        network: "testnet",
      }),
    ).toBe(true);
    expect(
      tradingRuntimeEnabled({
        isDevelopmentBuild: true,
        network: "mainnet",
      }),
    ).toBe(candidate);
    expect(
      tradingRuntimeEnabled({
        isDevelopmentBuild: false,
        network: "testnet",
      }),
    ).toBe(candidate);
  });
});
