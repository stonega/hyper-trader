import { describe, expect, test } from "bun:test";

import {
  INITIAL_TAB_ROUTE,
  ONBOARDING_ROUTE,
  SETUP_ROUTE,
  TRADE_ROUTE,
  tradeMarketRoute,
} from "./routes";

describe("application route contract", () => {
  test("makes Trade the tab-shell default", () => {
    expect(INITIAL_TAB_ROUTE).toBe("trade");
    expect(TRADE_ROUTE).toBe("/(tabs)/trade");
  });

  test("keeps contextual Setup distinct from Trade", () => {
    expect(SETUP_ROUTE).toBe("/setup");
    expect(SETUP_ROUTE).not.toBe(TRADE_ROUTE);
  });

  test("keeps first-use onboarding distinct from setup and the tab shell", () => {
    expect(ONBOARDING_ROUTE).toBe("/onboarding");
    expect(ONBOARDING_ROUTE).not.toBe(SETUP_ROUTE);
    expect(ONBOARDING_ROUTE).not.toBe(TRADE_ROUTE);
  });

  test("market navigation changes only the canonical market route parameter", () => {
    expect(tradeMarketRoute("perp:3:9")).toEqual({
      pathname: "/(tabs)/trade",
      params: { market: "perp:3:9" },
    });
  });
});
