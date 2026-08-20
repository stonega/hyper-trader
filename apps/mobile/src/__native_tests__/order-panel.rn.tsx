import type { Market } from "@hyper-trader/hyperliquid/public";
import { describe, expect, jest, test } from "@jest/globals";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react-native";

import type { NormalizedTradingContext } from "../core/context/supervisor";
import { NATIVE_DUPLICATE, SPOT_DUPLICATE } from "../features/markets/fixture";
import { OrderPanel } from "../features/trade/order-panel";
import {
  createTradeDraft,
  type TradeAccountSnapshot,
  type TradeAuthority,
  type TradeDraft,
  type TradeGate,
} from "../features/trade/trade-model";

jest.mock("../components/use-reduced-motion", () => ({
  useReducedMotion: () => false,
}));

const NOW = 1_725_000_000_000;
const context: NormalizedTradingContext = {
  network: "testnet",
  masterAccount: "0x1111111111111111111111111111111111111111",
  targetAccount: "0x2222222222222222222222222222222222222222",
  signer: {
    agentAddress: "0x3333333333333333333333333333333333333333",
    generation: 1,
  },
};
const account: TradeAccountSnapshot = {
  availableFunds: { buy: "1000", sell: "900" },
  leverage: 5,
  marginMode: "cross",
  observedAtMs: NOW,
  positionSize: "0",
  version: 1,
};
const authority: TradeAuthority = {
  account,
  actionRuntimeAvailable: true,
  connectivity: "current",
  signerState: "unlocked",
};
const gate: TradeGate = {
  code: "ready",
  enabled: true,
  reason: "Ready for review.",
};

function renderPanel(market: Market): {
  readonly onReview: jest.Mock<(draft: TradeDraft) => Promise<void>>;
} {
  const onReview = jest.fn(async (_draft: TradeDraft) => undefined);
  render(
    <OrderPanel
      authority={authority}
      draft={{
        ...createTradeDraft({ account, context, market }),
        size: "1",
      }}
      gate={gate}
      invalidationMessage={null}
      market={market}
      onDraftChange={jest.fn()}
      onReview={onReview}
    />,
  );
  return { onReview };
}

describe("order panel directional review actions", () => {
  test("shows available margin as a left-label, right-value row", () => {
    renderPanel(NATIVE_DUPLICATE);

    const availableFundsRow = screen.getByTestId("available-funds-row");

    expect(availableFundsRow.props.className).toContain("flex-row");
    expect(availableFundsRow.props.className).toContain("justify-between");
    expect(
      within(availableFundsRow).getByText("Available margin"),
    ).toBeTruthy();
    expect(within(availableFundsRow).getByText("1000")).toBeTruthy();
  });

  test("uses stacked perp actions and binds the pressed side into review", async () => {
    const { onReview } = renderPanel(NATIVE_DUPLICATE);

    expect(screen.queryByText("Order entry")).toBeNull();
    expect(screen.queryByText("Side")).toBeNull();
    expect(screen.queryByText("Order type")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Buy / Long" }).props.variant,
    ).toBe("primary");
    const sell = screen.getByRole("button", { name: "Sell / Short" });
    expect(sell.props.variant).toBe("danger");

    fireEvent.press(sell);

    await waitFor(() => expect(onReview).toHaveBeenCalledTimes(1));
    expect(onReview.mock.calls[0]?.[0]).toMatchObject({ side: "sell" });
  });

  test("uses spot terminology without implying a position", () => {
    renderPanel(SPOT_DUPLICATE);

    expect(screen.getByRole("button", { name: "Buy" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sell" })).toBeTruthy();
    expect(screen.queryByText(/Long|Short/)).toBeNull();
  });

  test("opens leverage and advanced controls in the settings dialog", () => {
    renderPanel(NATIVE_DUPLICATE);

    const controlsRow = screen.getByTestId("order-type-settings-row");
    expect(
      within(controlsRow).getByRole("tab", { name: "Market" }),
    ).toBeTruthy();
    const show = within(controlsRow).getByRole("button", {
      name: "Order settings",
    });
    expect(show.props.accessibilityState).toEqual({ expanded: false });
    expect(screen.queryByText("Leverage")).toBeNull();
    expect(screen.queryByText("Current leverage")).toBeNull();

    fireEvent.press(show);

    expect(
      screen.getByRole("button", { name: "Order settings" }).props
        .accessibilityState,
    ).toEqual({ expanded: true });
    expect(screen.getByText("Leverage")).toBeTruthy();
    expect(screen.getByText("5× current")).toBeTruthy();
    expect(
      screen.getByText("20× maximum · Changes require a separate review."),
    ).toBeTruthy();
    expect(screen.getByText("Maximum slippage · 0.5%")).toBeTruthy();

    fireEvent.press(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByText("Leverage")).toBeNull();
  });

  test("clears a stale review error after account leverage synchronizes", async () => {
    const onReview = jest.fn(async () => {
      throw new Error("Account leverage changed while preparing review.");
    });
    const initialDraft = {
      ...createTradeDraft({ account, context, market: NATIVE_DUPLICATE }),
      size: "1",
    };
    const view = render(
      <OrderPanel
        authority={authority}
        draft={initialDraft}
        gate={gate}
        invalidationMessage={null}
        market={NATIVE_DUPLICATE}
        onDraftChange={jest.fn()}
        onReview={onReview}
      />,
    );

    fireEvent.press(screen.getByRole("button", { name: "Buy / Long" }));
    await screen.findByText("Account leverage changed while preparing review.");

    const refreshedAccount = { ...account, leverage: 10, version: 2 };
    view.rerender(
      <OrderPanel
        authority={{ ...authority, account: refreshedAccount }}
        draft={{ ...initialDraft, leverage: 10 }}
        gate={gate}
        invalidationMessage={null}
        market={NATIVE_DUPLICATE}
        onDraftChange={jest.fn()}
        onReview={onReview}
      />,
    );

    await waitFor(() =>
      expect(
        screen.queryByText("Account leverage changed while preparing review."),
      ).toBeNull(),
    );
  });
});
