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
const REFRESHED_REVIEW = { refreshed: true } as unknown as ActionReviewSnapshot;
let runtime!: ActionRuntimeValue;

function RuntimeProbe(): JSX.Element {
  runtime = useActionRuntime();
  return (
    <Text>{runtime.review === null ? "Sheet hidden" : "Sheet ready"}</Text>
  );
}

test("reveals an inline-started order only after authentication", async () => {
  let state = INITIAL_ACTION_FLOW;
  let onAuthenticated: ((review: ActionReviewSnapshot) => void) | undefined;
  const result = deferred<ActionFlowState>();
  const orchestrator = {
    read: () => state,
    subscribe: () => () => undefined,
    reset: () => {
      state = INITIAL_ACTION_FLOW;
    },
    confirm: async (
      _review: ActionReviewSnapshot,
      lifecycle?: {
        readonly onAuthenticated?: (review: ActionReviewSnapshot) => void;
      },
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

  act(() => onAuthenticated?.(REFRESHED_REVIEW));
  expect(screen.getByText("Sheet ready")).toBeTruthy();
  expect(runtime.review).toBe(REFRESHED_REVIEW);

  const accepted: ActionFlowState = {
    phase: "accepted",
    generation: 1,
    journalId: "journal-1",
    message: null,
  };
  result.resolve(accepted);
  await expect(submission).resolves.toEqual(accepted);
});

test("starts a fresh order after an authoritative rejection", async () => {
  let state: ActionFlowState = {
    phase: "rejected",
    generation: 1,
    journalId: "journal-1",
    message: "Order must have minimum value of $10.",
  };
  let resets = 0;
  let confirmations = 0;
  const orchestrator = {
    read: () => state,
    subscribe: () => () => undefined,
    reset: () => {
      resets += 1;
      state = { ...INITIAL_ACTION_FLOW, generation: state.generation + 1 };
    },
    confirm: async () => {
      confirmations += 1;
      state = {
        phase: "accepted",
        generation: state.generation + 1,
        journalId: "journal-2",
        message: null,
      };
      return state;
    },
  };
  render(
    <ActionRuntimeProvider orchestrator={orchestrator}>
      <RuntimeProbe />
    </ActionRuntimeProvider>,
  );

  let result!: ActionFlowState;
  await act(async () => {
    result = await runtime.reviewAndSubmit(REVIEW);
  });

  expect(result.phase).toBe("accepted");
  expect(resets).toBe(1);
  expect(confirmations).toBe(1);
});
