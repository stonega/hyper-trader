import { beforeEach, expect, jest, test } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react-native";

import { ActionFlowSheet } from "../features/actions/action-flow-sheet";
import type { ActionFlowState } from "../features/actions/state-machine";

const mockClear = jest.fn();
let mockFlow: ActionFlowState;
let mockReview: {
  readonly validated: {
    readonly intent: { readonly type: "limit_order" };
  };
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
  reviewAndSubmit: jest.fn(),
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
    validated: { intent: { type: "limit_order" } },
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

  expect(screen.getByText("Confirm order")).toBeTruthy();
  expect(screen.getByText("BTC-USDC")).toBeTruthy();
  expect(screen.getByText("0.001 BTC")).toBeTruthy();
  expect(
    screen.getByText(
      "Order submission is currently unavailable. You can still review the order details.",
    ),
  ).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Confirm/i })).toBeNull();
  expect(screen.getByRole("button", { name: "Cancel review" })).toBeTruthy();
});

test("sizes the sheet to its content and exposes one direct order action", () => {
  mockRuntime.available = true;
  render(<ActionFlowSheet />);

  const content = screen.getByLabelText("Order action review");
  expect(content.props.enableDynamicSizing).toBe(true);
  expect(content.props.snapPoints).toBeUndefined();
  expect(screen.getByRole("button", { name: "Place buy order" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Cancel review" })).toBeTruthy();
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
  mockClear.mockImplementationOnce(() => {
    mockFlow = {
      phase: "review",
      generation: 2,
      journalId: null,
      message: null,
    };
    mockReview = null;
  });
  fireEvent.press(screen.getByRole("button", { name: "Return to order" }));
  expect(mockClear).toHaveBeenCalledTimes(1);
  expect(screen.queryByLabelText("Order action review")).toBeNull();
  expect(screen.queryByRole("button", { name: "Place buy order" })).toBeNull();
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

  expect(screen.getByText("Submitting order…")).toBeTruthy();
  expect(screen.getByLabelText("Submitting order…")).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
});

test("replaces the status rail and checking copy with a compact loader", () => {
  mockRuntime.available = true;
  mockFlow = {
    phase: "reconciling",
    generation: 1,
    journalId: "journal-1",
    message: "Hyperliquid has not confirmed the result yet.",
  };
  render(<ActionFlowSheet />);

  expect(screen.getByLabelText("Checking order status")).toBeTruthy();
  expect(screen.getByText("Checking order…")).toBeTruthy();
  expect(screen.queryByText("Checking status")).toBeNull();
  expect(
    screen.queryByText("Confirming the result with Hyperliquid."),
  ).toBeNull();
  expect(
    screen.queryByText("Hyperliquid has not confirmed the result yet."),
  ).toBeNull();
  expect(screen.queryByText("Leverage / margin")).toBeNull();
  expect(screen.queryByText("Reduce only")).toBeNull();
  expect(screen.queryByText("Estimated fee")).toBeNull();
  expect(screen.queryByText("Account")).toBeNull();
});

test("stays closed during background review and opens after authentication", () => {
  mockRuntime.available = true;
  mockReview = null;
  mockFlow = {
    phase: "refreshing",
    generation: 1,
    journalId: null,
    message: null,
  };
  const view = render(<ActionFlowSheet />);

  expect(screen.queryByLabelText("Order action review")).toBeNull();

  mockReview = {
    validated: { intent: { type: "limit_order" } },
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
  mockFlow = {
    phase: "reserving",
    generation: 1,
    journalId: null,
    message: null,
  };
  view.rerender(<ActionFlowSheet />);

  expect(screen.getByLabelText("Order submission status")).toBeTruthy();
  expect(screen.getByText("Preparing order…")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Place buy order" })).toBeNull();
});

test("shows the allowlisted minimum-notional rejection", () => {
  mockFlow = {
    phase: "rejected",
    generation: 1,
    journalId: "journal-1",
    message: "Order must have minimum value of $10.",
  };
  render(<ActionFlowSheet />);

  expect(screen.getByText("Action rejected")).toBeTruthy();
  expect(
    screen.getByText("Order must have minimum value of $10."),
  ).toBeTruthy();
  fireEvent.press(screen.getByRole("button", { name: "Edit order" }));
  expect(mockClear).toHaveBeenCalledTimes(1);
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
