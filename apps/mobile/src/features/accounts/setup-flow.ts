export type SetupVisiblePhase =
  | "loading"
  | "account"
  | "protection"
  | "authorization"
  | "verifying"
  | "activating"
  | "failure"
  | "ready";

export type SetupReadiness = "idle" | "working" | "ready" | "failed";
type SetupReturnPhase = "account" | "protection" | "authorization";

export interface SetupFlowState {
  readonly phase: SetupVisiblePhase;
  readonly readiness: SetupReadiness;
  readonly generation: number;
  readonly returnPhase: SetupReturnPhase;
  readonly failureReason: string | null;
}

export type SetupFlowAction =
  | {
      readonly type: "HYDRATE";
      readonly phase: SetupReturnPhase | "activating";
    }
  | { readonly type: "MASTER_SAVED" }
  | { readonly type: "START_PREPARE"; readonly generation: number }
  | { readonly type: "PREPARED"; readonly generation: number }
  | { readonly type: "START_VERIFY"; readonly generation: number }
  | { readonly type: "VERIFY_PENDING"; readonly generation: number }
  | { readonly type: "START_ACTIVATE"; readonly generation: number }
  | { readonly type: "COMPLETE"; readonly generation: number }
  | {
      readonly type: "FAIL";
      readonly generation: number;
      readonly reason: string;
      readonly returnPhase?: SetupReturnPhase;
    }
  | { readonly type: "RETRY" }
  | { readonly type: "BACK" }
  | { readonly type: "INTERRUPT" };

export const INITIAL_SETUP_FLOW: SetupFlowState = {
  phase: "loading",
  readiness: "working",
  generation: 0,
  returnPhase: "account",
  failureReason: null,
};

export function setupConsumesBack(phase: SetupVisiblePhase): boolean {
  return phase === "loading" || phase === "verifying" || phase === "activating";
}

export function reduceSetupFlow(
  state: SetupFlowState,
  action: SetupFlowAction,
): SetupFlowState {
  switch (action.type) {
    case "HYDRATE":
      if (state.phase !== "loading") return state;
      return {
        ...state,
        phase: action.phase,
        returnPhase:
          action.phase === "activating" ? "authorization" : action.phase,
        readiness: action.phase === "activating" ? "working" : "idle",
      };
    case "MASTER_SAVED":
      return {
        ...state,
        phase: "protection",
        returnPhase: "protection",
        readiness: "idle",
        failureReason: null,
      };
    case "START_PREPARE":
      return {
        ...state,
        phase: "protection",
        returnPhase: "protection",
        readiness: "working",
        generation: action.generation,
        failureReason: null,
      };
    case "PREPARED":
      return action.generation === state.generation
        ? {
            ...state,
            phase: "authorization",
            returnPhase: "authorization",
            readiness: "idle",
          }
        : state;
    case "START_VERIFY":
      return {
        ...state,
        phase: "verifying",
        returnPhase: "authorization",
        readiness: "working",
        generation: action.generation,
        failureReason: null,
      };
    case "START_ACTIVATE":
      return {
        ...state,
        phase: "activating",
        returnPhase: "authorization",
        readiness: "working",
        generation: action.generation,
        failureReason: null,
      };
    case "VERIFY_PENDING":
      return action.generation === state.generation
        ? {
            ...state,
            phase: "authorization",
            returnPhase: "authorization",
            readiness: "idle",
          }
        : state;
    case "COMPLETE":
      return action.generation === state.generation
        ? { ...state, phase: "ready", readiness: "ready" }
        : state;
    case "FAIL":
      return action.generation === state.generation
        ? {
            ...state,
            phase: "failure",
            returnPhase: action.returnPhase ?? state.returnPhase,
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
    case "BACK":
      if (state.phase !== "protection") return state;
      return {
        ...state,
        phase: "account",
        returnPhase: "account",
        readiness: "idle",
        failureReason: null,
      };
    case "INTERRUPT":
      return {
        ...INITIAL_SETUP_FLOW,
        phase: "account",
        readiness: "idle",
        generation: state.generation + 1,
      };
  }
}
