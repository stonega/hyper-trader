import { describe, expect, test } from "bun:test";

import { ACTIVE_MARKET_CATALOG_FILTERS } from "./catalog-filter";

describe("active market catalog filters", () => {
  test("includes HIP-3 and browse-only markets without delisted records", () => {
    expect(ACTIVE_MARKET_CATALOG_FILTERS).toEqual({
      includeHip3: true,
      availability: "all",
      lifecycle: "active",
    });
  });
});
