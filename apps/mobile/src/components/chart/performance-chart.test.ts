import { describe, expect, test } from "bun:test";

import { summarizePerformanceSeries } from "../../features/portfolio/performance-model";

describe("performance chart text alternative", () => {
  test("preserves exact decimal labels and describes visible gaps", () => {
    const summary = summarizePerformanceSeries(
      [
        [100, "100.0000000000000001"],
        [200, "101.5000000000000002"],
        [400, "99.2500000000000003"],
      ],
      { label: "7 days", expectedCadenceMs: 100 },
    );

    expect(summary).toMatchObject({
      start: "100.0000000000000001",
      end: "99.2500000000000003",
      high: "101.5000000000000002",
      low: "99.2500000000000003",
      gapCount: 1,
    });
    expect(summary?.accessibilityLabel).toContain("1 source gap");
    expect(summary?.sparkline.length).toBe(3);
  });

  test("returns an honest unavailable alternative for no history", () => {
    expect(
      summarizePerformanceSeries([], {
        label: "all history",
        expectedCadenceMs: null,
      }),
    ).toBeNull();
  });

  test("rejects malformed or non-monotonic source points", () => {
    expect(() =>
      summarizePerformanceSeries(
        [
          [200, "10"],
          [100, "11"],
        ],
        { label: "24 hours", expectedCadenceMs: 100 },
      ),
    ).toThrow("strictly increasing");
    expect(() =>
      summarizePerformanceSeries([[100, "not-a-decimal"]], {
        label: "24 hours",
        expectedCadenceMs: 100,
      }),
    ).toThrow("valid decimal");
  });
});
