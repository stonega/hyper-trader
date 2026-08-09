import type { ActionFlowState } from "./state-machine";

export interface ConfirmationFailurePresentation {
  readonly message: string;
  readonly showResult: boolean;
}

export function confirmationFailurePresentation(
  state: ActionFlowState,
): ConfirmationFailurePresentation {
  if (state.journalId !== null) {
    return {
      message:
        "Action status could not be confirmed here. Do not submit again; check reconciliation.",
      showResult: true,
    };
  }
  return {
    message:
      "Confirmation stopped before a durable action identity was available. Refresh and review again.",
    showResult: false,
  };
}
