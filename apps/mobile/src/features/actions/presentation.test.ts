import { describe, expect, test } from "bun:test";

import { confirmationFailurePresentation } from "./presentation";

describe("action confirmation failure presentation", () => {
  test("never claims no submission when a durable action identity exists", () => {
    const result = confirmationFailurePresentation({
      phase: "submitting",
      generation: 1,
      journalId: "jrn_00000000000000000000000000000001",
      message: null,
    });
    expect(result.showResult).toBe(true);
    expect(result.message).toContain("Do not submit again");
    expect(result.message).not.toContain("No action was sent");
  });

  test("uses bounded pre-journal recovery copy", () => {
    expect(
      confirmationFailurePresentation({
        phase: "refreshing",
        generation: 1,
        journalId: null,
        message: null,
      }),
    ).toEqual({
      message:
        "Confirmation stopped before a durable action identity was available. Refresh and review again.",
      showResult: false,
    });
  });
});
