import { expect, test } from "@jest/globals";
import { act, render, screen } from "@testing-library/react-native";
import type { JSX } from "react";
import { AppText as Text } from "../components/app-text";
import type { ActionReviewSnapshot } from "../features/actions/orchestrator";
import {
  ActionRuntimeProvider,
  type ActionRuntimeValue,
  useActionRuntime,
} from "../features/actions/runtime-provider";
import {
  type ActionFlowState,
  INITIAL_ACTION_FLOW,
} from "../features/actions/state-machine";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const REVIEW = {} as ActionReviewSnapshot;
let runtime!: ActionRuntimeValue;

function RuntimeProbe(): JSX.Element {
  runtime = useActionRuntime();
  return (
    <Text>{runtime.review === null ? "Sheet hidden" : "Sheet ready"}</Text>
  );
}

test("reveals an inline-started order only after authentication", async () => {
  let state = INITIAL_ACTION_FLOW;
  let onAuthenticated: (() => void) | undefined;
  const result = deferred<ActionFlowState>();
  const orchestrator = {
    read: () => state,
    subscribe: () => () => undefined,
    reset: () => {
      state = INITIAL_ACTION_FLOW;
    },
    confirm: async (
      _review: ActionReviewSnapshot,
      lifecycle?: { readonly onAuthenticated?: () => void },
    ) => {
      state = { ...INITIAL_ACTION_FLOW, phase: "refreshing", generation: 1 };
      onAuthenticated = lifecycle?.onAuthenticated;
      return result.promise;
    },
  };
  render(
    <ActionRuntimeProvider orchestrator={orchestrator}>
      <RuntimeProbe />
    </ActionRuntimeProvider>,
  );

  let submission!: Promise<ActionFlowState>;
  act(() => {
    submission = runtime.reviewAndSubmit(REVIEW);
  });

  expect(screen.getByText("Sheet hidden")).toBeTruthy();
  await expect(runtime.reviewAndSubmit(REVIEW)).rejects.toThrow(
    "An order review is already in progress.",
  );

  act(() => onAuthenticated?.());
  expect(screen.getByText("Sheet ready")).toBeTruthy();

  const accepted: ActionFlowState = {
    phase: "accepted",
    generation: 1,
    journalId: "journal-1",
    message: null,
  };
  result.resolve(accepted);
  await expect(submission).resolves.toEqual(accepted);
});
