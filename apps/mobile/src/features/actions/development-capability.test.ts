import { describe, expect, test } from "bun:test";

import { developmentTestnetSubmissionEnabled } from "./development-capability";

describe("development testnet submission capability", () => {
  test("is present only in source development builds", () => {
    expect(developmentTestnetSubmissionEnabled(true)).toBe(true);
    expect(developmentTestnetSubmissionEnabled(false)).toBe(false);
  });
});
