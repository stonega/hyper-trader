import { describe, expect, test } from "bun:test";

import {
  actionFlowConsumesBack,
  INITIAL_ACTION_FLOW,
  reduceActionFlow,
} from "./state-machine";

describe("shared action flow", () => {
  test("never signs on entry and locks Back only during the critical sequence", () => {
    expect(INITIAL_ACTION_FLOW.phase).toBe("review");
    expect(actionFlowConsumesBack("review")).toBe(false);
    const confirming = reduceActionFlow(INITIAL_ACTION_FLOW, {
      type: "CONFIRM",
    });
    expect(confirming.phase).toBe("refreshing");
    expect(actionFlowConsumesBack(confirming.phase)).toBe(true);
    let submitting = confirming;
    for (const phase of [
      "unlocking",
      "reserving",
      "signing",
      "submission_start",
      "submitting",
    ] as const) {
      submitting = reduceActionFlow(submitting, {
        type: "ADVANCE",
        generation: confirming.generation,
        phase,
      });
    }
    const unresolved = reduceActionFlow(submitting, {
      type: "UNRESOLVED",
      generation: confirming.generation,
      journalId: "jrn_00000000000000000000000000000000",
    });
    expect(unresolved.phase).toBe("reconciling");
    expect(actionFlowConsumesBack(unresolved.phase)).toBe(false);
  });

  test("ignores stale asynchronous completions", () => {
    const confirming = reduceActionFlow(INITIAL_ACTION_FLOW, {
      type: "CONFIRM",
    });
    expect(
      reduceActionFlow(confirming, {
        type: "ADVANCE",
        generation: confirming.generation - 1,
        phase: "unlocking",
      }),
    ).toBe(confirming);
  });

  test("preserves an allowlisted terminal rejection message", () => {
    const confirming = reduceActionFlow(INITIAL_ACTION_FLOW, {
      type: "CONFIRM",
    });
    let submitting = confirming;
    for (const phase of [
      "unlocking",
      "reserving",
      "signing",
      "submission_start",
      "submitting",
    ] as const) {
      submitting = reduceActionFlow(submitting, {
        type: "ADVANCE",
        generation: confirming.generation,
        phase,
      });
    }
    expect(
      reduceActionFlow(submitting, {
        type: "TERMINAL",
        generation: confirming.generation,
        journalId: "jrn_00000000000000000000000000000000",
        phase: "rejected",
        message: "Order must have minimum value of $10.",
      }),
    ).toMatchObject({
      phase: "rejected",
      message: "Order must have minimum value of $10.",
    });
  });

  test("rejects illegal terminal, unresolved, and failure transitions", () => {
    const confirming = reduceActionFlow(INITIAL_ACTION_FLOW, {
      type: "CONFIRM",
    });
    expect(
      reduceActionFlow(confirming, {
        type: "TERMINAL",
        generation: confirming.generation,
        journalId: "jrn_00000000000000000000000000000000",
        phase: "accepted",
      }),
    ).toBe(confirming);
    expect(
      reduceActionFlow(confirming, {
        type: "UNRESOLVED",
        generation: confirming.generation,
        journalId: "jrn_00000000000000000000000000000000",
      }),
    ).toBe(confirming);

    let submitting = confirming;
    for (const phase of [
      "unlocking",
      "reserving",
      "signing",
      "submission_start",
      "submitting",
    ] as const) {
      submitting = reduceActionFlow(submitting, {
        type: "ADVANCE",
        generation: confirming.generation,
        phase,
      });
    }
    expect(
      reduceActionFlow(submitting, {
        type: "FAIL_BEFORE_SUBMISSION",
        generation: confirming.generation,
        message: "late",
      }),
    ).toBe(submitting);
  });
});
