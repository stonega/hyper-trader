import type { JSX, PropsWithChildren } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { ActionOrchestrator, ActionReviewSnapshot } from "./orchestrator";
import { type ActionFlowState, INITIAL_ACTION_FLOW } from "./state-machine";

export interface ActionRuntimeValue {
  readonly review: ActionReviewSnapshot | null;
  readonly flow: ActionFlowState;
  readonly available: boolean;
  readFlow(): ActionFlowState;
  openReview(review: ActionReviewSnapshot): void;
  confirm(): Promise<ActionFlowState>;
  reviewAndSubmit(review: ActionReviewSnapshot): Promise<ActionFlowState>;
  clear(): void;
  reset(): void;
}

const ActionRuntimeContext = createContext<ActionRuntimeValue | null>(null);

export function ActionRuntimeProvider({
  children,
  orchestrator = null,
}: PropsWithChildren<{
  readonly orchestrator?: ActionOrchestrator | null;
}>): JSX.Element {
  const [review, setReview] = useState<ActionReviewSnapshot | null>(null);
  const [flow, setFlow] = useState<ActionFlowState>(
    () => orchestrator?.read() ?? INITIAL_ACTION_FLOW,
  );
  const reviewedSubmissionPending = useRef(false);
  const flowRef = useRef(flow);
  const updateFlow = useCallback((next: ActionFlowState) => {
    if (Object.is(flowRef.current, next)) return;
    flowRef.current = next;
    setFlow(next);
  }, []);

  useEffect(() => {
    if (orchestrator === null) return;
    updateFlow(orchestrator.read());
    return orchestrator.subscribe(updateFlow);
  }, [orchestrator, updateFlow]);

  const openReview = useCallback(
    (next: ActionReviewSnapshot) => {
      if (reviewedSubmissionPending.current) {
        throw new Error("An order review is already in progress.");
      }
      orchestrator?.reset();
      setReview(next);
      if (orchestrator === null) updateFlow(INITIAL_ACTION_FLOW);
    },
    [orchestrator, updateFlow],
  );
  const clear = useCallback(() => {
    orchestrator?.reset();
    setReview(null);
    if (orchestrator === null) updateFlow(INITIAL_ACTION_FLOW);
  }, [orchestrator, updateFlow]);
  const reset = useCallback(() => {
    orchestrator?.reset();
    if (orchestrator === null) updateFlow(INITIAL_ACTION_FLOW);
  }, [orchestrator, updateFlow]);
  const confirm = useCallback(async () => {
    if (orchestrator === null || review === null) {
      throw new Error(
        "Reviewed action submission is unavailable in this build.",
      );
    }
    return orchestrator.confirm(review);
  }, [orchestrator, review]);
  const reviewAndSubmit = useCallback(
    async (next: ActionReviewSnapshot) => {
      if (orchestrator === null) {
        throw new Error(
          "Reviewed action submission is unavailable in this build.",
        );
      }
      if (reviewedSubmissionPending.current) {
        throw new Error("An order review is already in progress.");
      }
      const current = orchestrator.read();
      if (
        current.phase !== "review" &&
        current.phase !== "failed_before_submission" &&
        current.phase !== "rejected"
      ) {
        throw new Error("Another action is already in progress.");
      }
      reviewedSubmissionPending.current = true;
      try {
        orchestrator.reset();
        setReview(null);
        let authenticated = false;
        const result = await orchestrator.confirm(next, {
          onAuthenticated(refreshedReview) {
            authenticated = true;
            setReview(refreshedReview);
          },
        });
        if (!authenticated) setReview(null);
        return result;
      } finally {
        reviewedSubmissionPending.current = false;
      }
    },
    [orchestrator],
  );
  const value = useMemo<ActionRuntimeValue>(
    () => ({
      review,
      flow,
      available: orchestrator !== null,
      readFlow: () => orchestrator?.read() ?? flowRef.current,
      openReview,
      confirm,
      reviewAndSubmit,
      clear,
      reset,
    }),
    [
      clear,
      confirm,
      flow,
      openReview,
      orchestrator,
      reset,
      review,
      reviewAndSubmit,
    ],
  );
  return (
    <ActionRuntimeContext.Provider value={value}>
      {children}
    </ActionRuntimeContext.Provider>
  );
}

export function useActionRuntime(): ActionRuntimeValue {
  const value = useContext(ActionRuntimeContext);
  if (value === null) {
    throw new Error(
      "useActionRuntime must be used inside ActionRuntimeProvider.",
    );
  }
  return value;
}
