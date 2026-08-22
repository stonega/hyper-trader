import {
  type HyperliquidNetwork,
  parsePublicPortfolioHistorySnapshot,
  parsePublicPortfolioLiveSnapshot,
} from "@hyper-trader/hyperliquid/public";

const [originInput, networkInput, userInput] = Bun.argv.slice(2);
if (!originInput || !networkInput || !userInput) {
  throw new Error(
    "Usage: bun examples/portfolio-snapshot.ts https://backend.example testnet 0x...",
  );
}
if (networkInput !== "testnet" && networkInput !== "mainnet") {
  throw new Error("Network must be testnet or mainnet.");
}

const originUrl = new URL(originInput);
if (originUrl.protocol !== "https:" || originUrl.origin !== originInput) {
  throw new Error("The backend must be an exact HTTPS origin.");
}
const network: HyperliquidNetwork = networkInput;
const user = userInput.trim().toLowerCase();
if (!/^0x[0-9a-f]{40}$/.test(user)) {
  throw new Error("User must be a 20-byte hexadecimal address.");
}

async function read(phase: "live" | "history"): Promise<unknown> {
  const response = await fetch(
    `${originInput}/v1/portfolio-snapshots/${phase}`,
    {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({ network, user }),
      redirect: "error",
    },
  );
  if (!response.ok) {
    throw new Error(`Portfolio backend returned ${response.status}.`);
  }
  return response.json();
}

const [live, history] = await Promise.all([
  read("live").then((value) =>
    parsePublicPortfolioLiveSnapshot(value, { network, user }),
  ),
  read("history").then((value) =>
    parsePublicPortfolioHistorySnapshot(value, { network, user }),
  ),
]);

console.log({
  network,
  generatedAtMs: Math.max(live.generatedAtMs, history.generatedAtMs),
  perpetualDexes: live.dexes.length,
  fills: history.fills.length,
  fundingRows: history.funding.length,
  performancePeriods: history.periods.length,
  sourceGaps: [...live.sourceGaps, ...history.sourceGaps],
});
