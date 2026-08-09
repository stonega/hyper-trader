import { describe, expect, test } from "bun:test";

import {
  INITIAL_TAB_ROUTE,
  TRADE_ROUTE,
  tradeMarketRoute,
  WELCOME_ROUTE,
} from "./routes";

describe("onboarding route contract", () => {
  test("makes Trade the tab-shell default", () => {
    expect(INITIAL_TAB_ROUTE).toBe("trade");
    expect(TRADE_ROUTE).toBe("/(tabs)/trade");
  });

  test("keeps first-launch Welcome distinct from returning Trade", () => {
    expect(WELCOME_ROUTE).toBe("/welcome");
    expect(WELCOME_ROUTE).not.toBe(TRADE_ROUTE);
  });

  test("market navigation changes only the canonical market route parameter", () => {
    expect(tradeMarketRoute("perp:3:9")).toEqual({
      pathname: "/(tabs)/trade",
      params: { market: "perp:3:9" },
    });
  });
});
