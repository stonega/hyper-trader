import { describe, expect, test } from "bun:test";

import { portfolioEvidenceAllowsReview } from "./portfolio-freshness";

describe("portfolio display freshness", () => {
  test("keeps a current snapshot reviewable during background refresh", () => {
    expect(portfolioEvidenceAllowsReview("fresh")).toBe(true);
    expect(portfolioEvidenceAllowsReview("refreshing")).toBe(true);
  });

  test("keeps stale and offline snapshots browse-only", () => {
    expect(portfolioEvidenceAllowsReview("stale")).toBe(false);
    expect(portfolioEvidenceAllowsReview("offline")).toBe(false);
  });
});
