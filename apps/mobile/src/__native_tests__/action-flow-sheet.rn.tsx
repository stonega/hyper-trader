import { beforeEach, expect, jest, test } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react-native";

import { ActionFlowSheet } from "../features/actions/action-flow-sheet";
import type { ActionFlowState } from "../features/actions/state-machine";

const mockClear = jest.fn();
let mockFlow: ActionFlowState;
let mockReview: {
  readonly presentation: {
    readonly network: string;
    readonly account: string;
    readonly market: string;
    readonly action: string;
    readonly side: string;
    readonly price: string;
    readonly size: string;
    readonly leverageAndMargin: string;
    readonly reduceOnly: string;
    readonly estimatedFee: string;
    readonly slippage: string;
  };
} | null;

const mockRuntime = {
  available: false,
  get review() {
    return mockReview;
  },
  get flow() {
    return mockFlow;
  },
  readFlow: () => mockFlow,
  openReview: jest.fn(),
  confirm: jest.fn(),
  clear: mockClear,
  reset: jest.fn(),
};

beforeEach(() => {
  mockRuntime.available = false;
  mockFlow = {
    phase: "review",
    generation: 0,
    journalId: null,
    message: null,
  };
  mockReview = {
    presentation: {
      network: "Testnet",
      account: "0x1111111111111111111111111111111111111111",
      market: "BTC-USDC",
      action: "Limit order",
      side: "Buy",
      price: "100,000 USDC",
      size: "0.001 BTC",
      leverageAndMargin: "5× · Cross",
      reduceOnly: "No",
      estimatedFee: "Unavailable",
      slippage: "Not applicable",
    },
  };
  mockClear.mockClear();
});

jest.mock("../components/use-reduced-motion", () => ({
  useReducedMotion: () => true,
}));

jest.mock("../features/actions/runtime-provider", () => ({
  useActionRuntime: () => mockRuntime,
}));

test("keeps immutable review inside the sheet when submission is unavailable", () => {
  render(<ActionFlowSheet />);

  expect(screen.getByText("Review action")).toBeTruthy();
  expect(screen.getByText("BTC-USDC")).toBeTruthy();
  expect(screen.getByText("0.001 BTC")).toBeTruthy();
  expect(
    screen.getByText(
      "Order submission is currently unavailable. You can still review the order details.",
    ),
  ).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Confirm/i })).toBeNull();
  expect(
    screen.getByRole("button", { name: "Back without signing" }),
  ).toBeTruthy();
});

test("returns a failed confirmation to the order for a fresh review", () => {
  mockFlow = {
    phase: "failed_before_submission",
    generation: 1,
    journalId: null,
    message:
      "The latest market or account details could not be confirmed for this order. Return to the order, refresh, and try again.",
  };
  render(<ActionFlowSheet />);

  expect(screen.getByText("Not submitted")).toBeTruthy();
  expect(
    screen.getByText(
      "The latest market or account details could not be confirmed for this order. Return to the order, refresh, and try again.",
    ),
  ).toBeTruthy();
  fireEvent.press(screen.getByRole("button", { name: "Return to order" }));
  expect(mockClear).toHaveBeenCalledTimes(1);
  expect(
    screen.queryByRole("button", { name: "Back without signing" }),
  ).toBeNull();
});

test("does not expose a dismiss action while submission is critical", () => {
  mockRuntime.available = true;
  mockFlow = {
    phase: "submitting",
    generation: 1,
    journalId: "journal-1",
    message: null,
  };
  render(<ActionFlowSheet />);

  expect(screen.getByText("Submitting")).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
});

test("closes and clears the completed review after acceptance", () => {
  jest.useFakeTimers();
  mockFlow = {
    phase: "accepted",
    generation: 1,
    journalId: "journal-1",
    message: null,
  };
  render(<ActionFlowSheet />);

  expect(screen.getByText("Action accepted")).toBeTruthy();
  act(() => {
    jest.advanceTimersByTime(900);
  });
  expect(mockClear).toHaveBeenCalledTimes(1);
  jest.useRealTimers();
});
