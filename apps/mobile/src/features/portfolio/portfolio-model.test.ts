import { describe, expect, test } from "bun:test";
import type { AccountTarget } from "@hyper-trader/hyperliquid";
import { createTradeOperationFence } from "../trade/trade-model";
import { PORTFOLIO_FIXTURE } from "./portfolio.fixture";
import {
  buildCancelIntent,
  buildCloseIntent,
  buildLeverageIntent,
  buildPositionTpslIntent,
  combineNormalizedPortfolio,
  createCloseDraft,
  createPositionTpslDraft,
  normalizePortfolioHistorySnapshot,
  normalizePortfolioLiveSnapshot,
  normalizePortfolioSnapshot,
  portfolioFundingId,
  portfolioMarketClosePrice,
  portfolioOwnerKey,
} from "./portfolio-model";
import {
  buildPortfolioCancelReview,
  buildPortfolioCloseReview,
  buildPortfolioLeverageReview,
  buildPortfolioPositionTpslReview,
  portfolioCloseScopeKey,
} from "./portfolio-review";

const REVIEW_CONTEXT = {
  network: "testnet" as const,
  masterAccount: "0x1111111111111111111111111111111111111111",
  targetAccount: "0x2222222222222222222222222222222222222222",
  signer: {
    agentAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    generation: 2,
  },
};

const REVIEW_TARGET = {
  kind: "subaccount",
  address: REVIEW_CONTEXT.targetAccount,
  masterAddress: REVIEW_CONTEXT.masterAccount,
} as const satisfies AccountTarget;

