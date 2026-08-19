import { createHyperliquidClient } from "@hyper-trader/hyperliquid";

const client = createHyperliquidClient({ network: "mainnet" });
const endTime = Date.now();
const [mids, candles] = await Promise.all([
  client.getAllMids(),
  client.getCandles({
    coin: "BTC",
    interval: "15m",
    startTime: endTime - 24 * 60 * 60 * 1_000,
    endTime,
  }),
]);

for (const market of mids.filter(({ symbol }) =>
  ["BTC", "ETH", "SOL", "HYPE"].includes(symbol),
)) {
  console.log(`${market.symbol}: ${market.price}`);
}

const latestCandle = candles.at(-1);
if (latestCandle) {
  console.log(
    `BTC ${latestCandle.interval}: O=${latestCandle.open} H=${latestCandle.high} L=${latestCandle.low} C=${latestCandle.close}`,
  );
}
