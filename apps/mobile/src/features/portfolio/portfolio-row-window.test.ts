import { describe, expect, test } from "bun:test";

import {
  boundedPortfolioRowLimit,
  nextPortfolioRowLimit,
  PORTFOLIO_ROW_BATCH_SIZE,
} from "./portfolio-row-window";

describe("portfolio row window", () => {
  test("bounds the first render to one batch", () => {
    expect(boundedPortfolioRowLimit(0, 2_000)).toBe(PORTFOLIO_ROW_BATCH_SIZE);
    expect(boundedPortfolioRowLimit(0, 8)).toBe(8);
  });

  test("reveals one additional batch without exceeding the source", () => {
    expect(nextPortfolioRowLimit(24, 2_000)).toBe(48);
    expect(nextPortfolioRowLimit(48, 60)).toBe(60);
  });

  test("rejects unsafe window values", () => {
    expect(() => boundedPortfolioRowLimit(-1, 10)).toThrow("safe");
    expect(() => nextPortfolioRowLimit(10, 20, 0)).toThrow("safe");
  });
});
