import { describe, expect, test } from "bun:test";

import {
  INITIAL_SETUP_FLOW,
  reduceSetupFlow,
  setupConsumesBack,
} from "./setup-flow";

describe("setup flow phases", () => {
  test("backs through review phases while retaining one generation", () => {
    let state = INITIAL_SETUP_FLOW;
    state = reduceSetupFlow(state, { type: "NEXT" });
    state = reduceSetupFlow(state, { type: "NEXT" });
    state = reduceSetupFlow(state, { type: "NEXT" });
    expect(state.phase).toBe("review");
    state = reduceSetupFlow(state, { type: "BACK" });
    expect(state.phase).toBe("slot");
    state = reduceSetupFlow(state, { type: "BACK" });
    expect(state.phase).toBe("target");
  });

  test("consumes Back during external handoff, verification, and activation", () => {
    for (const phase of ["handoff", "verifying", "activating"] as const) {
      expect(setupConsumesBack(phase)).toBe(true);
      const state = { ...INITIAL_SETUP_FLOW, phase };
      expect(reduceSetupFlow(state, { type: "BACK" })).toBe(state);
    }
  });

  test("ignores stale asynchronous completions after interruption", () => {
    const working = reduceSetupFlow(
      { ...INITIAL_SETUP_FLOW, phase: "review", returnPhase: "review" },
      { type: "START_HANDOFF" },
    );
    const interrupted = reduceSetupFlow(working, { type: "INTERRUPT" });
    expect(
      reduceSetupFlow(interrupted, {
        type: "COMPLETE",
        generation: working.generation,
      }),
    ).toBe(interrupted);
  });

  test("reports a gated wallet runtime as one atomic failure", () => {
    const state = reduceSetupFlow(INITIAL_SETUP_FLOW, {
      type: "RUNTIME_UNAVAILABLE",
      reason: "security_review_pending",
    });

    expect(state).toEqual({
      phase: "failure",
      readiness: "failed",
      generation: 1,
      returnPhase: "review",
      failureReason: "security_review_pending",
    });
    expect(reduceSetupFlow(state, { type: "NEXT" })).toBe(state);
  });
});
