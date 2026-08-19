import { expect, jest, test } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";

import { ActionFlowScreen } from "../features/actions/action-flow-screen";

const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockClear = jest.fn();
const mockRuntime = {
  available: false,
  review: {
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
  },
  flow: {
    phase: "review" as const,
    generation: 0,
    journalId: null,
    message: null,
  },
  readFlow: () => mockRuntime.flow,
  openReview: jest.fn(),
  confirm: jest.fn(),
  clear: mockClear,
  reset: jest.fn(),
};

jest.mock("expo-router", () => ({
  useRouter: () => ({ back: mockBack, replace: mockReplace }),
}));

jest.mock("../components/use-reduced-motion", () => ({
  useReducedMotion: () => true,
}));

jest.mock("../features/actions/runtime-provider", () => ({
  useActionRuntime: () => mockRuntime,
}));

test("keeps immutable review available when submission is not enabled", () => {
  render(<ActionFlowScreen mode="review" />);

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
