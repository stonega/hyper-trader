export type ActionFlowPhase =
  | "review"
  | "unlocking"
  | "refreshing"
  | "reserving"
  | "signing"
  | "submission_start"
  | "submitting"
  | "reconciling"
  | "accepted"
  | "rejected"
  | "expired"
  | "ambiguous"
  | "failed_before_submission";

export interface ActionFlowState {
  readonly phase: ActionFlowPhase;
  readonly generation: number;
  readonly journalId: string | null;
  readonly message: string | null;
}

export const INITIAL_ACTION_FLOW: ActionFlowState = {
  phase: "review",
  generation: 0,
  journalId: null,
  message: null,
};

export type ActionFlowAction =
  | { readonly type: "CONFIRM" }
  | {
      readonly type: "ADVANCE";
      readonly generation: number;
      readonly phase: Extract<
        ActionFlowPhase,
        | "unlocking"
        | "refreshing"
        | "reserving"
        | "signing"
        | "submission_start"
        | "submitting"
      >;
      readonly journalId?: string;
    }
  | {
      readonly type: "UNRESOLVED";
      readonly generation: number;
      readonly journalId: string;
    }
  | {
      readonly type: "TERMINAL";
      readonly generation: number;
      readonly journalId: string;
      readonly phase: "accepted" | "rejected" | "expired" | "ambiguous";
      readonly message?: string;
    }
  | {
      readonly type: "FAIL_BEFORE_SUBMISSION";
      readonly generation: number;
      readonly journalId?: string;
      readonly message: string;
    }
  | { readonly type: "RESET" };

const CRITICAL_PHASES: ReadonlySet<ActionFlowPhase> = new Set([
  "unlocking",
  "refreshing",
  "reserving",
  "signing",
  "submission_start",
  "submitting",
]);

const NEXT_PHASE: Readonly<Partial<Record<ActionFlowPhase, ActionFlowPhase>>> =
  {
    refreshing: "unlocking",
    unlocking: "reserving",
    reserving: "signing",
    signing: "submission_start",
    submission_start: "submitting",
  };

export function actionFlowConsumesBack(phase: ActionFlowPhase): boolean {
  return CRITICAL_PHASES.has(phase);
}

function isCurrent(state: ActionFlowState, generation: number): boolean {
  return state.generation === generation;
}

export function reduceActionFlow(
  state: ActionFlowState,
  action: ActionFlowAction,
): ActionFlowState {
  switch (action.type) {
    case "CONFIRM":
      if (
        state.phase !== "review" &&
        state.phase !== "failed_before_submission"
      ) {
        return state;
      }
      return {
        phase: "refreshing",
        generation: state.generation + 1,
        journalId: null,
        message: null,
      };
    case "ADVANCE":
      if (!isCurrent(state, action.generation)) return state;
      if (NEXT_PHASE[state.phase] !== action.phase) return state;
      return {
        ...state,
        phase: action.phase,
        journalId: action.journalId ?? state.journalId,
        message: null,
      };
    case "UNRESOLVED":
      if (
        !isCurrent(state, action.generation) ||
        state.phase !== "submitting"
      ) {
        return state;
      }
      return {
        ...state,
        phase: "reconciling",
        journalId: action.journalId,
        message: "Hyperliquid has not confirmed the result yet.",
      };
    case "TERMINAL":
      if (
        !isCurrent(state, action.generation) ||
        (state.phase !== "submitting" && state.phase !== "reconciling")
      ) {
        return state;
      }
      return {
        ...state,
        phase: action.phase,
        journalId: action.journalId,
        message: action.message ?? null,
      };
    case "FAIL_BEFORE_SUBMISSION":
      if (
        !isCurrent(state, action.generation) ||
        (state.phase !== "unlocking" &&
          state.phase !== "refreshing" &&
          state.phase !== "reserving" &&
          state.phase !== "signing" &&
          state.phase !== "submission_start")
      ) {
        return state;
      }
      return {
        ...state,
        phase: "failed_before_submission",
        journalId: action.journalId ?? state.journalId,
        message: action.message,
      };
    case "RESET":
      return {
        ...INITIAL_ACTION_FLOW,
        generation: state.generation + 1,
      };
  }
}