describe("portfolio normalization", () => {
  test("keeps native, HIP-3, and spot source identity in one account view", () => {
    const portfolio = normalizePortfolioSnapshot(PORTFOLIO_FIXTURE);

    expect(
      portfolio.positions.map((position) => position.canonicalMarketId),
    ).toEqual(["perp:0:4", "perp:3:9"]);
    expect(portfolio.positions.map((position) => position.venue)).toEqual([
      "Hyperliquid",
      "Omega Markets",
    ]);
    expect(
      new Set(portfolio.openOrders.map((order) => order.canonicalMarketId)),
    ).toEqual(new Set(["perp:0:4", "perp:3:9"]));
    expect(portfolio.spotBalances.map((balance) => balance.coin)).toEqual([
      "DUP",
      "USDC",
    ]);
    expect(portfolio.fills).toHaveLength(1);
    expect(portfolio.funding).toHaveLength(1);
    expect(portfolio.positions[0]).toMatchObject({
      takeProfit: { oid: 170, triggerPrice: "12" },
      stopLoss: { oid: 171, triggerPrice: "9" },
    });
    expect(portfolio.activity.map((item) => item.kind)).toEqual([
      "funding",
      "fill",
    ]);
    expect(
      portfolio.activity.find((item) => item.kind === "fill"),
    ).toMatchObject({
      side: "B",
      detail: "Size 1 · Price 10",
    });
    expect(
      portfolio.activity.find((item) => item.kind === "funding"),
    ).toMatchObject({
      side: null,
      detail: "Rate 0.0001 · Position size 2.5",
    });
    expect(portfolio.gaps).toContain("Performance range 30d was not returned.");
  });

  test("omits spot assets with a zero total balance", () => {
    const balance = PORTFOLIO_FIXTURE.spotState.balances[0];
    if (!balance) throw new Error("fixture spot balance missing");
    const portfolio = normalizePortfolioSnapshot({
      ...PORTFOLIO_FIXTURE,
      spotState: {
        balances: [
          { ...balance, coin: "ZERO", token: 1, total: "0" },
          { ...balance, coin: "PADDED_ZERO", token: 2, total: "0.000000" },
          { ...balance, coin: "NEGATIVE_ZERO", token: 3, total: "-0.0" },
          { ...balance, coin: "DUST", token: 4, total: "0.00000001" },
        ],
      },
    });

    expect(portfolio.spotBalances.map((item) => item.coin)).toEqual(["DUST"]);
  });

  test("reuses normalized history when only the live account snapshot changes", () => {
    const { fills, funding, periods, ...liveSource } = PORTFOLIO_FIXTURE;
    const history = normalizePortfolioHistorySnapshot({
      fills,
      funding,
      periods,
    });
    const first = combineNormalizedPortfolio(
      normalizePortfolioLiveSnapshot(liveSource),
      history,
    );
    const second = combineNormalizedPortfolio(
      normalizePortfolioLiveSnapshot({
        ...liveSource,
        observedAtMs: liveSource.observedAtMs + 1,
      }),
      history,
    );

    expect(second.observedAtMs).toBe(first.observedAtMs + 1);
    expect(second.ranges).toBe(first.ranges);
    expect(second.fills).toBe(first.fills);
    expect(second.funding).toBe(first.funding);
    expect(second.activity).toBe(first.activity);
  });

  test("gives recurring zero-hash funding settlements unique stable IDs", () => {
    const funding = PORTFOLIO_FIXTURE.funding[0];
    if (!funding) throw new Error("fixture funding missing");
    const zeroHash = `0x${"0".repeat(64)}`;
    const records = [
      { ...funding, hash: zeroHash, coin: "BTC", time: 1_720_000_000_000 },
      { ...funding, hash: zeroHash, coin: "BTC", time: 1_720_003_600_000 },
      { ...funding, hash: zeroHash, coin: "ETH", time: 1_720_003_600_000 },
    ];

    const history = normalizePortfolioHistorySnapshot({
      fills: [],
      funding: records,
      periods: [],
    });
    const ids = history.activity.map((activity) => activity.id);

    expect(ids).toEqual(
      [...records]
        .sort((left, right) => right.time - left.time)
        .map(portfolioFundingId),
    );
    expect(new Set(ids).size).toBe(records.length);
  });

  test("reports unknown market rows instead of guessing canonical identity", () => {
    const portfolio = normalizePortfolioSnapshot({
      ...PORTFOLIO_FIXTURE,
      perpStates: [
        {
          ...PORTFOLIO_FIXTURE.perpStates[0],
          state: {
            ...PORTFOLIO_FIXTURE.perpStates[0].state,
            positions: [
              {
                ...PORTFOLIO_FIXTURE.perpStates[0].state.positions[0],
                coin: "UNKNOWN",
              },
            ],
          },
        },
      ],
    });

    expect(portfolio.positions[0]?.canonicalMarketId).toBeNull();
    expect(portfolio.positions[0]?.actionsEnabled).toBe(false);
    expect(portfolio.gaps).toContain(
      "No validated market matched perpetual position UNKNOWN on Hyperliquid.",
    );
  });

  test("treats duplicate exact market keys as ambiguous", () => {
    const native = PORTFOLIO_FIXTURE.markets[0];
    if (!native) throw new Error("fixture market missing");
    const portfolio = normalizePortfolioSnapshot({
      ...PORTFOLIO_FIXTURE,
      markets: [
        ...PORTFOLIO_FIXTURE.markets,
        { ...native, canonicalId: "perp:0:duplicate" },
      ],
    });

    expect(portfolio.positions[0]?.market).toBeNull();
    expect(portfolio.positions[0]?.actionsEnabled).toBe(false);
  });

  test("rejects malformed financial rows at normalization", () => {
    expect(() =>
      normalizePortfolioSnapshot({
        ...PORTFOLIO_FIXTURE,
        perpStates: [
          {
            ...PORTFOLIO_FIXTURE.perpStates[0],
            state: {
              ...PORTFOLIO_FIXTURE.perpStates[0].state,
              positions: [
                {
                  ...PORTFOLIO_FIXTURE.perpStates[0].state.positions[0],
                  size: "not-a-decimal" as never,
                },
              ],
            },
          },
        ],
      }),
    ).toThrow("Position size is invalid");
  });

  test("keeps the account view usable while disclosing invalid performance order", () => {
    const portfolio = normalizePortfolioSnapshot({
      ...PORTFOLIO_FIXTURE,
      periods: [
        {
          ...PORTFOLIO_FIXTURE.periods[0],
          accountValueHistory: [
            [200, "100"],
            [100, "101"],
          ],
        },
      ],
    });

    expect(portfolio.ranges["24h"]?.accountValue).toBeNull();
    expect(portfolio.gaps).toContain(
      "Performance range 24h contains invalid or non-monotonic account-value history.",
    );
    expect(portfolio.positions).toHaveLength(2);
  });

  test("maps an exact spot open order without merging it into a perpetual", () => {
    const portfolio = normalizePortfolioSnapshot({
      ...PORTFOLIO_FIXTURE,
      perpStates: [
        {
          ...PORTFOLIO_FIXTURE.perpStates[0],
          openOrders: [
            ...PORTFOLIO_FIXTURE.perpStates[0].openOrders,
            {
              coin: "@7",
              limitPrice: "2",
              oid: 73,
              side: "A",
              size: "1",
              timestamp: 1_720_000_001_073,
              originalSize: "1",
              triggerCondition: "N/A",
              isTrigger: false,
              triggerPrice: "0",
              isPositionTpsl: false,
              reduceOnly: false,
              orderType: "Limit",
            },
          ],
        },
      ],
    });

    expect(
      portfolio.openOrders.find((order) => order.oid === 73)?.canonicalMarketId,
    ).toBe("spot:7");
  });

  test("isolates private ownership by network, master, and exact target", () => {
    expect(portfolioOwnerKey(PORTFOLIO_FIXTURE.owner)).toBe(
      '["testnet","0x1111111111111111111111111111111111111111","subaccount","0x2222222222222222222222222222222222222222","0x1111111111111111111111111111111111111111"]',
    );
    expect(
      portfolioOwnerKey({
        ...PORTFOLIO_FIXTURE.owner,
        target: {
          ...PORTFOLIO_FIXTURE.owner.target,
          address: "0x3333333333333333333333333333333333333333",
        },
      }),
    ).not.toBe(portfolioOwnerKey(PORTFOLIO_FIXTURE.owner));
  });

  test("keeps master, subaccount, and vault identity distinct at one address", () => {
    const common = {
      network: "testnet" as const,
      masterAccount: REVIEW_CONTEXT.masterAccount,
    };
    const address = REVIEW_CONTEXT.masterAccount;
    const keys = [
      portfolioOwnerKey({
        ...common,
        target: { kind: "master", address },
      }),
      portfolioOwnerKey({
        ...common,
        target: {
          kind: "subaccount",
          address,
          masterAddress: REVIEW_CONTEXT.masterAccount,
        },
      }),
      portfolioOwnerKey({
        ...common,
        target: {
          kind: "vault",
          address,
          masterAddress: REVIEW_CONTEXT.masterAccount,
        },
      }),
    ];

    expect(new Set(keys).size).toBe(3);
  });
});

