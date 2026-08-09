export type SetupVisiblePhase =
  | "connect"
  | "target"
  | "slot"
  | "review"
  | "handoff"
  | "verifying"
  | "activating"
  | "failure"
  | "ready";

export type SetupReadiness = "idle" | "working" | "ready" | "failed";

export interface SetupFlowState {
  readonly phase: SetupVisiblePhase;
  readonly readiness: SetupReadiness;
  readonly generation: number;
  readonly returnPhase: Exclude<SetupVisiblePhase, "failure" | "ready">;
  readonly failureReason: string | null;
}

export type SetupFlowAction =
  | { readonly type: "NEXT" }
  | { readonly type: "BACK" }
  | { readonly type: "START_HANDOFF" }
  | { readonly type: "START_VERIFY" }
  | { readonly type: "START_ACTIVATE" }
  | { readonly type: "RUNTIME_UNAVAILABLE"; readonly reason: string }
  | { readonly type: "COMPLETE"; readonly generation: number }
  | {
      readonly type: "FAIL";
      readonly generation: number;
      readonly reason: string;
    }
  | { readonly type: "RETRY" }
  | { readonly type: "INTERRUPT" };

export const INITIAL_SETUP_FLOW: SetupFlowState = {
  phase: "connect",
  readiness: "idle",
  generation: 0,
  returnPhase: "connect",
  failureReason: null,
};

const PREVIOUS: Partial<
  Record<SetupVisiblePhase, SetupFlowState["returnPhase"]>
> = {
  target: "connect",
  slot: "target",
  review: "slot",
};

const NEXT_PHASE: Partial<
  Record<SetupVisiblePhase, SetupFlowState["returnPhase"]>
> = {
  connect: "target",
  target: "slot",
  slot: "review",
};

export function setupConsumesBack(phase: SetupVisiblePhase): boolean {
  return phase === "handoff" || phase === "verifying" || phase === "activating";
}

export function reduceSetupFlow(
  state: SetupFlowState,
  action: SetupFlowAction,
): SetupFlowState {
  switch (action.type) {
    case "NEXT": {
      const next = NEXT_PHASE[state.phase];
      if (!next) return state;
      return {
        ...state,
        phase: next,
        returnPhase: next,
      };
    }
    case "BACK": {
      if (setupConsumesBack(state.phase)) return state;
      const previous = PREVIOUS[state.phase];
      return previous
        ? {
            ...state,
            phase: previous,
            returnPhase: previous,
            readiness: "idle",
            failureReason: null,
          }
        : state;
    }
    case "START_HANDOFF":
      if (state.phase === "handoff") return state;
      return {
        ...state,
        phase: "handoff",
        returnPhase: "review",
        readiness: "working",
        generation: state.generation + 1,
        failureReason: null,
      };
    case "START_VERIFY":
      if (state.phase === "verifying") return state;
      return {
        ...state,
        phase: "verifying",
        readiness: "working",
      };
    case "START_ACTIVATE":
      if (state.phase === "activating") return state;
      return {
        ...state,
        phase: "activating",
        readiness: "working",
      };
    case "RUNTIME_UNAVAILABLE":
      return {
        ...state,
        phase: "failure",
        returnPhase: "review",
        readiness: "failed",
        generation: state.generation + 1,
        failureReason: action.reason,
      };
    case "COMPLETE":
      return action.generation === state.generation
        ? { ...state, phase: "ready", readiness: "ready" }
        : state;
    case "FAIL":
      return action.generation === state.generation
        ? {
            ...state,
            phase: "failure",
            readiness: "failed",
            failureReason: action.reason,
          }
        : state;
    case "RETRY":
      if (state.phase !== "failure") return state;
      return {
        ...state,
        phase: state.returnPhase,
        readiness: "idle",
        failureReason: null,
      };
    case "INTERRUPT":
      return {
        ...INITIAL_SETUP_FLOW,
        generation: state.generation + 1,
      };
  }
}
