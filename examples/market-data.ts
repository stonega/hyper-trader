import { createHyperliquidClient } from "@hyper-trader/hyperliquid";

const client = createHyperliquidClient({ network: "mainnet" });
const mids = await client.getAllMids();

for (const market of mids.filter(({ symbol }) =>
  ["BTC", "ETH", "SOL", "HYPE"].includes(symbol),
)) {
  console.log(`${market.symbol}: ${market.price}`);
}