describe("portfolio quick-action intents", () => {
  test("defaults Close to a full-size reduce-only market action", () => {
    const position = normalizePortfolioSnapshot(PORTFOLIO_FIXTURE).positions[0];
    if (!position) throw new Error("fixture position missing");

    const draft = createCloseDraft(position);
    const intent = buildCloseIntent(draft, position, {
      cloid: "0x11111111111111111111111111111111",
      aggressiveLimitPrice: "9.95",
    });

    expect(draft).toMatchObject({ behavior: "market", size: "2.5" });
    expect(intent).toEqual({
      type: "reduce_only_close",
      assetId: 4,
      side: "sell",
      size: "2.5",
      aggressiveLimitPrice: "9.95",
      cloid: "0x11111111111111111111111111111111",
    });
  });

  test("builds a full-position protective edit with a bounded market trigger", () => {
    const portfolio = normalizePortfolioSnapshot(PORTFOLIO_FIXTURE);
    const position = portfolio.positions.find(
      (candidate) => candidate.canonicalMarketId === "perp:0:4",
    );
    if (!position) throw new Error("fixture position missing");
    const draft = createPositionTpslDraft(position, "take_profit");

    expect(
      buildPositionTpslIntent(
        { ...draft, triggerPrice: "13" },
        position,
        "0x33333333333333333333333333333333",
      ),
    ).toEqual({
      type: "position_tpsl",
      assetId: 4,
      side: "sell",
      size: "2.5",
      triggerPrice: "13",
      aggressiveLimitPrice: "12.35",
      triggerKind: "take_profit",
      existingOid: 170,
      cloid: "0x33333333333333333333333333333333",
    });
  });

  test("rounds the default limit-close price to current market precision", () => {
    const position = normalizePortfolioSnapshot(PORTFOLIO_FIXTURE).positions[0];
    if (position?.market === null || position === undefined) {
      throw new Error("fixture position missing");
    }
    const market = {
      ...position.market,
      midPx: "79112.5" as const,
      markPx: "79112.5" as const,
    };

    expect(createCloseDraft({ ...position, market }).limitPrice).toBe("79113");
    expect(
      createCloseDraft({
        ...position,
        market,
        side: "short",
        size: "-2.5",
      }).limitPrice,
    ).toBe("79112");
  });

  test("allows an edited partial close only as a reduce-only limit action", () => {
    const position = normalizePortfolioSnapshot(PORTFOLIO_FIXTURE).positions[0];
    if (!position) throw new Error("fixture position missing");
    const draft = {
      ...createCloseDraft(position),
      behavior: "limit" as const,
      size: "1.25",
      limitPrice: "10.25",
    };

    expect(
      buildCloseIntent(draft, position, {
        cloid: "0x22222222222222222222222222222222",
        aggressiveLimitPrice: "9.95",
      }),
    ).toEqual({
      type: "limit_order",
      assetId: 4,
      side: "sell",
      size: "1.25",
      limitPrice: "10.25",
      timeInForce: "Gtc",
      reduceOnly: true,
      cloid: "0x22222222222222222222222222222222",
    });

    expect(() =>
      buildCloseIntent(
        { ...draft, behavior: "market", size: "1.25" },
        position,
        {
          cloid: "0x33333333333333333333333333333333",
          aggressiveLimitPrice: "9.95",
        },
      ),
    ).toThrow("Market close must use the full current position size");
  });

  test("rechecks close authority and market at the final intent boundary", () => {
    const portfolio = normalizePortfolioSnapshot(PORTFOLIO_FIXTURE);
    const native = portfolio.positions[0];
    const hip3 = portfolio.positions[1];
    if (!native || !hip3) throw new Error("fixture position missing");
    const prices = {
      cloid: "0x33333333333333333333333333333333" as const,
      aggressiveLimitPrice: "9.95" as const,
    };

    expect(() =>
      buildCloseIntent(createCloseDraft(native), hip3, prices),
    ).toThrow("not currently available");
    expect(() =>
      buildCloseIntent(
        createCloseDraft(native),
        { ...native, market: null },
        prices,
      ),
    ).toThrow("current validated market");
  });

  test("computes exact close slippage bounds and validates basis points", () => {
    const market = PORTFOLIO_FIXTURE.markets[0];
    if (market?.family !== "perp") throw new Error("market missing");
    expect(
      portfolioMarketClosePrice({ market, side: "sell", slippageBps: "50" }),
    ).toBe("9.95");
    expect(
      portfolioMarketClosePrice({ market, side: "buy", slippageBps: "50" }),
    ).toBe("10.05");
    expect(
      portfolioMarketClosePrice({ market, side: "sell", slippageBps: "0" }),
    ).toBe("10");
    expect(
      portfolioMarketClosePrice({ market, side: "buy", slippageBps: "500" }),
    ).toBe("10.5");
    expect(
      portfolioMarketClosePrice({ market, side: "sell", slippageBps: "500" }),
    ).toBe("9.5");
    expect(
      portfolioMarketClosePrice({
        market: { ...market, markPx: "12345.67" },
        side: "sell",
        slippageBps: "50",
      }),
    ).toBe("12284");
    expect(
      portfolioMarketClosePrice({
        market: { ...market, markPx: "12345.67" },
        side: "buy",
        slippageBps: "50",
      }),
    ).toBe("12407");
    for (const slippageBps of ["-1", "501", "1.5", ""]) {
      expect(() =>
        portfolioMarketClosePrice({ market, side: "sell", slippageBps }),
      ).toThrow("0 through 500");
    }
  });

  test("builds exact cancel and applicable leverage intents", () => {
    const portfolio = normalizePortfolioSnapshot(PORTFOLIO_FIXTURE);
    const order = portfolio.openOrders.find(
      (candidate) => candidate.oid === 71,
    );
    const position = portfolio.positions.find(
      (candidate) => candidate.canonicalMarketId === "perp:0:4",
    );
    if (!order || !position) throw new Error("fixture rows missing");

    expect(buildCancelIntent(order)).toEqual({
      type: "cancel",
      assetId: 4,
      target: { kind: "oid", oid: 71 },
    });
    expect(buildLeverageIntent(position, 7, "isolated")).toEqual({
      type: "update_leverage",
      assetId: 4,
      leverage: 7,
      marginMode: "isolated",
    });
  });

  test("hands cancel, close, and margin to the shared immutable review contract", () => {
    const portfolio = normalizePortfolioSnapshot(PORTFOLIO_FIXTURE);
    const order = portfolio.openOrders.find(
      (candidate) => candidate.oid === 71,
    );
    const position = portfolio.positions.find(
      (candidate) => candidate.canonicalMarketId === "perp:0:4",
    );
    if (!order || !position) throw new Error("fixture rows missing");
    const nowMs = 1_720_000_050_000;

    const cancel = buildPortfolioCancelReview({
      portfolio,
      order,
      target: REVIEW_TARGET,
      context: REVIEW_CONTEXT,
      capturedContextEpoch: 4,
      nowMs,
    });
    const close = buildPortfolioCloseReview({
      portfolio,
      position,
      draft: createCloseDraft(position),
      cloid: "0x44444444444444444444444444444444",
      target: REVIEW_TARGET,
      context: REVIEW_CONTEXT,
      capturedContextEpoch: 4,
      nowMs,
    });
    const margin = buildPortfolioLeverageReview({
      portfolio,
      position,
      leverage: 7,
      marginMode: "isolated",
      target: REVIEW_TARGET,
      context: REVIEW_CONTEXT,
      capturedContextEpoch: 4,
      nowMs,
    });
    const takeProfit = buildPortfolioPositionTpslReview({
      portfolio,
      position,
      draft: createPositionTpslDraft(position, "take_profit"),
      cloid: "0x55555555555555555555555555555555",
      target: REVIEW_TARGET,
      context: REVIEW_CONTEXT,
      capturedContextEpoch: 4,
      nowMs,
    });

    expect(cancel.validated.intent).toEqual({
      type: "cancel",
      assetId: 4,
      target: { kind: "oid", oid: 71 },
    });
    expect(close.presentation).toMatchObject({
      action: "Full reduce-only close",
      side: "SELL",
      size: "2.5",
      reduceOnly: "Yes",
      slippage: "0.5%",
    });
    expect(margin.presentation).toMatchObject({
      action: "Update leverage",
      leverageAndMargin: "7× · isolated",
    });
    expect(takeProfit.presentation).toMatchObject({
      action: "Position take profit",
      price: "12",
      size: "2.5",
      reduceOnly: "Yes",
      slippage: "5%",
    });
    expect(Object.isFrozen(close)).toBe(true);

    const hip3 = portfolio.positions.find(
      (candidate) => candidate.canonicalMarketId === "perp:3:9",
    );
    if (!hip3) throw new Error("fixture HIP-3 position missing");
    expect(() =>
      buildPortfolioCloseReview({
        portfolio,
        position: hip3,
        draft: {
          positionId: hip3.id,
          behavior: "market",
          size: hip3.absoluteSize,
          limitPrice: hip3.market?.markPx ?? "12",
          timeInForce: "Gtc",
          slippageBps: "50",
        },
        cloid: "0x45454545454545454545454545454545",
        target: REVIEW_TARGET,
        context: REVIEW_CONTEXT,
        capturedContextEpoch: 4,
        nowMs,
      }),
    ).toThrow("not currently available");
  });

  test("rejects wrong owners, stale snapshots, and detached review rows", () => {
    const portfolio = normalizePortfolioSnapshot(PORTFOLIO_FIXTURE);
    const position = portfolio.positions[0];
    const order = portfolio.openOrders[0];
    if (!position || !order) throw new Error("fixture rows missing");
    const common = {
      context: REVIEW_CONTEXT,
      capturedContextEpoch: 4,
      nowMs: PORTFOLIO_FIXTURE.observedAtMs,
      target: REVIEW_TARGET,
    };

    expect(() =>
      buildPortfolioCloseReview({
        ...common,
        portfolio,
        position: { ...position },
        draft: createCloseDraft(position),
        cloid: "0x55555555555555555555555555555555",
      }),
    ).toThrow("changed since this snapshot");
    expect(Object.isFrozen(position)).toBe(true);
    expect(Object.isFrozen(position.market)).toBe(true);
    expect(() =>
      buildPortfolioCloseReview({
        ...common,
        portfolio: { ...portfolio, positions: [] },
        position,
        draft: createCloseDraft(position),
        cloid: "0x56565656565656565656565656565656",
      }),
    ).toThrow("no longer present");
    expect(() =>
      buildPortfolioCancelReview({
        ...common,
        portfolio,
        order: { ...order },
      }),
    ).toThrow("changed since this snapshot");
    expect(() =>
      buildPortfolioLeverageReview({
        ...common,
        portfolio,
        position,
        leverage: 7,
        marginMode: "isolated",
        nowMs: PORTFOLIO_FIXTURE.observedAtMs + 30_001,
      }),
    ).toThrow("snapshot is no longer current");
    expect(() =>
      buildPortfolioLeverageReview({
        ...common,
        portfolio,
        position,
        leverage: 7,
        marginMode: "isolated",
        context: { ...REVIEW_CONTEXT, network: "mainnet" },
      }),
    ).toThrow("does not belong to the active account");
    expect(() =>
      buildPortfolioLeverageReview({
        ...common,
        portfolio,
        position,
        leverage: 7,
        marginMode: "isolated",
        target: { ...REVIEW_TARGET, kind: "vault" },
      }),
    ).toThrow("does not belong to the active account");
  });

  test("close review scope binds owner, snapshot, price, row, and every draft field", () => {
    const portfolio = normalizePortfolioSnapshot(PORTFOLIO_FIXTURE);
    const position = portfolio.positions[0];
    if (!position) throw new Error("fixture position missing");
    const draft = createCloseDraft(position);
    const input = {
      portfolio,
      position,
      draft,
      context: REVIEW_CONTEXT,
      target: REVIEW_TARGET,
    };
    const scope = portfolioCloseScopeKey(input);
    const fence = createTradeOperationFence();
    const operation = fence.begin(
      position.canonicalMarketId ?? position.id,
      scope,
    );

    for (const changed of [
      { ...input, portfolio: { ...portfolio, version: portfolio.version + 1 } },
      {
        ...input,
        position: {
          ...position,
          market: position.market
            ? { ...position.market, markPx: "10.1" }
            : null,
        },
      },
      { ...input, position: { ...position, size: "2.4" as const } },
      { ...input, draft: { ...draft, size: "2" } },
      { ...input, draft: { ...draft, positionId: "different" } },
      { ...input, draft: { ...draft, behavior: "limit" as const } },
      { ...input, draft: { ...draft, limitPrice: "10.25" } },
      { ...input, draft: { ...draft, timeInForce: "Ioc" as const } },
      { ...input, draft: { ...draft, slippageBps: "75" } },
    ]) {
      expect(portfolioCloseScopeKey(changed)).not.toBe(scope);
      expect(fence.canCommit(operation, portfolioCloseScopeKey(changed))).toBe(
        false,
      );
    }
    expect(fence.canCommit(operation, scope)).toBe(true);
    fence.invalidate();
    expect(fence.canCommit(operation, scope)).toBe(false);
  });
});
