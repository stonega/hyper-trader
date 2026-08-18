import { describe, expect, test } from "bun:test";

import {
  INITIAL_SETUP_FLOW,
  reduceSetupFlow,
  setupConsumesBack,
} from "./setup-flow";

describe("setup flow phases", () => {
  test("hydrates saved protection and authorization phases", () => {
    expect(
      reduceSetupFlow(INITIAL_SETUP_FLOW, {
        type: "HYDRATE",
        phase: "protection",
      }),
    ).toMatchObject({ phase: "protection", readiness: "idle" });
    expect(
      reduceSetupFlow(INITIAL_SETUP_FLOW, {
        type: "HYDRATE",
        phase: "authorization",
      }),
    ).toMatchObject({ phase: "authorization", readiness: "idle" });
  });

  test("moves through protected generation without exposing an intermediate phase", () => {
    let state = reduceSetupFlow(INITIAL_SETUP_FLOW, {
      type: "HYDRATE",
      phase: "account",
    });
    state = reduceSetupFlow(state, { type: "MASTER_SAVED" });
    state = reduceSetupFlow(state, { type: "START_PREPARE", generation: 1 });
    expect(state).toMatchObject({ phase: "protection", readiness: "working" });
    state = reduceSetupFlow(state, { type: "PREPARED", generation: 1 });
    expect(state).toMatchObject({ phase: "authorization", readiness: "idle" });
    state = reduceSetupFlow(state, { type: "BACK" });
    expect(state.phase).toBe("authorization");
  });

  test("consumes Back only while loading, verifying, or activating", () => {
    for (const phase of ["loading", "verifying", "activating"] as const) {
      expect(setupConsumesBack(phase)).toBe(true);
    }
    expect(setupConsumesBack("authorization")).toBe(false);
  });

  test("ignores stale asynchronous completions after interruption", () => {
    const working = reduceSetupFlow(
      {
        ...INITIAL_SETUP_FLOW,
        phase: "authorization",
        returnPhase: "authorization",
      },
      { type: "START_VERIFY", generation: 1 },
    );
    const interrupted = reduceSetupFlow(working, { type: "INTERRUPT" });
    expect(
      reduceSetupFlow(interrupted, {
        type: "COMPLETE",
        generation: working.generation,
      }),
    ).toBe(interrupted);
  });

  test("returns recoverable verification failures to authorization", () => {
    const verifying = reduceSetupFlow(
      {
        ...INITIAL_SETUP_FLOW,
        phase: "authorization",
        returnPhase: "authorization",
      },
      { type: "START_VERIFY", generation: 2 },
    );
    const failed = reduceSetupFlow(verifying, {
      type: "FAIL",
      generation: 2,
      reason: "registration_unverified",
    });
    expect(failed).toMatchObject({
      phase: "failure",
      returnPhase: "authorization",
    });
    expect(reduceSetupFlow(failed, { type: "RETRY" }).phase).toBe(
      "authorization",
    );
  });
});
