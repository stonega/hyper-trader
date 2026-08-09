import { validateTradingAction } from "@hyper-trader/hyperliquid";

const mode = process.env.HYPER_TRADER_TESTNET_ORDER_WORKFLOW;

if (mode !== "offline-fixture" && mode !== "live") {
  throw new Error(
    "Set HYPER_TRADER_TESTNET_ORDER_WORKFLOW=offline-fixture for the deterministic workflow. Live mode requires a separately reviewed disposable-agent run.",
  );
}

if (mode === "live") {
  throw new Error(
    "Live testnet submission remains disabled until the security review has unconditional runtime evidence.",
  );
}

const result = validateTradingAction({
  context: {
    network: "testnet",
    masterAccount: "0x1111111111111111111111111111111111111111",
    targetAccount: "0x2222222222222222222222222222222222222222",
    capturedContextEpoch: 1,
    currentContextEpoch: 1,
    currentNetwork: "testnet",
    currentMasterAccount: "0x1111111111111111111111111111111111111111",
    currentTargetAccount: "0x2222222222222222222222222222222222222222",
    reviewedAtMs: 1_725_000_000_000,
    reviewExpiresAtMs: 1_725_000_030_000,
    nowMs: 1_725_000_001_000,
  },
  market: {
    canonicalId: "perp:fixture",
    metadataFingerprint: "offline-fixture-v1",
    orderAssetId: 0,
    family: "perp",
    lifecycle: "active",
    orderAvailability: "enabled",
    sizeDecimals: 3,
    pricePrecision: { maxSignificantFigures: 5, maxDecimalPlaces: 2 },
    maxLeverage: 25,
    referencePrice: "100",
    minimumNotional: "10",
  },
  account: {
    availableMargin: "1000",
    leverage: 5,
    marginMode: "cross",
    positionSize: "0",
    version: 1,
  },
  controls: { slippageBps: null, trigger: null },
  intent: {
    type: "limit_order",
    assetId: 0,
    side: "buy",
    size: "0.1",
    limitPrice: "100",
    timeInForce: "Gtc",
    reduceOnly: false,
    cloid: "0x00000000000000000000000000000001",
  },
});

// This output is deliberately redacted: no account, cloid, payload, signature,
// action bytes, or transport body is printed.
console.log(
  JSON.stringify({
    network: "testnet",
    mode,
    actionType: result.intent.type,
    validation: "passed",
    transport: "not_called",
  }),
);
