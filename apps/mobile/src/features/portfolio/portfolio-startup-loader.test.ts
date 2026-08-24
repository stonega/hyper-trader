import { describe, expect, test } from "bun:test";

import { NATIVE_DUPLICATE } from "../markets/fixture";
import { runPortfolioStartupLoad } from "./portfolio-startup";

const catalog = {
  markets: [NATIVE_DUPLICATE],
  quarantined: [],
  sourceErrors: [],
};

describe("Portfolio startup loading", () => {
  test("loads the catalog, live account, and history before Portfolio opens", async () => {
    const calls: string[] = [];

    await runPortfolioStartupLoad({
      catalog: async () => {
        calls.push("catalog");
        return catalog;
      },
      account: async (loadedCatalog) => {
        calls.push(`account:${loadedCatalog.markets.length}`);
      },
      history: async (loadedCatalog) => {
        calls.push(`history:${loadedCatalog.markets.length}`);
      },
    });

    expect(calls).toEqual(["catalog", "account:1", "history:1"]);
  });

  test("does not start private work after the active owner changes", async () => {
    const calls: string[] = [];
    let current = true;

    await runPortfolioStartupLoad(
      {
        catalog: async () => {
          calls.push("catalog");
          current = false;
          return catalog;
        },
        account: async () => {
          calls.push("account");
        },
        history: async () => {
          calls.push("history");
        },
      },
      () => current,
    );

    expect(calls).toEqual(["catalog"]);
  });
});
