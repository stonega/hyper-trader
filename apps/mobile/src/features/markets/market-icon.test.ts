import { describe, expect, test } from "bun:test";

import { NATIVE_DUPLICATE, OUTCOME_MARKET } from "./fixture";
import { marketIconUri } from "./market-icon-model";

describe("market icon source", () => {
  test("uses one fixed host for safe token symbols", () => {
    expect(marketIconUri(NATIVE_DUPLICATE)).toBe(
      "https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/128/color/dup.png",
    );
  });

  test("does not turn outcomes or unsafe symbols into remote paths", () => {
    expect(marketIconUri(OUTCOME_MARKET)).toBeNull();
    expect(
      marketIconUri({ ...NATIVE_DUPLICATE, displaySymbol: "../BTC" }),
    ).toBeNull();
  });
});
