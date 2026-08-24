import { parseMarketSummaryPage } from "@hyper-trader/hyperliquid/public";

const origin = Bun.env.HYPER_TRADER_BACKEND_ORIGIN;
if (!origin) {
  throw new Error("set HYPER_TRADER_BACKEND_ORIGIN to the exact HTTPS origin");
}

const url = new URL("/v1/market-summaries/testnet", origin);
url.searchParams.set("limit", "24");
url.searchParams.set("availability", "enabled");
url.searchParams.set("includeHip3", "true");
url.searchParams.set("lifecycle", "active");
url.searchParams.set("sort", "volume");

const response = await fetch(url, {
  headers: { accept: "application/json" },
  redirect: "error",
});
if (!response.ok) {
  throw new Error(`market summary request failed with ${response.status}`);
}
const page = parseMarketSummaryPage(await response.json());

console.log(`loaded ${page.items.length} of ${page.total} markets`);
for (const market of page.items) {
  console.log(`${market.canonicalId} ${market.displaySymbol}`);
}
console.log(`next cursor: ${page.nextCursor ?? "none"}`);
