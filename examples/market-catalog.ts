import { createPublicHyperliquidClient } from "@hyper-trader/hyperliquid/public";

const client = createPublicHyperliquidClient({ network: "testnet" });
const catalog = await client.getMarketCatalog();

for (const market of catalog.markets) {
  console.log(
    `${market.canonicalId} ${market.displaySymbol} asset=${market.orderAssetId}`,
  );
}

for (const market of catalog.quarantined) {
  console.warn(
    `${market.canonicalId} browse-only: ${market.reasons.join(", ")}`,
  );
}
