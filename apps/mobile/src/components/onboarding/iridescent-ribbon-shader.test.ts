import { describe, expect, test } from "bun:test";

import { ribbonMotionAt } from "./iridescent-ribbon-shader";

describe("iridescent ribbon motion", () => {
  test("advances both material flow and the visible ribbon silhouette", () => {
    const initial = ribbonMotionAt(0);
    const later = ribbonMotionAt(1);

    expect(later.flowOffset).toBeGreaterThan(initial.flowOffset);
    expect(later.swayPhase).toBeGreaterThan(initial.swayPhase);
  });

  test("clamps negative elapsed time to the initial frame", () => {
    expect(ribbonMotionAt(-1)).toEqual(ribbonMotionAt(0));
  });
});
