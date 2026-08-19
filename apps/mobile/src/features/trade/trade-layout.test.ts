import { describe, expect, test } from "bun:test";

import { shouldSplitTradeWorkspace } from "./trade-layout";

describe("Trade workspace layout", () => {
  test("uses the split order and activity workspace on standard phones", () => {
    expect(shouldSplitTradeWorkspace({ width: 360, fontScale: 1 })).toBe(true);
    expect(shouldSplitTradeWorkspace({ width: 430, fontScale: 1.25 })).toBe(
      true,
    );
  });

  test("stacks for narrow screens or large accessibility text", () => {
    expect(shouldSplitTradeWorkspace({ width: 359, fontScale: 1 })).toBe(false);
    expect(shouldSplitTradeWorkspace({ width: 430, fontScale: 1.26 })).toBe(
      false,
    );
    expect(shouldSplitTradeWorkspace({ width: Number.NaN, fontScale: 1 })).toBe(
      false,
    );
  });
});
