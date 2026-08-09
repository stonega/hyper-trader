import {
  buildL1TypedData,
  buildMarketOrderAction,
  encodeL1Action,
} from "@hyper-trader/hyperliquid";

const network = "testnet" as const;
const nonce = 1_725_000_000_000;
const expiresAfter = nonce + 15_000;
const action = buildMarketOrderAction({
  assetId: 1,
  side: "buy",
  size: "0.01",
  aggressiveLimitPrice: "100",
  cloid: "0x00000000000000000000000000000001",
});
const encoded = encodeL1Action({ action, nonce, expiresAfter });
const payload = buildL1TypedData(network, encoded);

// Deliberately exclude action bytes, typed data, signatures, and transport body.
console.log(
  JSON.stringify({
    network,
    actionType: "market_order",
    actionHash: encoded.actionHash,
    source: payload.typedData.message.source,
    nonce: encoded.nonce,
    expiresAfter: encoded.expiresAfter,
  }),
);
