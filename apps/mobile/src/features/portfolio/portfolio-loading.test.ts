import { describe, expect, test } from "bun:test";

import { portfolioLoadingSections } from "./portfolio-loading";

describe("Portfolio loading sections", () => {
  test("loads each section independently before live account data arrives", () => {
    expect(
      portfolioLoadingSections({
        filter: "positions",
        hasPortfolio: false,
        hasSelectedRange: false,
        historyPending: false,
      }),
    ).toEqual({ performance: true, rows: true, summary: true });
  });

  test("shows live rows while only performance history is pending", () => {
    expect(
      portfolioLoadingSections({
        filter: "positions",
        hasPortfolio: true,
        hasSelectedRange: false,
        historyPending: true,
      }),
    ).toEqual({ performance: true, rows: false, summary: true });
  });

  test("keeps a history-dependent filter pending until its data arrives", () => {
    expect(
      portfolioLoadingSections({
        filter: "fills",
        hasPortfolio: true,
        hasSelectedRange: false,
        historyPending: true,
      }),
    ).toEqual({ performance: true, rows: true, summary: true });
  });

  test("never restores skeletons while cached section data refreshes", () => {
    expect(
      portfolioLoadingSections({
        filter: "activity",
        hasPortfolio: true,
        hasSelectedRange: true,
        historyPending: false,
      }),
    ).toEqual({ performance: false, rows: false, summary: false });
  });
});
